import { getConfigString } from '../config';

export interface SendWhatsAppResult {
  ok: boolean;
  provider_message_id?: string;
}

/** Send via wa-service POST /whatsapp/send. Uses WA_SEND_URL if set, else MCP_GATEWAY_URL. */
export async function sendWhatsAppMessage(
  toPhone: string,
  text: string,
  conversationId: string | undefined,
  logger: { warn: (o: object, msg?: string) => void }
): Promise<SendWhatsAppResult> {
  const waSendUrl = await getConfigString('WA_SEND_URL', '');
  const gatewayUrl = await getConfigString('MCP_GATEWAY_URL', '');
  const baseUrl = waSendUrl.trim() || gatewayUrl;
  const token = await getConfigString('MCP_INTERNAL_TOKEN', '');
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) headers['x-internal-token'] = token;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    logger.warn(
      { status: res.status, toPhone, bodyPreview: errBody.slice(0, 200) },
      'WhatsApp send failed: gateway returned non-2xx (e.g. 503 = WhatsApp Web not ready)'
    );
    return { ok: false };
  }
  const data = (await res.json()) as { ok?: boolean; provider_message_id?: string };
  return { ok: true, provider_message_id: data?.provider_message_id };
}
