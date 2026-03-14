# Migration: Meta Cloud API → WhatsApp Web (MCP transport)

## Summary

- **Before:** Orchestrator received WhatsApp via Meta Cloud API webhook (`POST /webhooks/whatsapp`) and sent messages via Meta Graph API using `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_ID`.
- **After:** Orchestrator is **transport-agnostic**. WhatsApp is handled by the **MCP Gateway** using WhatsApp Web (whatsapp-web.js). MCP receives messages and forwards them to Orchestrator `POST /ingest/whatsapp-web`. Orchestrator sends messages by calling MCP `POST /whatsapp/send`. No public Meta webhook; no Meta API keys in Orchestrator.

## Config changes

### Remove (Orchestrator)

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_ID`
- `WEBHOOK_VERIFY_TOKEN`

### Add / keep

- **Orchestrator:** `MCP_GATEWAY_URL` (unchanged), `MCP_INTERNAL_TOKEN` (shared secret for calling `/whatsapp/send` and for validating ingest from MCP).
- **Gateway:** `ORCHESTRATOR_INGEST_URL` (base URL of Orchestrator, e.g. `http://orchestrator:3031`), `WA_WEB_INTERNAL_TOKEN` (same value as `MCP_INTERNAL_TOKEN`).

### .env

Set one shared secret and use it in both services:

```env
MCP_INTERNAL_TOKEN=your-internal-secret
```

In Docker Compose, Gateway gets `WA_WEB_INTERNAL_TOKEN: ${MCP_INTERNAL_TOKEN}` and Orchestrator gets `MCP_INTERNAL_TOKEN: ${MCP_INTERNAL_TOKEN}`.

## Behaviour changes

1. **Ingest:** Meta no longer sends webhooks to your app. MCP Gateway runs a WhatsApp Web session; when a message is received, MCP POSTs to `{ORCHESTRATOR_INGEST_URL}/ingest/whatsapp-web` with body `provider`, `provider_message_id`, `client_phone_e164`, `text`, `ts_iso`, `raw_json` and header `x-internal-token: WA_WEB_INTERNAL_TOKEN`.
2. **Send:** Orchestrator calls `POST {MCP_GATEWAY_URL}/whatsapp/send` with body `to_phone_e164`, `text`, `conversation_id` and header `x-internal-token: MCP_INTERNAL_TOKEN`. MCP sends via WhatsApp Web and returns `provider_message_id`.
3. **Conversation IDs:** For WhatsApp Web, Orchestrator uses `wa_web_{digits}` (one channel per client phone). No Meta `phone_number_id` in the ID.
4. **First-time auth:** MCP needs a one-time QR scan (see runbook). Session is stored in `.wwebjs_auth` (Docker volume `gateway_wa_auth`).

## Rollback

To revert to Meta Cloud API you would need to restore the previous Orchestrator code (Meta webhook route and `whatsappSend` using Graph API), set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_ID` again, and remove or disable the WhatsApp Web client in the Gateway. DB schema and FSM logic are unchanged.
