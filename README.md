## Altegio MCP Gateway (Docker, Node.js/TypeScript)

Local MCP HTTP gateway for Altegio CRM, with a strict allowlisted toolset, audit logging to Postgres, approval workflows, and idempotent apply operations.

### 1. Project Layout

- **docker-compose.yml**: Postgres, Redis, **wa-service** (WhatsApp only), **gateway** (MCP, no WhatsApp), Orchestrator.
- **wa-service/**: Standalone WhatsApp Web container (whatsapp-web.js). Forwards incoming messages to orchestrator ingest; exposes `/whatsapp/send` for orchestrator replies. Config from same DB (`admin_config`) or ENV.
- **gateway/**: Fastify + TypeScript MCP gateway (Altegio integration, availability, booking validation). Tools: `crm.*`, `admin.*`, `handoff.*`. No WhatsApp.
- **orchestrator/**: Ingest, debounce, AI, handoff; sends replies via **wa-service** (`WA_SEND_URL`).
- **db/migrations/**: SQL migrations (schema + seed approval policies + wa-service config keys).
- **api_docs/**: Offline Altegio API docs (reference only).

### 2. Prerequisites

- Docker / Docker Compose
- Node.js 20+ (optional, for local dev without Docker)

### 3. Configuration

Copy the example env file and adjust values:

```bash
cd api_altegio_mcp
cp .env.example .env
```

Key variables:

- **GATEWAY_PORT**: Gateway HTTP port (default `3030`). **WA_SERVICE_PORT**: wa-service port (default `3032`).
- **ADMIN_APPROVE_KEY**: Shared secret for admin approval + policy endpoints.
- **MCP_INTERNAL_TOKEN**: Shared secret for ingest (`/ingest/whatsapp-web`) and for wa-service `/whatsapp/send`. Set in orchestrator and in wa-service (ENV `WA_INTERNAL_TOKEN` or `admin_config` key `wa.internal_token`).
- **WA_SEND_URL**: (Orchestrator) URL of wa-service for sending replies (e.g. `http://wa-service:3032`). If unset, falls back to `MCP_GATEWAY_URL` for backward compatibility.
- **Postgres**: `POSTGRES_*` for all services.
- **Redis**: `REDIS_HOST`, `REDIS_PORT` (gateway).
- **Altegio** (gateway): `ALTEGIO_BASE_URL`, `ALTEGIO_API_VERSION`, `ALTEGIO_PARTNER_TOKEN`, `ALTEGIO_USER_TOKEN`.
- **wa-service**: `ORCHESTRATOR_INGEST_URL` (e.g. `http://orchestrator:3031`), `WA_INTERNAL_TOKEN` (= `MCP_INTERNAL_TOKEN`). Overridable via `admin_config`: `wa.orchestrator_ingest_url`, `wa.internal_token`.

### 4. Running with Docker

```bash
cd api_altegio_mcp
docker-compose up --build
```

This will:

- Start Postgres (migrations applied by gateway on first run).
- Start Redis.
- Start **wa-service** on `http://localhost:3032` (WhatsApp Web; scan QR at `GET /whatsapp/qr`).
- Build and start the **gateway** on `http://localhost:3030` (MCP, approvals, admin).
- Start **orchestrator** on `http://localhost:3031` (ingest, debounce, AI, sends replies via wa-service).

Health checks:

```bash
curl http://localhost:3030/health   # gateway
curl http://localhost:3032/health   # wa-service
```

Expected gateway: `{ "status": "ok", "db": "up" }`. Wa-service: `{ "status": "ok", "service": "wa-service" }`.

### 5. MCP HTTP API

The gateway exposes a single MCP endpoint for tools:

- **POST `/mcp`**

Payload:

```json
{
  "tool": "crm.search_clients",
  "params": { "query": "John", "limit": 10 },
  "idempotencyKey": "optional-key-for-writes",
  "approvalId": "required-for-some-apply-tools"
}
```

Response:

```json
{
  "ok": true,
  "tool": "crm.search_clients",
  "result": { "clients": [ /* ... */ ] }
}
```

Every `/mcp` call creates a row in `mcp_requests`. Any Altegio HTTP request made by tools is logged in `altegio_http_calls` with:

- Masked headers/bodies (no tokens or secrets).
- SHA256 hashes of raw payloads.
- Timing and status.

### 6. Allowlisted Tools (MVP)

**CRM**

- **`crm.search_clients`** (READ)
  - Params: `query?`, `phone?`, `email?`, `limit?`, `offset?`
- **`crm.search_appointments`** (READ)
  - Params: `date_from?`, `date_to?`, `client_id?`, `staff_id?`, `limit?`, `offset?`
- **`crm.reschedule_appointment`** (WRITE, no approval)
  - Params: `appointment_id`, `new_start_at` (ISO), `comment?`, `notify_client?`
- **`crm.cancel_appointment.plan`** (PLAN, delete-like)
  - Params: `appointment_id`, `reason?`, `notify_client?`
- **`crm.cancel_appointment.apply`** (APPLY, delete-like)
  - Params: same as plan
  - Requires:
    - `idempotencyKey` (always, for apply)
    - `approvalId` when policy `require_approval=true`

**Payroll**

- **`payroll.get_staff_calculations`** (READ)
  - Params: `staff_id?`, `date_from?`, `date_to?`, `page?`, `per_page?`
- **`payroll.compute_staff_salary`** (READ + compute)
  - Params: `staff_id`, `date_from`, `date_to`
- **`payroll.plan_apply_salary_result`** (PLAN)
  - Params: `payroll_run_id`, `staff_ids?[]`, `period_from`, `period_to`
- **`payroll.apply_salary_result`** (APPLY, delete-like)
  - Params: same as plan
  - Requires:
    - `idempotencyKey`
    - `approvalId` when policy `require_approval=true`

Any tool not explicitly registered in the router is rejected with `TOOL_NOT_ALLOWED` (deny-by-default).

### 7. Approval Flow

Delete-like actions (cancel, apply salary) use a two-phase flow:

1. **Plan phase**
   - Call the appropriate plan tool:
     - `crm.cancel_appointment.plan`
     - `payroll.plan_apply_salary_result`
   - Response includes:

   ```json
   {
     "action": "crm.cancel_appointment",
     "mode": "plan",
     "requireApproval": true,
     "approvalId": "UUID",
     "params": { /* ... */ },
     "preview": { /* for payroll plan */ }
   }
   ```

2. **Admin approval**

```bash
curl -X POST "http://localhost:3030/approvals/<approvalId>/approve" \
  -H "x-admin-approve-key: ${ADMIN_APPROVE_KEY}"
