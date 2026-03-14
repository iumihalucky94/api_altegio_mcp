# План изоляции WhatsApp в отдельный контейнер

## Цель

Полностью вынести WhatsApp Web в **независимый контейнер** (`wa-service`), чтобы:
- ничто внутри gateway (MCP, Altegio, rate limit, тяжёлые запросы) не могло помешать работе WhatsApp;
- один процесс = только WhatsApp Web + минимальный HTTP API;
- конфигурация по-прежнему в **той же БД** (`admin_config`);
- связка с оркестратором сохраняется: ingest (wa → orchestrator), send (orchestrator → wa), debounce и логика без изменений.

---

## Целевая архитектура

```
                    ┌─────────────────────────────────────────────────────────┐
                    │  wa-service (новый контейнер)                           │
                    │  - whatsapp-web.js (единственный тяжёлый процесс)        │
                    │  - HTTP: GET /health, GET /whatsapp/qr, POST /whatsapp/send │
                    │  - При message → POST orchestrator/ingest/whatsapp-web  │
                    │  - Конфиг: Postgres (admin_config), fallback ENV         │
                    └──────────────────┬──────────────────────────────────────┘
                                       │
         ingest (сообщения от клиента) │ send (ответы от бота)
         POST /ingest/whatsapp-web     │ POST /whatsapp/send
                                       ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │  orchestrator                                           │
                    │  - Приём ingest, debounce, processBatch, AI, handoff     │
                    │  - Отправка ответа: WA_SEND_URL/whatsapp/send           │
                    └─────────────────────────────────────────────────────────┘
                                       │
         MCP (инструменты Altegio)     │
         POST /mcp                     ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │  gateway (без WhatsApp)                                 │
                    │  - Health, MCP, approvals, admin policies               │
                    │  - Никакого whatsapp-web.js, никакого Chromium           │
                    └─────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────────────────────────┐
                    │  Postgres (общая БД)                                     │
                    │  - admin_config (конфиги для gateway, orchestrator, wa)  │
                    │  - mcp_requests, conversations, handoff, etc.           │
                    └─────────────────────────────────────────────────────────┘
```

---

## Шаги реализации

### 1. Новый сервис `wa-service` (репозиторий/папка)

- **Расположение:** `wa-service/` в корне проекта (рядом с `gateway/`, `orchestrator/`).
- **Стек:** Node 20, TypeScript, Fastify (минимально), `whatsapp-web.js`, `pg`, `dotenv`, `zod`.
- **Зависимости только:** то, что нужно для WA Web и для чтения конфига из БД. Без Redis, без Altegio, без MCP router.

**Структура (минимальная):**

```
wa-service/
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-entrypoint.sh   # очистка Chromium lock (как в gateway)
└── src/
    ├── server.ts           # Fastify, health + routes, init WA client
    ├── config.ts           # ENV + чтение admin_config (ingest URL, token)
    ├── waClient.ts         # перенос логики из gateway/src/whatsapp/waWebClient.ts
    └── routes/
        └── whatsapp.ts     # GET /whatsapp/qr, POST /whatsapp/send
```

**Конфиг из БД (та же `admin_config`):**

- Ключи (с fallback на ENV):
  - `wa.orchestrator_ingest_url` → URL оркестратора для ingest (например `http://orchestrator:3031`).
  - `wa.internal_token` → секрет для `x-internal-token` (то же значение, что `MCP_INTERNAL_TOKEN` у оркестратора).
- При старте и периодически (или по TTL) читать из `admin_config`; если в БД нет — брать из ENV `ORCHESTRATOR_INGEST_URL`, `WA_INTERNAL_TOKEN`.

**Поведение:**

- При событии `message` от whatsapp-web.js — формировать payload как сейчас и делать `POST {orchestrator_ingest_url}/ingest/whatsapp-web` с заголовком `x-internal-token`. Формат тела не меняется (provider, client_phone_e164, text, ts_iso, provider_message_id).
- `GET /whatsapp/qr` — отдать QR если есть (защита опционально по `x-internal-token`).
- `POST /whatsapp/send` — тело `{ to_phone_e164, text, conversation_id? }`, проверка `x-internal-token`, вызов `sendWaWebMessage`, ответ `{ ok, provider_message_id }`.
- `GET /health` — лёгкая проверка (процесс жив; опционально проверка БД для конфига).

