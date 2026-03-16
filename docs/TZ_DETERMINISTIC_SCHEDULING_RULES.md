# ТЗ: Детерминированные правила расписания (working days, requested date/time)

## Цель

Вынести проверку **рабочего дня**, **рабочего времени** и **валидности requested date/time** из LLM-решения в **детерминированный business-rule слой**. Ответы, основанные на этих правилах, не должны зависеть от confidence threshold и не должны приводить к generic low-confidence fallback или handoff.

---

## Контекст проблемы

Сейчас, если пользователь просит запись:
- на нерабочий день,
- на время вне рабочих часов,
- на слот, в который услуга не помещается,

система может уйти в low-confidence / handoff или дать размытый ответ.  
Требуется: **однозначное управляемое поведение** на уровне кода, без делегирования этих проверок LLM.

---

## Требования

### 1. Детерминированный разбор requested date/time

Реализовать deterministic parsing относительных выражений на поддерживаемых языках (минимум: русский, немецкий, английский), например:

- завтра / послезавтра  
- tomorrow / day after tomorrow  
- morgen / übermorgen  
- в понедельник / next Monday / nächsten Montag  

На выходе: **абсолютная дата**; при наличии — requested time; использовать timezone салона как default source of truth.

### 2. Проверка доступности requested date/time

Источник правды по расписанию (приоритет): расписание мастера/услуги из CRM → расписание салона → fallback config.

Проверять детерминированно:
- рабочий ли день;
- рабочее ли время;
- доступен ли слот;
- помещается ли услуга в доступное окно;
- допустимо ли выполнение услуги в этот день/время.

### 3. Controlled response codes

Коды для deterministic scheduling outcomes:

- `REQUESTED_DATE_NOT_OPEN`
- `WORKING_DAY_VIOLATION`
- `WORKING_TIME_VIOLATION`
- `SERVICE_DOES_NOT_FIT_SLOT`
- `ALTERNATIVE_SLOTS_OFFERED`

Использовать в логике ответа, в conversation_events, в дебаге и аудите.

### 4. Поведение при недоступной requested date/time

Если requested date/time недоступны по deterministic rules, система обязана:
- вернуть controlled response code;
- не уходить в generic low-confidence fallback;
- не создавать handoff только по причине этой недоступности;
- подобрать ближайшие альтернативные слоты на следующие рабочие дни;
- отправить клиенту локализованный ответ через existing localization layer.

Ответ — шаблонный / code-driven, не свободная генерация LLM.

### 5. Confidence threshold

- **Не применять** confidence threshold к deterministic scheduling replies.
- Ответы вида «в этот день салон закрыт / это время недоступно / вот ближайшие альтернативы» отправляются независимо от low confidence.
- Высокий confidence threshold сохраняется только для **mutating actions**: создание/перенос/отмена записи и другие state-changing CRM actions.

### 6. Execution boundary

Deterministic layer может: валидировать requested date/time, объяснять недоступность, предлагать альтернативы.  
Deterministic layer **не должен** автоматически выполнять booking mutation без отдельного подтверждения и без прохождения существующих policy / execution checks.

### 7. Интеграция в текущий flow

В orchestrator / agentProcessor (или выделенном модуле) шаг **до** финального LLM-response / execution:
- resolve relative date/time;
- validate requested date/time against business rules;
- при violation — подобрать alternatives;
- сформировать localized deterministic reply;
- отправить reply без handoff и без suppression by confidence.

### 8. Event logging

События в conversation_events:
- `relative_date_resolved`
- `requested_datetime_validated`
- `working_day_violation`
- `working_time_violation`
- `alternative_slots_found`
- `deterministic_reply_sent`

---

## Проверка «есть ли вообще окно»

Orchestrator не запрашивает у gateway списки мастеров/услуг для этой проверки. Вместо этого вызывается один инструмент gateway: **`crm.get_availability_for_date`** (company_id, date). Gateway сам определяет, какого мастера и какую услугу использовать (первый из API или из конфига DEFAULT_STAFF_ID / DEFAULT_SERVICE_ID), и возвращает `free_slots` и `working_hours_count`. По ним orchestrator решает: день закрыт, есть слоты, или нет слотов, но день рабочий — и отвечает детерминированно.

---

## Реализация (кратко)

- **Парсинг дат:** `orchestrator/src/services/bookingContext.ts` — `resolveRelativeDate()`, `extractDateFromMessage()`.
- **Gateway:** `gateway/src/mcp/tools/crm/getAvailabilityForDate.ts` — один инструмент `crm.get_availability_for_date` (company_id, date); внутри gateway — list_staff/list_services, при необходимости DEFAULT_STAFF_ID/DEFAULT_SERVICE_ID, затем расписание и слоты.
- **Детерминированный слой:** `orchestrator/src/services/deterministicScheduling.ts` — `tryDeterministicSchedulingReply()` только с companyId (без staff_id/service_id), вызовы `crm.get_availability_for_date`, подбор альтернатив по дням, формирование ответа.
- **Локализация:** `orchestrator/src/services/localization.ts` — ключи `requested_date_not_open`, `working_time_violation`, `working_time_violation_no_slots`, `alternative_slots_intro`.
- **Интеграция:** в `processWithAiAgent()` перед вызовом LLM: при intent BOOKING/UNKNOWN и наличии staff/services вызывается `tryDeterministicSchedulingReply()`; при `applied: true` отправляется ответ, пишутся события, выход без вызова AI и без handoff.
- **События:** все перечисленные типы пишутся через `appendConversationEvent()` при срабатывании deterministic layer.
