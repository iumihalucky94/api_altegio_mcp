## MCP Gateway — протокол и команды (v1)

Этот документ описывает **как внешний ИИ‑агент должен общаться** с MCP‑шлюзом Altegio, какие есть **инструменты (tools)** и какие правила нужно соблюдать.

---

### 1. Транспорт и формат запросов

- **HTTP endpoint**: `POST http://localhost:3030/mcp`
- **Content-Type**: `application/json`
- MCP **не** думает сам — он только:
  - валидирует входные данные,
  - проверяет политики/approval,
  - делает вызовы в Altegio,
  - логирует всё в Postgres.

Рекомендуется **всегда** использовать **envelope‑формат**.

#### 1.1. Request Envelope

```json
{
  "request_id": "b9f0c5ba-7c2a-4f22-9ce3-9b1d7b8a1234",
  "actor": {
    "agent_id": "whatsapp-admin-bot",
    "role": "agent"
  },
  "company_id": 1169276,
  "tool": "crm.list_appointments",
  "intent": "list_appointments_for_date",
  "dry_run": false,
  "payload": {
    "company_id": 1169276,
    "date": "2026-02-27"
  },
  "conversation_id": "whatsapp:49176...",
  "client_phone": "4367762665083",
  "locale": "ru"
}
```

Поля:

- **request_id**: обязательный UUID/строка, сквозной ID запроса.
- **actor.agent_id / actor.role**: кто вызывает MCP (для аудита).
- **company_id**: ID филиала Altegio.
- **tool**: имя MCP‑инструмента (см. список ниже).
- **intent**: произвольное текстовое описание намерения (для логов).
- **dry_run**:
  - `true` — только симуляция (где возможно), без реального изменения;
  - `false` — реальное выполнение.
- **payload**: параметры конкретного инструмента.
- **conversation_id / client_phone / locale**: опциональный контекст диалога.

> MCP также поддерживает «старый» формат `{ tool, params, idempotencyKey, approvalId }`, но для интеграции ИИ‑агента рекомендуется **envelope**.

#### 1.2. Response Envelope

```json
{
  "request_id": "b9f0c5ba-7c2a-4f22-9ce3-9b1d7b8a1234",
  "audit_id": "8d46b761-206e-4cc7-a134-e772c3a0a99b",
  "decision": "ALLOW",
  "result": {
    "...": "tool-specific result"
  },
  "actions": [],
  "policy_reason": null,
  "error": null,
  "next_steps": []
}
```

Поля:

- **request_id**: тот же, что и в запросе.
- **audit_id**: UUID строки в `mcp_requests` (для аудита/разбора ошибок).
- **decision**:
  - `"ALLOW"` — операция допущена и выполнена/просимулирована,
  - `"NEED_APPROVAL"` — нужна админ‑апрув,
  - `"NEED_HUMAN"` — требуется ручной разбор, ИИ должен вызвать handoff,
  - `"DENY"` — запрещено политикой или ошибкой.
- **result**: структура результата конкретного инструмента.
- **error**: либо `null`, либо объект:

  ```json
  {
    "code": "VALIDATION_ERROR",
    "message": "string",
    "details": {}
  }
  ```

- **next_steps**: подсказки MCP, что делать дальше (например, `APPROVE`).

---

### 2. Семантика решений (decision)

ИИ‑агент обязан следовать этим правилам:

- **ALLOW**
  - Можно продолжать диалог, использовать данные из `result`.
  - Если `dry_run=true`, считать, что операция **не меняла** Altegio.

- **NEED_APPROVAL**
  - MCP вернёт, например:

    ```json
    "next_steps": [
      { "type": "APPROVE", "approval_id": "uuid-..." }
    ]
    ```

  - Дальше логика такая:
    1. Остановиться.
    2. Попросить человека‑админа одобрить (вне MCP).
    3. После одобрения вызвать соответствующий **apply‑tool** с:
       - `approval_id`,
       - `idempotency_key`.

