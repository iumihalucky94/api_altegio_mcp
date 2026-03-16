"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppMessage = sendWhatsAppMessage;
const config_1 = require("../config");
/** Send via wa-service POST /whatsapp/send. Uses WA_SEND_URL if set, else MCP_GATEWAY_URL. */
async function sendWhatsAppMessage(toPhone, text, conversationId, logger) {
    const waSendUrl = await (0, config_1.getConfigString)('WA_SEND_URL', '');
    const gatewayUrl = await (0, config_1.getConfigString)('MCP_GATEWAY_URL', '');
    const baseUrl = waSendUrl.trim() || gatewayUrl;
    const token = await (0, config_1.getConfigString)('MCP_INTERNAL_TOKEN', '');
    if (!baseUrl) {
        logger.warn({ toPhone }, 'WhatsApp send skipped: WA_SEND_URL and MCP_GATEWAY_URL not set');
        return { ok: false };
    }
    const url = `${baseUrl.replace(/\/$/, '')}/whatsapp/send`;
    const body = {
        to_phone_e164: toPhone,
        text,
        conversation_id: conversationId || null
    };
    const headers = {
        'Content-Type': 'application/json'
    };
    if (token)
        headers['x-internal-token'] = token;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        logger.warn({ status: res.status, toPhone, bodyPreview: errBody.slice(0, 200) }, 'WhatsApp send failed: gateway returned non-2xx (e.g. 503 = WhatsApp Web not ready)');
        return { ok: false };
    }
    const data = (await res.json());
    return { ok: true, provider_message_id: data?.provider_message_id };
}
//# sourceMappingURL=whatsappSend.js.map