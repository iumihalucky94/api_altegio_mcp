import { getConfigNumber } from '../config';

export type QueuedMessage = {
  conversationId: string;
  clientPhone: string;
  ts: Date;
  text: string;
  messageId?: string;
  locale?: string;
};

type ProcessCallback = (batch: QueuedMessage[]) => Promise<void>;

const pending = new Map<
  string,
  { timer: NodeJS.Timeout; messages: QueuedMessage[]; firstAt: number }
>();

let processBatch: ProcessCallback = async () => {};

export function setDebounceProcessor(fn: ProcessCallback) {
  processBatch = fn;
}

export async function enqueue(
  conversationId: string,
  msg: Omit<QueuedMessage, 'conversationId'>,
  logger: any
) {
  const debounceMs = await getConfigNumber('whatsapp.debounce_ms', 20000);
  const quietMs = await getConfigNumber('whatsapp.quiet_ms', 5000);
  const maxTotalMs = await getConfigNumber('whatsapp.max_debounce_total_ms', 60000);
  const maxBuffered = await getConfigNumber('whatsapp.max_buffered_messages', 10);

  const key = conversationId;
  const entry = pending.get(key);
  const queuedMsg: QueuedMessage = { ...msg, conversationId };

  if (entry) {
    clearTimeout(entry.timer);
    entry.messages.push(queuedMsg);
    if (entry.messages.length >= maxBuffered) {
      pending.delete(key);
      await processBatch(entry.messages);
      return;
    }
    const elapsed = Date.now() - entry.firstAt;
    const wait = Math.min(debounceMs, Math.max(0, maxTotalMs - elapsed));
    entry.timer = setTimeout(async () => {
      pending.delete(key);
      await processBatch(entry.messages).catch((err) => {
        logger.error({ err, conversationId }, 'Debounce process batch failed');
      });
    }, Math.max(quietMs, wait));
    return;
  }

  const firstAt = Date.now();
  const messages = [queuedMsg];
  logger.info({ conversationId: key, debounceMs }, 'Debounce: first message, timer started');
  const timer = setTimeout(async () => {
    pending.delete(key);
    logger.info({ conversationId: key, messageCount: messages.length }, 'Debounce: firing batch');
    await processBatch(messages).catch((err) => {
      logger.error({ err, conversationId: key }, 'Debounce process batch failed');
    });
  }, debounceMs);
  pending.set(key, { timer, messages, firstAt });
}