**Docker:**

- Свой Dockerfile на базе `node:20-bookworm-slim` с установкой Chromium (аналог текущего gateway), `PUPPETEER_EXECUTABLE_PATH`, один volume для сессии: `wa_service_auth:/app/.wwebjs_auth`.
- Порт: например **3032** (отдельный от gateway 3030 и orchestrator 3031).

---

### 2. Изменения в gateway

- **Удалить:**
  - из `server.ts`: импорты и вызовы `registerWhatsAppRoutes`, `initWaWebClient`; из env-схемы — `ORCHESTRATOR_INGEST_URL`, `WA_WEB_INTERNAL_TOKEN`;
  - папку `gateway/src/whatsapp/` (или весь код из `waWebClient.ts` перенесён в wa-service);
  - файл `gateway/src/routes/whatsapp.ts`;
  - из `package.json` зависимость `whatsapp-web.js`;
  - из Dockerfile gateway — установку Chromium и связанные ENV (если в gateway больше ничего не использует Puppeteer);
  - из `docker-compose.yml` для сервиса gateway: volume `gateway_wa_auth`, переменные `ORCHESTRATOR_INGEST_URL`, `WA_WEB_INTERNAL_TOKEN`.
- **Оставить:** Health, MCP, approvals, admin policies, Postgres, Redis, конфиг из БД — всё без изменений логики.

---

### 3. Изменения в orchestrator

- **Конфиг отправки в WhatsApp:** сейчас используется `MCP_GATEWAY_URL` + путь `/whatsapp/send`. Нужно ввести отдельный URL для отправки в wa-service:
  - Добавить переменную окружения **`WA_SEND_URL`** (например `http://wa-service:3032`).
  - В `whatsappSend.ts`: если задан `WA_SEND_URL`, использовать его для `POST /whatsapp/send`; иначе fallback на `MCP_GATEWAY_URL` (обратная совместимость).
  - В `config` оркестратора при инициализации занести дефолт из env (как для других URL).
- **Ingest:** без изменений. Wa-service сам будет слать запросы на `http://orchestrator:3031/ingest/whatsapp-web` (значение из своей конфигурации в БД/ENV). Токен для ingest в wa-service берётся из той же БД/ENV (`wa.internal_token` = `MCP_INTERNAL_TOKEN`).
- Debounce, processBatch, логика диалогов и handoff не трогаем.

---

### 4. Docker Compose

- **Новый сервис `wa-service`:**
  - build: `./wa-service`, свой Dockerfile.
  - depends_on: `postgres` (для конфига). От оркестратора зависит только по сетевым вызовам (ingest/send), в `depends_on` при необходимости можно добавить `orchestrator` для порядка старта.
  - env_file: `.env`.
  - environment: `POSTGRES_HOST=postgres`, `POSTGRES_PORT=5432`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `ORCHESTRATOR_INGEST_URL=http://orchestrator:3031`, `WA_INTERNAL_TOKEN=${MCP_INTERNAL_TOKEN}`, `WA_SERVICE_PORT=3032`.
  - volumes: `wa_service_auth:/app/.wwebjs_auth`.
  - ports: `3032:3032` (при необходимости).
- **Gateway:** убрать volume `gateway_wa_auth`, переменные `ORCHESTRATOR_INGEST_URL`, `WA_WEB_INTERNAL_TOKEN`.
- **Orchestrator:** добавить в environment: `WA_SEND_URL=http://wa-service:3032`.
- **Volumes:** заменить `gateway_wa_auth` на `wa_service_auth` (для wa-service). Если ранее сессия WA была в `gateway_wa_auth`, нужно один раз решить: перенести данные в новый volume или начать с нового скана QR в wa-service.

---

### 5. База данных и конфигурация

