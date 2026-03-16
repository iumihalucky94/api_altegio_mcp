"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeReply = writeReply;
const localization_1 = require("./localization");
function writeReply(input) {
    const { language, replyCandidate, allowAgentToReply } = input;
    if (!allowAgentToReply) {
        const text = (0, localization_1.getSystemMessage)('generic_ack', language);
        return { text, usedFallback: true };
    }
    if (replyCandidate && replyCandidate.trim().length > 0) {
        return { text: replyCandidate, usedFallback: false };
    }
    const text = (0, localization_1.getSystemMessage)('generic_ack', language);
    return { text, usedFallback: true };
}
//# sourceMappingURL=writer.js.map