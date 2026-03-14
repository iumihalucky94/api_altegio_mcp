/**
 * WhatsApp Web transport (whatsapp-web.js).
 * Receives messages → forwards to Orchestrator ingest.
 * Send via POST /whatsapp/send (called by orchestrator).
 */
import path from 'path';
import fs from 'fs';
import { getConfigString } from './config';

const AUTH_DIR = process.env.WA_WEB_AUTH_DIR || path.join(process.cwd(), '.wwebjs_auth');
const SESSION_ID = 'wa-service';

function clearStaleChromiumLocks(authDir: string): void {
  const sessionDir = path.join(authDir, `session-${SESSION_ID}`);
  const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const name of locks) {
    const filePath = path.join(sessionDir, name);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}

let clientInstance: any = null;
let lastQr: string | null = null;

function getClientLib() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wa = require('whatsapp-web.js');
  return wa;
}

export function initWaClient(authDir?: string, log?: any): Promise<void> {
  if (clientInstance) return Promise.resolve();

  const { Client, LocalAuth } = getClientLib();
  const dir = authDir || AUTH_DIR;
  clearStaleChromiumLocks(dir);

  const puppeteerOpts: any = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: SESSION_ID, dataPath: dir }),
    puppeteer: puppeteerOpts
  });

  client.on('qr', (qr: string) => {
    lastQr = qr || null;
    log?.info({ qrLength: qr?.length }, 'WhatsApp Web: scan QR (GET /whatsapp/qr)');
  });

  client.on('ready', () => {
    lastQr = null;
    log?.info('WhatsApp Web client ready');
  });

  client.on('authenticated', () => log?.info('WhatsApp Web authenticated'));
  client.on('auth_failure', (msg: string) => log?.warn({ msg }, 'WhatsApp Web auth failure'));
  client.on('disconnected', (reason: string) => log?.warn({ reason }, 'WhatsApp Web disconnected'));

  client.on('message', async (message: any) => {
    try {
      const from = message.from || message.id?.remoteJid || '';
      const chatId = typeof from === 'string' ? from : (from as any)._serialized || '';
      const body = message.body || message._data?.body || '';
      if (message.fromMe) {
        log?.debug({ chatId }, 'WhatsApp: skip (fromMe)');
        return;
      }
      if (!chatId || !chatId.endsWith('@c.us')) {
        log?.info({ chatId, hint: 'only private chats @c.us are forwarded; groups @g.us are ignored' }, 'WhatsApp: skip (not private chat)');
        return;
      }
      if (typeof body !== 'string') {
        log?.debug({ chatId }, 'WhatsApp: skip (body not string)');
        return;
      }
      const phoneRaw = chatId.replace('@c.us', '').trim();
      const clientPhoneE164 = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;
      const ts = message.timestamp ? new Date(message.timestamp * 1000).toISOString() : new Date().toISOString();
      const providerMessageId = message.id?.id || message.id?._serialized || message.id || '';

      const ingestUrl = await getConfigString('wa.orchestrator_ingest_url', process.env.ORCHESTRATOR_INGEST_URL || '');
      const token = await getConfigString('wa.internal_token', process.env.WA_INTERNAL_TOKEN || '');
      if (!ingestUrl) {
        log?.warn('wa.orchestrator_ingest_url / ORCHESTRATOR_INGEST_URL not set, skip forward');
        return;
      }

      const payload = {
        provider: 'whatsapp-web',
        provider_message_id: providerMessageId,
        client_phone_e164: clientPhoneE164,
        text: body,
        ts_iso: ts,
        raw_json: message.rawData || undefined
      };
      const url = ingestUrl.replace(/\/$/, '') + '/ingest/whatsapp-web';
      log?.info({ clientPhoneE164, textLen: body.length }, 'WhatsApp: forwarding to orchestrator');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-internal-token': token } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        log?.warn({ status: res.status, clientPhoneE164, body: await res.text().catch(() => '') }, 'Forward to orchestrator failed');
      } else {
        log?.info({ clientPhoneE164 }, 'WhatsApp: forwarded to orchestrator ok');
      }
    } catch (err) {
      log?.error({ err, from: (message as any).from }, 'WhatsApp Web message forward error');
    }
  });

  clientInstance = client;
  return client.initialize();
}

export function getWaClient(): any {
  return clientInstance;
}

export function getLastQr(): string | null {
  return lastQr;
}

export async function sendWaMessage(toPhoneE164: string, text: string): Promise<string | null> {
  const client = getWaClient();
  if (!client) return null;
  const cleaned = (toPhoneE164 || '').replace(/\D/g, '');
  if (!cleaned) return null;
  const chatId = `${cleaned}@c.us`;
  try {
    const sent = await client.sendMessage(chatId, text);
    const id = sent?.id?.id || sent?.id?._serialized || (sent as any)?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}
