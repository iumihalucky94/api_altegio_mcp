"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDebounceProcessor = setDebounceProcessor;
exports.enqueue = enqueue;
const config_1 = require("../config");
const pending = new Map();
let processBatch = async () => { };
function setDebounceProcessor(fn) {
    processBatch = fn;
}
async function enqueue(conversationId, msg, logger) {
    const debounceMs = await (0, config_1.getConfigNumber)('whatsapp.debounce_ms', 20000);
    const quietMs = await (0, config_1.getConfigNumber)('whatsapp.quiet_ms', 5000);
    const maxTotalMs = await (0, config_1.getConfigNumber)('whatsapp.max_debounce_total_ms', 60000);
    const maxBuffered = await (0, config_1.getConfigNumber)('whatsapp.max_buffered_messages', 10);
    const key = conversationId;
    const entry = pending.get(key);
    const queuedMsg = { ...msg, conversationId };
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
//# sourceMappingURL=debounce.js.map