- **NEED_HUMAN**
  - Нельзя пытаться «угадывать» или перебирать варианты.
  - Нужно:
    1. Остановиться.
    2. Вызвать `handoff.create_case` с контекстом.
    3. Ждать решения человека.

- **DENY**
  - Операция запрещена. Никаких обходов/альтернатив для той же цели через другие инструменты.

---

### 3. Таксономия ошибок (error.code)

Допустимые значения:

- `VALIDATION_ERROR`
- `MULTIPLE_CLIENTS_FOUND`
- `CLIENT_NOT_FOUND`
- `APPOINTMENT_NOT_FOUND`
- `POLICY_DENY`
- `APPROVAL_REQUIRED`
- `APPROVAL_INVALID`
- `RATE_LIMIT`
- `UPSTREAM_ALTEGIO_ERROR`
- `INTERNAL_ERROR`

ИИ‑агент **не должен** придумывать другие значения `code`.

Рекомендуемая реакция:

- `VALIDATION_ERROR` — исправить payload и повторить.
- `MULTIPLE_CLIENTS_FOUND` — уточнить у пользователя (или вызвать `handoff.create_case`).
- `CLIENT_NOT_FOUND` — сообщить, что клиент не найден, предложить создать/уточнить.
- `APPOINTMENT_NOT_FOUND` — проверить ID и дату.
- `POLICY_DENY` / `APPROVAL_REQUIRED` / `APPROVAL_INVALID` — без человека продолжать нельзя.
- `RATE_LIMIT` — подождать и повторить.
- `UPSTREAM_ALTEGIO_ERROR` — сообщить об ошибке Altegio, предложить повторить позже.
- `INTERNAL_ERROR` — кратко извиниться, предложить повторить или вызвать `system.explain_error`.

---

### 4. Обязательные правила для ИИ‑агента

- Использовать **только** перечисленные ниже инструменты.
- Не запрашивать «сырые» Altegio‑эндпоинты.
- Для **опасных операций** (отмены, salary apply) всегда идти через:
  - `*.plan` → ручной апрув → `*.apply` с `idempotency_key`.
- Не пытаться обойти `DENY` через другие инструменты.
- При `NEED_HUMAN` **обязан** использовать `handoff.create_case`.

---

### 5. System tools

#### 5.1 `system.get_capabilities`

- **Назначение**: узнать список доступных tools и конфиг.
- **Payload (payload в envelope)**:

```json
{}
```

- **Важно**: всегда использовать этот метод при стартовой инициализации ИИ‑агента, чтобы понять, какие инструменты разрешены.

#### 5.2 `system.explain_error`

- **Назначение**: объяснить ошибку по `audit_id` или запросу.
- **Payload**:

```json
{ "audit_id": "uuid" }
```

Использовать, когда:

- есть `INTERNAL_ERROR`,
- или другой неочевидный код,
- и нужно подсказать пользователю, что делать (переформулировать запрос, предоставить данные и т.д.).

---

### 6. Conversation & Handoff

#### 6.1 `conversation.append_messages`

- **Назначение**: складировать историю WhatsApp в БД MCP.
- **Payload**:

```json
{
  "conversation_id": "string",
  "client_phone": "string",
  "messages": [
    {
      "ts": "2026-02-27T15:00:00Z",
      "direction": "in",
      "author": "client",
      "text": "Хочу записаться на 3D",
      "locale": "ru",
      "metadata": {
        "platform": "whatsapp"
      },
      "id": "wa-msg-123"   // опционально, но желательно
    }
  ]
}
```

Правила:

- Если есть `id` — дедупликация по `(conversation_id, id)`.
- Если `id` нет — дедупликация по `(conversation_id, ts, direction, hash(text))`.
- Есть лимиты на общий размер текста — не слать «сырые» длинные логи.

#### 6.2 `handoff.create_case`

