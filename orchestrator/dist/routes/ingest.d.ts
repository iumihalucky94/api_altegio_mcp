import type { FastifyInstance } from 'fastify';
export interface IngestWhatsAppWebBody {
    provider: string;
    provider_message_id?: string;
    client_phone_e164: string;
    text: string;
    ts_iso: string;
    raw_json?: unknown;
}
export declare function registerIngestRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=ingest.d.ts.map