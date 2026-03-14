# WhatsApp Web (MCP) Runbook

## Overview

WhatsApp traffic is handled by the **MCP Gateway** using [whatsapp-web.js](https://wwebjs.dev/). The Gateway maintains a browser session (Puppeteer + Chromium), receives incoming messages, forwards them to the Orchestrator at `POST /ingest/whatsapp-web`, and exposes `POST /whatsapp/send` for the Orchestrator to send replies. No Meta Cloud API or public webhook is used.

## Prerequisites

- **Gateway** must have `ORCHESTRATOR_INGEST_URL` and `WA_WEB_INTERNAL_TOKEN` set (e.g. in `.env` or Docker Compose).
- **Orchestrator** must have `MCP_GATEWAY_URL` and `MCP_INTERNAL_TOKEN` (same value as `WA_WEB_INTERNAL_TOKEN`).
- Session data is stored in `.wwebjs_auth` (in Docker: volume `gateway_wa_auth`). Persist this volume so you don’t have to scan the QR after every restart.

---

## First-time setup: QR authentication

1. Start the stack so the Gateway (and thus the WhatsApp Web client) starts:
   ```bash
   docker-compose up -d gateway orchestrator
   ```
2. Wait for the client to emit a QR code (check Gateway logs for “WhatsApp Web: scan QR code”).
3. Get the QR payload (e.g. for a script or a simple HTML page that renders it):
   ```bash
   curl -s -H "x-internal-token: YOUR_MCP_INTERNAL_TOKEN" http://localhost:3030/whatsapp/qr
   ```
   Response is either `204 No Content` (already logged in) or `200` with `{ "qr": "<base64 or string>" }`. Use the `qr` value with any QR decoder or render it as an image (e.g. data URL) and open on your phone.
4. Open **WhatsApp** on your phone → **Linked devices** → **Link a device** and scan the QR code.
5. After a successful scan, the client emits “WhatsApp Web client ready” and `GET /whatsapp/qr` returns 204. The session is saved in `.wwebjs_auth`; next restarts will reuse it (no new QR unless the session is invalidated).

**Note:** The `/whatsapp/qr` endpoint is protected by `x-internal-token`. Use the same value as `MCP_INTERNAL_TOKEN` / `WA_WEB_INTERNAL_TOKEN`.

---

## Reconnect and session loss

- **Normal restart:** If the volume `gateway_wa_auth` (or local `.wwebjs_auth`) is intact, the client should restore the session and not show a new QR.
- **Session invalidated** (e.g. “Logged out” from phone, or WhatsApp forced disconnect): You will need to scan the QR again. Restart the Gateway so it re-initializes; when a new QR appears, use `GET /whatsapp/qr` and scan as in the first-time setup.
- **“Disconnected” in logs:** Check Gateway logs for `WhatsApp Web disconnected` and the reason. Often a restart and, if needed, a new QR scan resolves it.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| **Orchestrator never receives messages** | 1) Gateway logs: is “WhatsApp Web client ready” present? 2) Is `ORCHESTRATOR_INGEST_URL` correct and reachable from the Gateway container (e.g. `http://orchestrator:3031`)? 3) Is `WA_WEB_INTERNAL_TOKEN` set and equal to `MCP_INTERNAL_TOKEN` on the Orchestrator? 4) Orchestrator logs for errors on `POST /ingest/whatsapp-web` (e.g. 401 if token mismatch). |
| **Orchestrator sends but user doesn’t get reply** | 1) Orchestrator logs: does the call to `POST /whatsapp/send` succeed? 2) Gateway logs: any errors when sending? 3) Is the recipient number in E.164 (e.g. `+43...`)? 4) Is the WhatsApp Web session still “ready” (no disconnect)? |
| **Gateway fails to start / Puppeteer error** | 1) In Docker, the Gateway image must include Chromium (see Gateway Dockerfile). 2) If you run Gateway locally, install Chromium (or use `PUPPETEER_EXECUTABLE_PATH` to point to your Chrome/Chromium binary). 3) Check for “WhatsApp Web init failed” in Gateway logs. |
| **"WhatsApp Web init failed" / profile in use** | After container restart, Chromium lock files can block startup. The Gateway entrypoint removes them. Rebuild and restart gateway, then check logs for "WhatsApp Web client ready". |
| **QR never appears / client stuck** | 1) Ensure `ORCHESTRATOR_INGEST_URL` and `WA_WEB_INTERNAL_TOKEN` are both set so the WhatsApp Web client is actually started. 2) Delete `.wwebjs_auth` (or the Docker volume) and restart to force a fresh session and a new QR. 3) Check for auth or network errors in Gateway logs. |
| **401 on /ingest/whatsapp-web** | Orchestrator expects `x-internal-token` (or `Authorization: Bearer <token>`) to match `MCP_INTERNAL_TOKEN`. Ensure Gateway sends the same token it uses for `WA_WEB_INTERNAL_TOKEN`. |
| **401 on /whatsapp/send** | Orchestrator must send `x-internal-token: MCP_INTERNAL_TOKEN` when calling the Gateway. Ensure `MCP_INTERNAL_TOKEN` is set and matches Gateway’s `WA_WEB_INTERNAL_TOKEN`. |

---

## Endpoints (Gateway)

- **POST /whatsapp/send**  
  Body: `{ "to_phone_e164": "+...", "text": "...", "conversation_id": "..." }`.  
  Header: `x-internal-token: <WA_WEB_INTERNAL_TOKEN>`.  
  Returns: `{ "ok": true, "provider_message_id": "..." }` or 503 if WhatsApp Web is not ready.

- **GET /whatsapp/qr**  
  Header: `x-internal-token: <WA_WEB_INTERNAL_TOKEN>`.  
  Returns: 204 when already authenticated, or 200 with `{ "qr": "..." }` when a QR is pending.

These endpoints are for **internal** use (Orchestrator or ops). Do not expose them publicly without authentication.

---

## Security

- Keep `MCP_INTERNAL_TOKEN` / `WA_WEB_INTERNAL_TOKEN` secret and use a strong value.
- In production, ensure Gateway → Orchestrator and Orchestrator → Gateway traffic is on a private network (e.g. Docker network) and that `/whatsapp/send` and `/whatsapp/qr` are not exposed to the internet without proper auth.