- **Назначение**: переключить диалог в ручной режим (админ/оператор).
- **Payload**:

```json
{
  "conversation_id": "string",
  "client_phone": "string",
  "client_name": "string|null",
  "language": "ru",
  "last_messages": [
    { "ts": "2026-02-27T15:00:00Z", "from": "client", "text": "Хочу отменить бронь" },
    { "ts": "2026-02-27T15:01:00Z", "from": "agent", "text": "Сейчас проверю детали" }
  ],
  "summary": "Клиент хочет отменить запись, есть штрафы — требуется решение администратора",
  "question_to_admin": "Отменять ли запись без штрафа?",
  "related_audit_ids": ["uuid-..."]
}
```

Использовать:

- при `decision = "NEED_HUMAN"`,
- при неоднозначных ситуациях (несколько клиентов, конфликтующие политики, финансовые споры и т.п.).

---

### 7. CRM / Admin инструменты

#### 7.1 `crm.search_clients`

- **Назначение**: поиск клиентов в Altegio.
- **Payload**:

```json
{
  "company_id": 1169276,
  "quick_search": "65083",
  "page": 1,
  "page_size": 25
}
```

#### 7.2 `crm.list_staff`

- **Назначение**: получить список мастеров/сотрудников.
- **Payload**:

```json
{ "company_id": 1169276 }
```

#### 7.3 `crm.list_appointments`

- **Назначение**: получить список записей на день.
- **Payload**:

```json
{
  "company_id": 1169276,
  "date": "2026-02-27"
}
```

#### 7.4 `crm.create_appointment`

- **Назначение**: создать запись.
- **Рекомендация**: до вызова:
  - найти клиента (`crm.search_clients`),
  - выбрать мастера (`crm.list_staff`),
  - подобрать услугу (`crm.list_services`).

Payload (типовой):

```json
{
  "company_id": 1169276,
  "staff_id": 2661925,
  "service_id": 11976334,
  "datetime": "2026-03-20T10:00:00+01:00",
  "client_phone": "4367762665083",
  "client_name": "Тест тестович",
  "comment": "3D новый сет"
}
```

#### 7.5 `crm.reschedule_appointment`

- **Назначение**: перенести запись (если поддерживается Altegio API).
- **Payload**:

```json
{
  "appointment_id": 634852200,
  "new_start_at": "2026-03-20T10:00:00+01:00",
  "comment": "Перенос по просьбе клиента",
  "notify_client": true
}
```

> В текущей конфигурации конкретный эндпоинт Altegio может возвращать 404. В таком случае ИИ должен использовать `admin.update_appointment_services` (см. ниже) для изменения даты/услуги.

#### 7.6 `crm.list_services`

- **Назначение**: получить каталог услуг.
- **Payload**:

```json
{ "company_id": 1169276 }
```

ИИ‑агент может фильтровать по `title` (например, искать `"3D | Light | Neue-Set"`).

#### 7.7 `admin.update_client`

- **Назначение**: изменить имя/фамилию/телефон клиента.
- **Payload**:

```json
{
  "company_id": 1169276,
  "client_id": 164462181,
  "name": "Тест",
  "surname": "тестович",
  "phone": "4367762665083"
}
```

#### 7.8 `admin.update_appointment_services`

- **Назначение**: изменить запись через `PUT /record`:
  - время (`datetime`),
  - мастера (`staff_id`),
  - услуги (`service_ids`),
  - длительность (`seance_length`),
  - базовые параметры клиента (phone/name).

- **Пример** — кейс, который уже используется:

```json
{
  "company_id": 1169276,
  "appointment_id": 634852200,
  "service_ids": [11976334],                 // 3D | Light | Neue-Set
  "datetime": "2026-03-20T10:00:00+01:00",  // перенести с 15:00 на 10:00
  "staff_id": 2661925,                      // Adel
  "client_phone": "4367762665083",
  "client_name": "Тест тестович",
  "seance_length": 7200                     // 2 часа
}
```

