# Как проследить путь сообщения: WhatsApp → ИИ → ответ

После добавления логов по цепочке можно проверить, на каком шаге сообщение теряется.

## Ожидаемая последовательность в логах

1. **wa-service** (когда клиент пишет в WhatsApp):
   - `WhatsApp: forwarding to orchestrator` (clientPhoneE164, textLen)
   - `WhatsApp: forwarded to orchestrator ok`

2. **Orchestrator** (сразу после приёма):
   - `Ingest: enqueueing for agent` (conversationId, clientPhone, textPreview)
   - `Debounce: first message, timer started` (conversationId, debounceMs)

3. **Orchestrator** (через ~20 сек по умолчанию):
   - `Debounce: firing batch` (conversationId, messageCount)
   - `ProcessBatch: starting` (conversationId, clientPhone, batchSize)
   - далее либо ответ ИИ, либо `WhatsApp send failed`, либо `Handoff` и т.д.

## Если ответа нет — где смотреть

| Что видите в логах | Где искать причину |
|--------------------|---------------------|
| В wa-service нет «forwarding to orchestrator» | Сообщение не доходит до wa-service (WhatsApp Web) или не то событие (например, группа, fromMe). |
| Есть «forwarding», нет «forwarded ok» (есть «Forward to orchestrator failed») | Ошибка при вызове оркестратора: 401 (токен), 400 (тело), сеть. Смотреть status и body в логах wa-service. |
| В Orchestrator нет «Ingest: enqueueing» | Запрос не доходит или отклонён (401/400). Проверить MCP_INTERNAL_TOKEN и ALLOWED_PHONE_LIST. |
| Есть «Ingest: enqueueing», нет «Debounce: first message» | Не должно быть: enqueue вызывается сразу после этой строки. |
| Есть «timer started», через 20 сек нет «firing batch» | Перезапуск оркестратора обнуляет in-memory таймеры; сообщения, уже в очереди, не обрабатываются. Написать новое сообщение после старта. |
| Есть «ProcessBatch: starting», потом «bot should not respond (state)» | Диалог не в состоянии BOT_ACTIVE (например AWAITING_ADMIN). |
| Есть «ProcessBatch: starting», ответа нет и нет «WhatsApp send failed» | ИИ вернул HANDOFF/пустой reply или ошибка при вызове ИИ. Смотреть логи на ошибки и решение (decision). |

## Команды для проверки

```bash
# Логи wa-service (последние сообщения и пересылка в оркестратор)
docker logs altegio_mcp_wa_service --tail 50 2>&1 | grep -E 'forwarding|forwarded|Forward to orchestrator failed'

# Логи Orchestrator (приём и очередь)
docker logs altegio_mcp_orchestrator --tail 100 2>&1 | grep -E 'Ingest: enqueueing|Debounce:|ProcessBatch:'

# Полный хвост
docker logs altegio_mcp_wa_service --tail 30
docker logs altegio_mcp_orchestrator --tail 50
```

## Диалог в AWAITING_ADMIN — как вернуть ответы ИИ

Если в логах видно `ProcessBatch: bot should not respond (state), skip` и `state: "AWAITING_ADMIN"`, диалог передан админу и бот намеренно не отвечает. Чтобы ИИ снова отвечал в этом чате:

**Вариант 1 — скрипт (из корня проекта):**
```bash
./scripts/resume-chat.sh +4367762665083
```

**Вариант 2 — curl:**
```bash
source .env  # или подставьте свой MCP_INTERNAL_TOKEN
curl -X POST http://localhost:3031/admin/resume \
  -H "Content-Type: application/json" \
  -H "x-internal-token: $MCP_INTERNAL_TOKEN" \
  -d '{"client_phone_e164":"+4367762665083"}'
```

**Вариант 3 — Telegram-бот:** в личку боту отправьте `/resume +4367762665083` (номер в E.164).

После успешного вызова состояние станет `BOT_ACTIVE`, следующие сообщения в этот чат снова будет обрабатывать ИИ.

---

## Частые причины

- **ALLOW_ONLY_LISTED_PHONES=true** и номер отправителя не в **ALLOWED_PHONE_LIST** → в ingest после сохранения будет «Phone not in ALLOWED_PHONE_LIST», в очередь не попадёт.
- **MCP_INTERNAL_TOKEN** в оркестраторе и **WA_INTERNAL_TOKEN** в wa-service не совпадают → 401, в wa-service «Forward to orchestrator failed» со status 401.
- Оркестратор перезапущен после того, как сообщение уже попало в debounce → таймер сброшен, батч не вызывается; нужно отправить новое сообщение.