- Таблица **`admin_config`** уже общая. Добавить ключи для wa-service (через миграцию или вручную):
  - `wa.orchestrator_ingest_url` — URL оркестратора (например `"http://orchestrator:3031"`).
  - `wa.internal_token` — секрет (в продакшене не хранить в миграции в открытом виде; задать через env или позже через admin API).
- Wa-service при старте: подключение к Postgres, чтение этих ключей; кэш с TTL (например 30–60 сек), чтобы не дергать БД на каждый входящий запрос. Для отправки в оркестратор использовать сконфигурированный ingest URL и token.

---

### 6. Безопасность и изоляция

- **Сеть:** wa-service общается только с orchestrator (ingest — исходящие, send — входящие от orchestrator) и с Postgres. С gateway wa-service не общается.
- **Токен:** один и тот же секрет для ingest (orchestrator проверяет `x-internal-token`) и для send (wa-service проверяет `x-internal-token`). Значение из БД/ENV (`wa.internal_token` = `MCP_INTERNAL_TOKEN`).
- **Ресурсы:** в контейнере wa-service не запускаются ни MCP, ни Altegio, ни очереди gateway — только процесс Node + Chromium для WhatsApp Web. Падение или нагрузка на gateway не затрагивают WhatsApp.

---

### 7. Сохранение текущего поведения (debounce, коммуникация)

- **Ingest:** формат тела и заголовки не меняются. Wa-service шлёт те же поля, что и раньше шёл gateway. Orchestrator продолжает принимать `POST /ingest/whatsapp-web` и класть сообщения в очередь debounce.
- **Send:** оркестратор по-прежнему вызывает один раз на ответ `POST {WA_SEND_URL}/whatsapp/send` с телом и токеном. Меняется только целевой хост (wa-service вместо gateway).
- **Debounce:** остаётся в оркестраторе, параметры `whatsapp.debounce_ms` и др. в БД/конфиге оркестратора — без изменений.
- **Состояния диалога, handoff, ignore list:** всё в оркестраторе и БД; wa-service не участвует в этой логике.

---

### 8. Чек-лист перед завершением

- [ ] Сервис `wa-service` поднимается, отдаёт /health, по QR авторизуется WhatsApp Web.
- [ ] Сообщение из WhatsApp доходит до wa-service → ingest в orchestrator → появляется в логах оркестратора и в debounce.
- [ ] Ответ от оркестратора уходит в wa-service (`POST /whatsapp/send`) и доставляется в WhatsApp.
- [ ] Конфиг wa-service (ingest URL, token) читается из `admin_config` с fallback на ENV.
- [ ] В gateway нет кода и зависимостей WhatsApp, нет volume для WA auth.
- [ ] Orchestrator использует `WA_SEND_URL` для отправки в wa-service; при отсутствии — fallback на `MCP_GATEWAY_URL`.
- [ ] Документация (README, TRACE_MESSAGE_FLOW, runbook) обновлена: указан отдельный контейнер wa-service и новые переменные окружения.

---

### 9. Переменные окружения (сводка)

| Сервис        | Переменная                   | Назначение |
|---------------|------------------------------|------------|
| wa-service    | `ORCHESTRATOR_INGEST_URL`    | URL для POST /ingest/whatsapp-web (fallback если нет в БД) |
| wa-service    | `WA_INTERNAL_TOKEN`          | Секрет для ingest и для проверки POST /whatsapp/send (fallback из БД) |
| wa-service    | `POSTGRES_*`                 | Подключение к общей БД для чтения `admin_config` |
| wa-service    | `WA_SERVICE_PORT`            | Порт HTTP (по умолчанию 3032) |
| orchestrator  | `WA_SEND_URL`                | URL wa-service для отправки ответов (например `http://wa-service:3032`) |
| orchestrator  | `MCP_INTERNAL_TOKEN`         | Тот же секрет; оркестратор шлёт его в `x-internal-token` при вызове WA_SEND_URL |
| gateway       | —                            | Убрать ORCHESTRATOR_INGEST_URL, WA_WEB_INTERNAL_TOKEN |

После выполнения плана WhatsApp будет полностью изолирован в отдельном контейнере, с сохранением коммуникации с оркестратором, debounce и единой БД для конфигурации.