> Внутри MCP это трансформируется в корректное тело для Altegio `/record/{location_id}/{record_id}` с полями `services[{id, first_cost, discount, cost}]`, `staff_id`, `client{phone,name}` и т.д.

#### 7.9 `admin.get_upcoming_appointments_by_phone`

- **Назначение**: получить ближайшие записи клиента по телефону.
- **Payload**:

```json
{
  "phone": "4367762665083",
  "from_date": "2026-02-27",
  "limit": 5
}
```

Особенности:

- Если найдено **>1 клиента** → `error.code = "MULTIPLE_CLIENTS_FOUND"`, `decision = "NEED_HUMAN"`.
- Если не найдено → `CLIENT_NOT_FOUND`.

---

### 8. Cancel flow (отмена записи)

Отмена всегда двухфазная и **всегда требует approval**:

1. **`admin.cancel_appointment_plan`** (или `crm.cancel_appointment.plan`)  
   Payload:

   ```json
   {
     "appointment_id": 634852200,
     "reason": "Клиент не может прийти",
     "requested_by": "client"
   }
   ```

   Ответ:

   ```json
   {
     "decision": "NEED_APPROVAL",
     "result": {
       "approval_id": "uuid-...",
       "impact_summary": "...",
       "client_message_suggestion": "..."
     },
     "next_steps": [
       { "type": "APPROVE", "approval_id": "uuid-..." }
     ]
   }
   ```

2. **Админ‑апрув** (вне MCP‑tools, HTTP):

   ```bash
   curl -X POST "http://localhost:3030/approvals/<approval_id>/approve" \
     -H "x-admin-approve-key: ${ADMIN_APPROVE_KEY}"
   ```

3. **`admin.cancel_appointment_apply`** (или `crm.cancel_appointment.apply`)

   Payload:

   ```json
   {
     "approval_id": "uuid-...",
     "idempotency_key": "cancel-634852200-2026-02-27"
   }
   ```

   MCP гарантирует идемпотентность по `idempotency_key`.

---

### 9. Payroll инструменты (кратко)

Используются для расчёта/применения зарплаты:

- `payroll.get_staff_calculations` — чтение расчётов из Altegio.
- `payroll.compute_staff_salary` — расчёт на стороне MCP (без записи).
- `payroll.plan_apply_salary_result` / `payroll.apply_salary_result` — двухфазное применение начислений (с approval и idempotency).

Для ИИ‑агента важно:

- Не вызывать `apply` без предварительного `plan` + ручного approval.
- Всегда использовать `idempotency_key` для `apply`.

---

### 10. Admin / Policy / Audit (для человека, не для ИИ)

Эти HTTP‑эндпоинты **не должны** вызываться обычным ИИ‑агентом без явного указания:

- `GET /admin/policies` — просмотреть политики.
- `POST /admin/policies/set` — изменить политику (delete‑like операции).
- `POST /approvals/{id}/approve` — одобрить опасное действие.

Все они требуют заголовок:

```http
x-admin-approve-key: <ADMIN_APPROVE_KEY>
```

---

### 11. Рекомендованный рабочий цикл для внешнего ИИ‑агента

1. При старте:
   - вызвать `system.get_capabilities`,
   - сохранить список tools и их risk_level / requires_approval.
2. Для каждого пользовательского запроса:
   - собрать `McpEnvelopeRequest` (request_id, actor, company_id, tool, payload, context),
   - отправить в `/mcp`,
   - анализировать `decision` и `error.code`,
   - при необходимости:
     - `NEED_APPROVAL` → не выполнять действие, дождаться approval, потом вызвать соответствующий `*.apply`,
     - `NEED_HUMAN` → вызывать `handoff.create_case`,
     - `INTERNAL_ERROR` → при необходимости вызвать `system.explain_error`.
3. Не выходить за рамки этого протокола.

