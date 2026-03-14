# Orchestrator + Telegram Admin Runbook

## Start the stack

```bash
cd api_altegio_mcp
cp .env.example .env   # then set TELEGRAM_BOT_TOKEN, TG_LOGS_GROUP_CHAT_ID, TG_SUMMARY_GROUP_CHAT_ID, etc.
docker-compose up --build
```

- **Gateway**: http://localhost:3030 (health: `curl http://localhost:3030/health`)
- **Orchestrator**: http://localhost:3031 (health: `curl http://localhost:3031/health`)

Migrations (including 004_orchestrator) are applied by the Gateway on startup. The orchestrator uses the same Postgres DB.

## WhatsApp (via MCP – WhatsApp Web)

WhatsApp is **no longer** received via Meta Cloud API. The **MCP Gateway** runs a WhatsApp Web session (whatsapp-web.js) and:

- Forwards incoming messages to Orchestrator: `POST /ingest/whatsapp-web`
- Exposes `POST /whatsapp/send` for the Orchestrator to send replies

Set `MCP_INTERNAL_TOKEN` (same value as Gateway’s `WA_WEB_INTERNAL_TOKEN`). First-time auth requires scanning a QR code from the Gateway (see **docs/WA_WEB_RUNBOOK.md** for QR auth, reconnect, and troubleshooting).

## Telegram bot token and group chat IDs

1. **Bot token**: Create a bot via [@BotFather](https://t.me/BotFather), then set in `.env`:
   - `TELEGRAM_BOT_TOKEN=<token>`

2. **Group chats** (optional but recommended):
   - **Logs group** (errors, ADMIN_ONLY pings, MCP failures): Create a group, add the bot, get its chat id (e.g. use @userinfobot or get updates from API). Set in `.env`: `TG_LOGS_GROUP_CHAT_ID=<chat_id>`.
   - **Summary group** (handoff summaries, reminders): Same steps. Set `TG_SUMMARY_GROUP_CHAT_ID=<chat_id>`.

3. **DB override**: You can store chat IDs in `admin_config` instead of ENV:
   - `telegram.logs_group_chat_id` (value_json: string)
   - `telegram.summary_group_chat_id` (value_json: string)

4. **Admin allowlist**: Add Telegram user IDs to the `telegram_admins` table (only these users can use admin commands):

   ```sql
   INSERT INTO telegram_admins (telegram_user_id, display_name, is_enabled) VALUES (123456789, 'Admin', true);
   ```

## Test Telegram admin commands (private chat with bot)

All commands require the user to be in `telegram_admins`. Use E.164 for phone (e.g. `+43123456789`).

| Command | Example | Expected behavior |
|--------|--------|-------------------|
| `/takeover +43...` | `/takeover +43123456789` | Sets conversation state to ADMIN_TAKEOVER for that phone; bot stops replying. |
| `/resume +43...` | `/resume +43123456789` | Sets state to BOT_ACTIVE; bot resumes. |
| `/pause +43...` | `/pause +43123456789` | Sets state to BOT_PAUSED; bot does not reply. |
| `/ignore +43... [IGNORE\|ADMIN_ONLY] [reason]` | `/ignore +43123456789 ADMIN_ONLY` | Adds phone to ignore list (store only, or ADMIN_ONLY = store + ping logs group). |
| `/unignore +43...` | `/unignore +43123456789` | Removes phone from ignore list. |
| `/status +43...` | `/status +43123456789` | Shows conversation state, last 10 messages, pending actions. |
| `/case <case_id>` | `/case abc-uuid` | Shows handoff case summary and question. |
| `/rules +43...` | `/rules +43123456789` | Shows client behavior overrides for that phone. |
| `/setrule +43... key=value` | `/setrule +43123456789 force_handoff=true` | Sets override (e.g. language_preference, tone_profile, force_handoff, notes_for_agent). |
| `/approve <approval_id>` | `/approve uuid` | Calls MCP approval endpoint and marks pending action DONE. |
| `/reject <approval_id>` | `/reject uuid` | Rejects via MCP and marks pending action DONE. |

If the user is not in `telegram_admins`, the bot replies "Not authorized."

## WhatsApp flow (MCP WhatsApp Web)

1. User sends a message in WhatsApp → MCP Gateway (WhatsApp Web client) receives it and POSTs to Orchestrator `POST /ingest/whatsapp-web` with `provider`, `client_phone_e164`, `text`, `ts_iso`, etc.
2. Orchestrator persists the message, upserts the conversation (`wa_web_*`), and enqueues for debounce.
3. After the debounce window (configurable, default ~20s), the batch is processed: ignore list → conversation state → business hours → handoff triggers or MCP CRM call → reply or handoff case + pause message.
4. To send a reply, Orchestrator calls Gateway `POST /whatsapp/send` with `to_phone_e164`, `text`, `conversation_id`; Gateway sends via WhatsApp Web.
5. Outside business hours (default 08:00–20:00 Europe/Vienna), the client receives the polite “We are available 08:00–20:00…” message and the conversation can be set to AWAITING_ADMIN.

## Operational config (DB)

All operational parameters can be overridden in `admin_config` (DB overrides ENV). See migration `004_orchestrator.sql` for keys (e.g. `business_hours.*`, `whatsapp.debounce_ms`, `admin_reminder.*`, `telegram.logs_group_chat_id`, `telegram.summary_group_chat_id`).
