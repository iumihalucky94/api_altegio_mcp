import { Telegraf } from 'telegraf';
import type { DbPool } from '../db';
import { getConfigString } from '../config';
import { getConversationByPhone, setConversationState } from '../services/conversation';
import { setIgnore, unignore } from '../services/ignoreList';
import { getBehaviorOverride, setRule } from '../services/behaviorOverrides';
import { getCase, getOpenPendingActions, getContactsNeedingAttention, markPendingDone } from '../services/handoff';
import { getLastMessages } from '../services/messageStore';
import { approveViaMcp, rejectApproval } from '../services/mcpClient';
import { normalizeE164, isValidE164 } from '../lib/e164';

async function isAdmin(db: DbPool, telegramUserId: number): Promise<boolean> {
  const res = await db.query(
    'SELECT 1 FROM telegram_admins WHERE telegram_user_id = $1 AND is_enabled = true',
    [BigInt(telegramUserId)]
  );
  return res.rows.length > 0;
}

function parsePhone(args: string): string | null {
  const raw = args.trim().replace(/^\+\s*/, '');
  const phone = normalizeE164(raw);
  return isValidE164(phone) ? phone : null;
}

export async function startTelegramBot(db: DbPool, token: string, log: any) {
  const logsChatId = await getConfigString('telegram.logs_group_chat_id', '');
  const summaryChatId = await getConfigString('telegram.summary_group_chat_id', '');
  const bot = new Telegraf(token);

  const sendSummary = async (msg: string) => {
    if (!summaryChatId) return;
    try {
      await bot.telegram.sendMessage(summaryChatId, msg);
    } catch (e) {
      log.warn({ err: e }, 'Send to summary group failed');
    }
  };
  const sendLogs = async (payload: object) => {
    if (!logsChatId) return;
    try {
      await bot.telegram.sendMessage(logsChatId, JSON.stringify(payload));
    } catch (e) {
      log.warn({ err: e }, 'Send to logs group failed');
    }
  };
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id) return next();
    const ok = await isAdmin(db, id);
    if (!ok) {
      await ctx.reply('Not authorized.').catch(() => {});
      return;
    }
    return next();
  });

  bot.command('takeover', async (ctx) => {
    const phone = parsePhone((ctx.message as any)?.text?.replace(/^\/takeover\s*/, '') ?? '');
    if (!phone) return ctx.reply('Usage: /takeover +<phone>');
    const conv = await getConversationByPhone(db, phone);
    if (!conv) return ctx.reply('No conversation for ' + phone);
    await setConversationState(db, conv.conversation_id, 'ADMIN_TAKEOVER', null);
    await ctx.reply('Takeover set for ' + phone);
  });

  const releaseContact = async (ctx: any, cmd: string) => {
    const phone = parsePhone((ctx.message as any)?.text?.replace(new RegExp(`^\\/${cmd}\\s*`), '') ?? '');
    if (!phone) return ctx.reply(`Usage: /${cmd} +<phone>`);
    const conv = await getConversationByPhone(db, phone);
    if (!conv) return ctx.reply('No conversation for ' + phone);
    await setConversationState(db, conv.conversation_id, 'BOT_ACTIVE');
    await ctx.reply('Контакт ' + phone + ' возвращён боту. Бот снова отвечает.');
  };

  bot.command('resume', (ctx) => releaseContact(ctx, 'resume'));
  bot.command('release', (ctx) => releaseContact(ctx, 'release'));

  bot.command('pause', async (ctx) => {
    const phone = parsePhone((ctx.message as any)?.text?.replace(/^\/pause\s*/, '') ?? '');
    if (!phone) return ctx.reply('Usage: /pause +<phone>');
    const conv = await getConversationByPhone(db, phone);
    if (!conv) return ctx.reply('No conversation for ' + phone);
    await setConversationState(db, conv.conversation_id, 'BOT_PAUSED');
    await ctx.reply('Paused for ' + phone);
  });

  bot.command('ignore', async (ctx) => {
    const rest = ((ctx.message as any)?.text ?? '').replace(/^\/ignore\s*/, '').trim();
    const phone = parsePhone(rest.split(/\s+/)[0] || '');
    if (!phone) return ctx.reply('Usage: /ignore +<phone> [IGNORE|ADMIN_ONLY] [reason]');
    const parts = rest.split(/\s+/).filter(Boolean);
    const mode = parts[1] === 'ADMIN_ONLY' ? 'ADMIN_ONLY' : 'IGNORE';
    const reason = parts.slice(2).join(' ') || null;
    await setIgnore(db, phone, mode as 'IGNORE' | 'ADMIN_ONLY', reason);
    await ctx.reply('Ignoring ' + phone + ' (' + mode + ')');
  });

  bot.command('unignore', async (ctx) => {
    const phone = parsePhone((ctx.message as any)?.text?.replace(/^\/unignore\s*/, '') ?? '');
    if (!phone) return ctx.reply('Usage: /unignore +<phone>');
    await unignore(db, phone);
    await ctx.reply('Unignored ' + phone);
  });

  const stateLabel = (s: string) => {
    if (s === 'AWAITING_ADMIN') return 'Ожидает ответа админа';
    if (s === 'ADMIN_TAKEOVER') return 'Ведётся админом';
    return s || '—';
  };

  bot.command('list', async (ctx) => {
    const contacts = await getContactsNeedingAttention(db);
    if (contacts.length === 0) {
      return ctx.reply('Нет контактов, требующих вмешательства.');
    }
    const sep = '\n━━━━━━━━━━━━━━━━━━━━\n';
    const blocks: string[] = [];
    for (const c of contacts) {
      let lastClientText = '—';
      const conv = await getConversationByPhone(db, c.client_phone);
      if (conv) {
        const messages = await getLastMessages(db, conv.conversation_id, 30);
        const lastFromClient = messages.filter((m) => m.author === 'client').pop();
        if (lastFromClient?.text) lastClientText = lastFromClient.text.trim().slice(0, 200);
      }
      const issueParts = [stateLabel(c.state)];
      if (c.open_cases.length && c.open_cases[0].summary) {
        issueParts.push((c.open_cases[0].summary || '').trim().slice(0, 150));
      }
      const lines = [
        '📱 Номер: ' + c.client_phone,
        'В чём дело: ' + issueParts.join('. '),
        'Что написал клиент: ' + lastClientText
      ];
      blocks.push(lines.join('\n'));
    }
    const text = blocks.join(sep) + '\n\nЧтобы вернуть контакт боту: /release +номер';
    await ctx.reply(text.slice(0, 4000));
  });

  bot.command('status', async (ctx) => {
    const phone = parsePhone((ctx.message as any)?.text?.replace(/^\/status\s*/, '') ?? '');
    if (!phone) return ctx.reply('Usage: /status +<phone>');
    const conv = await getConversationByPhone(db, phone);
    if (!conv) return ctx.reply('No conversation for ' + phone);
    const messages = await getLastMessages(db, conv.conversation_id, 10);
    const pending = (await getOpenPendingActions(db)).filter((p) => p.client_phone === phone);
    let text = 'Phone: ' + phone + '\nState: ' + conv.state + '\nConv: ' + conv.conversation_id + '\n\nLast messages:\n';
    messages.forEach((m) => { text += m.ts + ' [' + m.author + '] ' + m.text.slice(0, 80) + '\n'; });
    if (pending.length) text += '\nPending: ' + pending.map((p) => p.id).join(', ');
    await ctx.reply(text.slice(0, 4000));
  });

  bot.command('case', async (ctx) => {
    const caseId = ((ctx.message as any)?.text ?? '').replace(/^\/case\s*/, '').trim();
    if (!caseId) return ctx.reply('Usage: /case <case_id>');
    const c = await getCase(db, caseId);
    if (!c) return ctx.reply('Case not found');
    await ctx.reply('Case ' + c.id + '\nStatus: ' + c.status + '\nSummary: ' + c.summary);
  });

  bot.command('rules', async (ctx) => {
    const phone = parsePhone((ctx.message as any)?.text?.replace(/^\/rules\s*/, '') ?? '');
    if (!phone) return ctx.reply('Usage: /rules +<phone>');
    const o = await getBehaviorOverride(db, phone);
    if (!o) return ctx.reply('No overrides for ' + phone);
    await ctx.reply(JSON.stringify(o).slice(0, 4000));
  });

  bot.command('setrule', async (ctx) => {
    const rest = ((ctx.message as any)?.text ?? '').replace(/^\/setrule\s*/, '').trim();
    const phone = parsePhone(rest.split(/\s+/)[0] || '');
    if (!phone) return ctx.reply('Usage: /setrule +<phone> key=value');
    const kv = rest.slice(rest.indexOf(' ') + 1).trim();
    const eq = kv.indexOf('=');
    if (eq <= 0) return ctx.reply('Usage: /setrule +<phone> key=value');
    const key = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    await setRule(db, phone, key, value);
    await ctx.reply('Set ' + key + '=' + value + ' for ' + phone);
  });

  bot.command('approve', async (ctx) => {
    const approvalId = ((ctx.message as any)?.text ?? '').replace(/^\/approve\s*/, '').trim();
    if (!approvalId) return ctx.reply('Usage: /approve <approval_id>');
    const gatewayUrl = await getConfigString('MCP_GATEWAY_URL', '');
    const adminKey = await getConfigString('ADMIN_APPROVE_KEY', '');
    const ok = await approveViaMcp(approvalId, adminKey, gatewayUrl);
    if (ok) await markPendingDone(db, approvalId);
    await ctx.reply(ok ? 'Approved.' : 'Approve failed.');
  });

  bot.command('reject', async (ctx) => {
    const approvalId = ((ctx.message as any)?.text ?? '').replace(/^\/reject\s*/, '').trim();
    if (!approvalId) return ctx.reply('Usage: /reject <approval_id>');
    const gatewayUrl = await getConfigString('MCP_GATEWAY_URL', '');
    const adminKey = await getConfigString('ADMIN_APPROVE_KEY', '');
    await rejectApproval(approvalId, adminKey, gatewayUrl);
    await markPendingDone(db, approvalId);
    await ctx.reply('Rejected.');
  });

  bot.launch().then(() => log.info('Telegram bot started'));
  return { sendSummary, sendLogs };
}