```

3. **Apply phase**

Call the corresponding apply tool with the **same business params**, plus `idempotencyKey` and `approvalId`:

```bash
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "crm.cancel_appointment.apply",
    "params": { "appointment_id": 123, "reason": "client request" },
    "idempotencyKey": "cancel-appointment-123-2025-01-01",
    "approvalId": "<approvalId-from-plan>"
  }'
```

If a policy’s `require_approval=false` for that action, plan/apply can be used without an approval, but `idempotencyKey` is still required for apply.

### 8. Policy Registry (Admin)

Admin endpoints are protected by `x-admin-approve-key` and **do not** expose raw tokens:

- **GET `/admin/policies`**

```bash
curl -H "x-admin-approve-key: ${ADMIN_APPROVE_KEY}" \
  http://localhost:3030/admin/policies
```

- **POST `/admin/policies/set`**

```bash
curl -X POST http://localhost:3030/admin/policies/set \
  -H "Content-Type: application/json" \
  -H "x-admin-approve-key: ${ADMIN_APPROVE_KEY}" \
  -d '{
    "action_key": "crm.cancel_appointment",
    "require_approval": false,
    "allowed_roles": ["admin"]
  }'
```

Each policy change is recorded as an `mcp_requests` row (tool `admin.policy.set`).

### 9. Auditing & Security

- **Deny by default**:
  - Only the explicitly implemented tools are reachable via `/mcp`.
  - No raw “call any Altegio endpoint” tool exists.
- **Authorization secrecy**:
  - Authorization headers are never logged in clear text.
  - Audit redactor masks `authorization`, `token`, `password`, etc.
- **Audit trail**:
  - `mcp_requests`: each tool call (request, response, status, duration).
  - `altegio_http_calls`: each Altegio HTTP call with masked bodies and SHA256 hashes.
  - `approvals`: plan/apply approval lifecycle.
  - `idempotency_keys`: ensures apply tools are idempotent.

### 10. Local Dev (Without Docker)

```bash
cd api_altegio_mcp/gateway
npm install
npm run build
NODE_ENV=development \
POSTGRES_HOST=localhost \
POSTGRES_PORT=5434 \
POSTGRES_DB=altegio_mcp \
POSTGRES_USER=altegio_mcp \
POSTGRES_PASSWORD=altegio_mcp_password \
ALTEGIO_BASE_URL=https://api.alteg.io \
ALTEGIO_API_VERSION=b2b-v1 \
ALTEGIO_PARTNER_TOKEN=xxx \
ALTEGIO_USER_TOKEN=yyy \
ADMIN_APPROVE_KEY=please-change-me \
node dist/src/server.js
```

You can run a tiny smoke test for the health route:

```bash
cd api_altegio_mcp/gateway
npm install
npm test
```

### 11. Cursor MCP Config Snippet

Example Cursor MCP server configuration for this gateway (HTTP transport):

```json
{
  "mcpServers": {
    "altegio-mcp-gateway": {
      "command": "npx",
      "args": [
        "mcp-http",
        "--url",
        "http://localhost:3030/mcp"
      ]
    }
  }
}
```

Adjust the URL/port as needed. The MCP client should send tool invocations as POSTs to `/mcp` with the JSON structure described above.

