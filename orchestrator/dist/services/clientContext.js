"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClientContext = buildClientContext;
function buildClientContext(params) {
    const { phoneE164, conversation, lastMessages, behaviorOverride, detectedLanguage, languageHint, kbContextSummary, upcomingAppointments } = params;
    const snapshot = {
        row: conversation,
        lastMessages: lastMessages.map((m) => ({
            ts: m.ts,
            from: m.author === 'client' ? 'client' : m.author === 'admin' ? 'admin' : 'agent',
            text: m.text
        })),
        upcomingSummary: summarizeUpcoming(upcomingAppointments)
    };
    const context = {
        phoneE164,
        conversation: snapshot,
        behaviorOverride,
        language: {
            detected: detectedLanguage,
            hint: languageHint
        },
        kbContextSummary
    };
    return context;
}
function summarizeUpcoming(list) {
    if (!list || !list.length)
        return undefined;
    const sorted = [...list].sort((a, b) => {
        const ta = a.start ? Date.parse(a.start) : 0;
        const tb = b.start ? Date.parse(b.start) : 0;
        return ta - tb;
    });
    return {
        count: list.length,
        nearestDate: sorted[0]?.start
    };
}
//# sourceMappingURL=clientContext.js.map