"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTelegramBot = startTelegramBot;
const telegraf_1 = require("telegraf");
const config_1 = require("../config");
const conversation_1 = require("../services/conversation");
const ignoreList_1 = require("../services/ignoreList");
const behaviorOverrides_1 = require("../services/behaviorOverrides");
const handoff_1 = require("../services/handoff");
const messageStore_1 = require("../services/messageStore");
const mcpClient_1 = require("../services/mcpClient");
const e164_1 = require("../lib/e164");
async function isAdmin(db, telegramUserId) {
    const res = await db.query('SELECT 1 FROM telegram_admins WHERE telegram_user_id = $1 AND is_enabled = true', [BigInt(telegramUserId)]);
    return res.rows.length > 0;
}
function parsePhone(args) {
    const raw = args.trim().replace(/^\+\s*/, '');
    const phone = (0, e164_1.normalizeE164)(raw);
    return (0, e164_1.isValidE164)(phone) ? phone : null;
}
async function startTelegramBot(db, token, log) {
    const logsChatId = await (0, config_1.getConfigString)('telegram.logs_group_chat_id', '');
    const summaryChatId = await (0, config_1.getConfigString)('telegram.summary_group_chat_id', '');
    const bot = new telegraf_1.Telegraf(token);
    const sendSummary = async (msg) => {
        if (!summaryChatId)
            return;
        try {
            await bot.telegram.sendMessage(summaryChatId, msg);
        }
        catch (e) {
            log.warn({ err: e }, 'Send to summary group failed');
        }
    };
    const sendLogs = async (payload) => {
        if (!logsChatId)
            return;
        try {
            await bot.telegram.sendMessage(logsChatId, JSON.stringify(payload));
        }
        catch (e) {
            log.warn({ err: e }, 'Send to logs group failed');
        }
    };
    bot.use(async (ctx, next) => {
        const id = ctx.from?.id;
        if (!id)
            return next();
        const ok = await isAdmin(db, id);
        if (!ok) {
            await ctx.reply('Not authorized.').catch(() => { });
            return;
        }
        return next();
    });
    bot.command('takeover', async (ctx) => {
        const phone = parsePhone(ctx.message?.text?.replace(/^\/takeover\s*/, '') ?? '');
        if (!phone)
            return ctx.reply('Usage: /takeover +<phone>');
        const conv = await (0, conversation_1.getConversationByPhone)(db, phone);
        if (!conv)
            return ctx.reply('No conversation for ' + phone);
        await (0, conversation_1.setConversationState)(db, conv.conversation_id, 'ADMIN_TAKEOVER', null);
        await ctx.reply('Takeover set for ' + phone);
    });
    const releaseContact = async (ctx, cmd) => {
        const phone = parsePhone(ctx.message?.text?.replace(new RegExp(`^\\/${cmd}\\s*`), '') ?? '');
        if (!phone)
            return ctx.reply(`Usage: /${cmd} +<phone>`);
        const conv = await (0, conversation_1.getConversationByPhone)(db, phone);
        if (!conv)
            return ctx.reply('No conversation for ' + phone);
        await (0, conversation_1.setConversationState)(db, conv.conversation_id, 'BOT_ACTIVE');
        await ctx.reply('Контакт ' + phone + ' возвращён боту. Бот снова отвечает.');
    };
    bot.command('resume', (ctx) => releaseContact(ctx, 'resume'));
    bot.command('release', (ctx) => releaseContact(ctx, 'release'));
    bot.command('pause', async (ctx) => {
        const phone = parsePhone(ctx.message?.text?.replace(/^\/pause\s*/, '') ?? '');
        if (!phone)
            return ctx.reply('Usage: /pause +<phone>');
        const conv = await (0, conversation_1.getConversationByPhone)(db, phone);
        if (!conv)
            return ctx.reply('No conversation for ' + phone);
        await (0, conversation_1.setConversationState)(db, conv.conversation_id, 'BOT_PAUSED');
        await ctx.reply('Paused for ' + phone);
    });
    bot.command('ignore', async (ctx) => {
        const rest = (ctx.message?.text ?? '').replace(/^\/ignore\s*/, '').trim();
        const phone = parsePhone(rest.split(/\s+/)[0] || '');
        if (!phone)
            return ctx.reply('Usage: /ignore +<phone> [IGNORE|ADMIN_ONLY] [reason]');
        const parts = rest.split(/\s+/).filter(Boolean);
        const mode = parts[1] === 'ADMIN_ONLY' ? 'ADMIN_ONLY' : 'IGNORE';
        const reason = parts.slice(2).join(' ') || null;
        await (0, ignoreList_1.setIgnore)(db, phone, mode, reason);
        await ctx.reply('Ignoring ' + phone + ' (' + mode + ')');
    });
    bot.command('unignore', async (ctx) => {
        const phone = parsePhone(ctx.message?.text?.replace(/^\/unignore\s*/, '') ?? '');
        if (!phone)
            return ctx.reply('Usage: /unignore +<phone>');
        await (0, ignoreList_1.unignore)(db, phone);
        await ctx.reply('Unignored ' + phone);
    });
    const stateLabel = (s) => {
        if (s === 'AWAITING_ADMIN')
            return 'Ожидает ответа админа';
        if (s === 'ADMIN_TAKEOVER')
            return 'Ведётся админом';
        return s || '—';
    };
    bot.command('list', async (ctx) => {
        const contacts = await (0, handoff_1.getContactsNeedingAttention)(db);
        if (contacts.length === 0) {
            return ctx.reply('Нет контактов, требующих вмешательства.');
        }
        const sep = '\n━━━━━━━━━━━━━━━━━━━━\n';
        const blocks = [];
        for (const c of contacts) {
            let lastClientText = '—';
            const conv = await (0, conversation_1.getConversationByPhone)(db, c.client_phone);
            if (conv) {
                const messages = await (0, messageStore_1.getLastMessages)(db, conv.conversation_id, 30);
                const lastFromClient = messages.filter((m) => m.author === 'client').pop();
                if (lastFromClient?.text)
                    lastClientText = lastFromClient.text.trim().slice(0, 200);
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
        const phone = parsePhone(ctx.message?.text?.replace(/^\/status\s*/, '') ?? '');
        if (!phone)
            return ctx.reply('Usage: /status +<phone>');
        const conv = await (0, conversation_1.getConversationByPhone)(db, phone);
        if (!conv)
            return ctx.reply('No conversation for ' + phone);
        const messages = await (0, messageStore_1.getLastMessages)(db, conv.conversation_id, 10);
        const pending = (await (0, handoff_1.getOpenPendingActions)(db)).filter((p) => p.client_phone === phone);
        let text = 'Phone: ' + phone + '\nState: ' + conv.state + '\nConv: ' + conv.conversation_id + '\n\nLast messages:\n';
        messages.forEach((m) => { text += m.ts + ' [' + m.author + '] ' + m.text.slice(0, 80) + '\n'; });
        if (pending.length)
            text += '\nPending: ' + pending.map((p) => p.id).join(', ');
        await ctx.reply(text.slice(0, 4000));
    });
    bot.command('case', async (ctx) => {
        const caseId = (ctx.message?.text ?? '').replace(/^\/case\s*/, '').trim();
        if (!caseId)
            return ctx.reply('Usage: /case <case_id>');
        const c = await (0, handoff_1.getCase)(db, caseId);
        if (!c)
            return ctx.reply('Case not found');
        await ctx.reply('Case ' + c.id + '\nStatus: ' + c.status + '\nSummary: ' + c.summary);
    });
    bot.command('rules', async (ctx) => {
        const phone = parsePhone(ctx.message?.text?.replace(/^\/rules\s*/, '') ?? '');
        if (!phone)
            return ctx.reply('Usage: /rules +<phone>');
        const o = await (0, behaviorOverrides_1.getBehaviorOverride)(db, phone);
        if (!o)
            return ctx.reply('No overrides for ' + phone);
        await ctx.reply(JSON.stringify(o).slice(0, 4000));
    });
    bot.command('setrule', async (ctx) => {
        const rest = (ctx.message?.text ?? '').replace(/^\/setrule\s*/, '').trim();
        const phone = parsePhone(rest.split(/\s+/)[0] || '');
        if (!phone)
            return ctx.reply('Usage: /setrule +<phone> key=value');
        const kv = rest.slice(rest.indexOf(' ') + 1).trim();
        const eq = kv.indexOf('=');
        if (eq <= 0)
            return ctx.reply('Usage: /setrule +<phone> key=value');
        const key = kv.slice(0, eq).trim();
        const value = kv.slice(eq + 1).trim();
        await (0, behaviorOverrides_1.setRule)(db, phone, key, value);
        await ctx.reply('Set ' + key + '=' + value + ' for ' + phone);
    });
    bot.command('approve', async (ctx) => {
        const approvalId = (ctx.message?.text ?? '').replace(/^\/approve\s*/, '').trim();
        if (!approvalId)
            return ctx.reply('Usage: /approve <approval_id>');
        const gatewayUrl = await (0, config_1.getConfigString)('MCP_GATEWAY_URL', '');
        const adminKey = await (0, config_1.getConfigString)('ADMIN_APPROVE_KEY', '');
        const ok = await (0, mcpClient_1.approveViaMcp)(approvalId, adminKey, gatewayUrl);
        if (ok)
            await (0, handoff_1.markPendingDone)(db, approvalId);
        await ctx.reply(ok ? 'Approved.' : 'Approve failed.');
    });
    bot.command('reject', async (ctx) => {
        const approvalId = (ctx.message?.text ?? '').replace(/^\/reject\s*/, '').trim();
        if (!approvalId)
            return ctx.reply('Usage: /reject <approval_id>');
        const gatewayUrl = await (0, config_1.getConfigString)('MCP_GATEWAY_URL', '');
        const adminKey = await (0, config_1.getConfigString)('ADMIN_APPROVE_KEY', '');
        await (0, mcpClient_1.rejectApproval)(approvalId, adminKey, gatewayUrl);
        await (0, handoff_1.markPendingDone)(db, approvalId);
        await ctx.reply('Rejected.');
    });
    bot.launch().then(() => log.info('Telegram bot started'));
    return { sendSummary, sendLogs };
}
//# sourceMappingURL=bot.js.map