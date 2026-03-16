export interface SendWhatsAppResult {
    ok: boolean;
    provider_message_id?: string;
}
/** Send via wa-service POST /whatsapp/send. Uses WA_SEND_URL if set, else MCP_GATEWAY_URL. */
export declare function sendWhatsAppMessage(toPhone: string, text: string, conversationId: string | undefined, logger: {
    warn: (o: object, msg?: string) => void;
}): Promise<SendWhatsAppResult>;
//# sourceMappingURL=whatsappSend.d.ts.map