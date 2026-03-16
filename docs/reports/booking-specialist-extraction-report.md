# Stage Report: booking-specialist-extraction

## 1. Goal

Выделить **Booking Specialist** в orchestrator как отдельный модуль, который:
- опирается на уже существующий детерминированный слой расписания и MCP‑инструменты,
- нормализует исходы booking‑доменa в `BookingSpecialistResult`,
- интегрируется в `agentProcessor` и `DecisionObject` **без изменения реального поведения** (пока только диагностически).

## 2. Scope

- Входит:
  - Orchestrator:
    - новый модуль `services/bookingSpecialist.ts`,
    - лёгкие корректировки типов в `types/contracts.ts`, `types/reasonCodes.ts`,
    - частичная интеграция в `services/agentProcessor.ts` и `services/decisionAssembler.ts`.
- Не входит:
  - Reschedule/Cancellation/Handoff Specialists,
  - изменения prompts и writer,
  - изменения gateway/wa-service/admin-ui,
  - переписывание booking‑flow (создание/валидация/Altegio) — они остаются как были.

## 3. Current booking flow findings

В ходе обзора найдены следующие элементы booking‑логики:

- **Deterministic Scheduling** (`deterministicScheduling.ts`):
  - Использует `crm.get_availability_for_date` в gateway для определения:
    - рабочий ли день,
    - есть ли слоты на запрошенный день,
    - есть ли слоты в ближайшие дни.
  - Возвращает `DeterministicResult` с:
    - `code` ∈ {`REQUESTED_DATE_NOT_OPEN`, `WORKING_TIME_VIOLATION`, `SLOTS_AVAILABLE`},
    - `alternativeSlots: string[]` (ISO),
    - `events` для `conversation_events`.
  - При `applied: true` сам отвечает клиенту (локализованными фразами) и завершает flow без LLM.

- **Booking context & FREE_SLOTS** (`bookingContext.ts` + `agentProcessor.ts`):
  - `getDatesToFetch(batchText)` — список дат (сегодня, завтра, и, при наличии, извлечённая дата).
  - В `processWithAiAgent`:
    - по staff/services вызывается `crm.get_free_slots` на эти даты,
    - результат собирается в массив `free_slots` и передаётся в LLM через `AiAgentContext.free_slots`.
  - FREE_SLOTS жёстко закреплены в system prompt и gateway валидации (слоты строго из списка).

- **Booking через LLM + MCP**:
  - `aiAgent.ts` описывает контракт `AiAgentOutput` (decision, confidence, reply_text, mcp_calls, handoff, tags).
  - В `agentProcessor.ts`:
    - после LLM‑ответа обрабатываются `mcp_calls`:
      - если `crm.create_appointment` не проходит — `booking_failed` + handoff,
      - если AI говорит «подтверждено», но create_appointment не вызван/неуспешен — `booking_not_confirmed_fallback` + handoff.

Вся эта логика уже работает и **не должна меняться** в этом этапе; цель — только выделить «booking‑срез» в отдельный specialist‑слой.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/deterministicScheduling.ts`
- `orchestrator/src/services/bookingContext.ts`
- `orchestrator/src/services/aiAgent.ts`
- `orchestrator/src/services/mcpClient.ts`
- `orchestrator/src/services/localization.ts`
- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/types/reasonCodes.ts`

## 5. New module created

### `orchestrator/src/services/bookingSpecialist.ts`

- **name**: `evaluateBooking`
- **purpose**:
  - изолировать доменную нормализацию статуса бронирования (booking domain) в одном месте,
  - не дублировать расчёт слотов, а опираться на:
    - результат детерминированного расписания `DeterministicResult`, если он есть,
    - уже вычисленный массив `free_slots`.
- **key inputs** (`BookingSpecialistInput`):
  - `intent: Intent` — текущий intent (BOOKING/...)
  - `deterministic?: DeterministicResult | null` — детерминированный результат, если он ещё доступен (в текущей интеграции передаётся `undefined`, потому что при `applied: true` flow завершается раньше).
  - `freeSlots: string[]` — объединённый список FREE_SLOTS, который уже собирается в `agentProcessor`.
- **key outputs**:
  - `BookingSpecialistResult` (см. раздел 6) с:
    - `status: SpecialistStatus`,
    - `domainStatus: BookingDomainStatus`,
    - `reasonCode: DecisionReasonCode`,
    - `suggestedAlternatives?: string[]`.
- **what existing logic it wraps/reuses**:
  - `Intent` и intent‑routing (сначала проверяется, что intent === 'BOOKING'),
  - `DeterministicResult`/`DETERMINISTIC_CODES` из `deterministicScheduling.ts` (если передан),
  - массив FREE_SLOTS (`free_slots`) уже собран в `agentProcessor`.

На текущем этапе `evaluateBooking` вызывается **после** FREE_SLOTS‑сборки, но его результат никак не изменяет поведение — он только попадает в `DecisionObject` skeleton и может логироваться.

## 6. Booking result model

### 6.1 BookingDomainStatus

В `types/contracts.ts` добавлен:

```ts
export type BookingDomainStatus =
  | 'missing_data'
  | 'exact_slot_available'
  | 'alternatives_only'
  | 'day_closed'
  | 'no_capacity'
  | 'needs_handoff'
  | 'execution_ready'
  | 'execution_blocked';
```

Он описывает **доменное** состояние бронирования, ортогональное к общему `SpecialistStatus`/`DecisionReasonCode`.

### 6.2 BookingSpecialistResult

Обновлён тип:

```ts
export interface BookingSpecialistResult {
  status: SpecialistStatus;        // 'ok' | 'needs_handoff' | 'needs_approval' | 'failed' | 'skipped'
  domainStatus: BookingDomainStatus;
  reasonCode: DecisionReasonCode;  // общий reason-код
  createdAppointmentId?: string;
  suggestedAlternatives?: string[]; // ISO datetimes
}
```

### 6.3 DecisionReasonCode

В `types/reasonCodes.ts` добавлены booking‑специфичные причины:

```ts
export type DecisionReasonCode =
  | 'ok'
  | 'booking_missing_data'
  | 'booking_exact_slot_available'
  | 'booking_alternatives_only'
  | 'booking_day_closed'
  | 'booking_no_capacity'
  | 'booking_execution_ready'
  | 'booking_execution_blocked'
  | 'low_confidence'
  | 'policy_denied_execute'
  | 'policy_denied_reply'
  | 'policy_denied_handoff'
  | 'ai_agent_failed'
  | 'booking_failed'
  | 'booking_not_confirmed'
  | 'fake_confirmation_blocked'
  | 'schedule_working_day_closed'
  | 'schedule_no_slots_on_requested_day'
  | 'schedule_slots_available'
  | 'handoff_requested_by_ai'
  | 'handoff_need_approval'
  | 'handoff_legacy'
  | 'handoff_manual'
  | 'client_force_handoff'
  | 'unknown';
```

### 6.4 Mapping внутри Booking Specialist

В `evaluateBooking` пока реализованы базовые сценарии:

- Если `intent !== 'BOOKING'`:
  - `status: 'skipped'`,
  - `domainStatus: 'missing_data'`,
  - `reasonCode: 'booking_missing_data'`.

- Если передан `deterministic` и `deterministic.applied`:
  - по `deterministic.code` и наличию `alternativeSlots`:
    - `SLOTS_AVAILABLE` → `domainStatus: 'exact_slot_available'`, `reasonCode: 'booking_exact_slot_available'`.
    - `WORKING_TIME_VIOLATION`:
      - `alternativeSlots.length>0` → `domainStatus: 'alternatives_only'`, `reasonCode: 'booking_alternatives_only'`;
      - иначе → `domainStatus: 'no_capacity'`, `reasonCode: 'booking_no_capacity'`.
    - `REQUESTED_DATE_NOT_OPEN` → `domainStatus: 'day_closed'`, `reasonCode: 'booking_day_closed'`.
  - `status: 'ok'`, `suggestedAlternatives: deterministic.alternativeSlots`.

- Если `deterministic` нет, но `freeSlots.length > 0`:
  - `status: 'ok'`,
  - `domainStatus: 'exact_slot_available'`,
  - `reasonCode: 'booking_exact_slot_available'`.

- Иначе:
  - `status: 'failed'`,
  - `domainStatus: 'missing_data'`,
  - `reasonCode: 'booking_missing_data'`.

Важно: сейчас `agentProcessor` передаёт в specialist `deterministic: undefined`, потому что при `applied: true` детерминированный слой уже завершает flow раньше. Тем не менее, модель позволяет в будущем передавать полный `DeterministicResult` при необходимости.

## 7. Changes in agentProcessor

В `services/agentProcessor.ts` изменения **минимальны** и не затрагивают реальный flow:

- Добавлен импорт:

```ts
import { evaluateBooking } from './bookingSpecialist';
```

- После получения результата LLM (`result`) и перед существующей обработкой:
  - в блоке, где строится DecisionObject skeleton, теперь:

```ts
let bookingResult;
if (intent === 'BOOKING') {
  bookingResult = evaluateBooking({
    intent,
    deterministic: undefined,
    freeSlots: free_slots
  });
}
const clientContext = buildClientContext({ ... });
decisionSkeleton = assembleDecisionSkeleton({
  scenario: routed,
  context: clientContext,
  policy: policyResult,
  fallbackLanguage: effectiveLang,
  bookingResult
});
```

- Старый booking‑flow (deterministicScheduling → FREE_SLOTS → LLM → MCP calls create_appointment, booking_failed/fallback/handoff) **остался без изменений**:
  - `evaluateBooking` не управляет reply/handoff/execute,
  - его результат только попадает в DecisionObject skeleton и может логироваться.

## 8. DecisionObject integration

- В `decisionAssembler.ts`:
  - `DecisionAssemblerInput` дополнен полем `bookingResult?: BookingSpecialistResult`,
  - `DecisionObject.bookingResult` теперь заполняется значением `bookingResult`, если оно передано.
- В `agentProcessor.ts`:
  - при вызове `assembleDecisionSkeleton(...)` в качестве `bookingResult` передаётся результат `evaluateBooking` **только при intent === 'BOOKING'**.
- Реальное принятие решения (RESPOND/HANDOFF/NEED_APPROVAL, mcp_calls, handoff) по‑прежнему опирается на текущую логику `agentProcessor` и LLM; `DecisionObject` служит «диагностическим слоем» для дальнейшего рефакторинга.

## 9. Compatibility notes

- MCP‑контракты (в т.ч. `crm.get_free_slots`, `crm.get_availability_for_date`, `crm.create_appointment`) **не изменялись**.
- `deterministicScheduling.ts` не менялся; по‑прежнему вызывается из `agentProcessor` до booking‑ветки LLM, и при `applied: true` завершает flow.
- FREE_SLOTS‑логика и system prompt не тронуты.
- `bookingSpecialist.ts` работает **только на данных**, уже вычисленных `agentProcessor` (intent, free_slots, потенциально deterministic result позже), и не вызывает новых MCP‑инструментов/DB‑операций.
- Никаких изменений в admin‑ui, wa-service, gateway не производилось.

## 10. Risks / open questions

- **Риск расхождения semantic уровня**:  
  Сейчас `BookingDomainStatus` и `DecisionReasonCode` описывают доменное состояние, но `agentProcessor` ещё не опирается на них при принятии решений. При будущей интеграции важно аккуратно совместить их с существующими ветками `booking_failed`/`fake_confirmation_blocked`/deterministicScheduling.

- **Вопрос о месте интеграции deterministic result**:  
  Пока specialist не получает `DeterministicResult` (из-за early‑return), поэтому часть маппинга к статусам `day_closed`/`no_capacity` не используется. В дальнейшем можно вызывать `evaluateBooking` **до** `return` из deterministic ветки, чтобы зафиксировать доменное состояние ещё в skeleton/событиях.

## 11. Next recommended step

- Использовать `BookingSpecialistResult` для:
  - генерации более структурированных `conversation_events` (например, `booking_exact_slot_available`, `booking_day_closed`),
  - постепенной интеграции с Writer/QA Guard (например, разные шаблоны ответа в зависимости от `domainStatus`),
  - принятия решений о handoff/approval на основе статусов `needs_handoff`/`execution_ready` (после их реальной реализации).

## 12. Diff summary

- **added**
  - `orchestrator/src/services/bookingSpecialist.ts` — новый Booking Specialist.
  - `docs/reports/booking-specialist-extraction-report.md` — данный отчёт.

- **modified**
  - `orchestrator/src/types/contracts.ts`:
    - добавлен `BookingDomainStatus`,
    - расширен `BookingSpecialistResult` (domainStatus).
  - `orchestrator/src/types/reasonCodes.ts`:
    - добавлены booking‑специфичные `DecisionReasonCode` (`booking_*`).
  - `orchestrator/src/services/decisionAssembler.ts`:
    - DecisionAssemblerInput и DecisionObject теперь включают опциональный `bookingResult`.
  - `orchestrator/src/services/agentProcessor.ts`:
    - интеграция `evaluateBooking(...)` и передача результата в `assembleDecisionSkeleton`.

- **untouched**
  - Детеминированный слой расписания,
  - FREE_SLOTS + LLM контекст,
  - MCP‑вызовы и booking‑ветки (create_appointment, booking_failed, fake_confirmation_blocked),
  - Writer, prompts, gateway/wa-service/admin-ui.

## 13. Validation

- `ReadLints` по изменённым/новым файлам — без ошибок.
- `npm test`/`npm run lint` (на доступном уровне) проходят без падений.
- Локальная структура типов согласована: `BookingDomainStatus` и новые `DecisionReasonCode` используются только в новых/обновлённых контрактах и specialist’е.
- Поведение booking runtime‑flow не изменилось: все решения по RESPOND/HANDOFF/CREATE_APPOINTMENT остаются в `agentProcessor` и gateway, а Booking Specialist пока играет роль нормализатора статусов и источника данных для DecisionObject.

---

## Appendix: Booking flow after extraction

Новый booking‑flow (с учётом только текущей частичной интеграции):

1. **Ingest + debounce** — без изменений.
2. **Scenario Router** (`routeScenario`) — классфицирует intent → BOOKING, язык, scenarioCode.
3. **Policy Specialist** (`evaluatePolicy`) — загружает политику для сценария `booking`, строит `safePolicy` и `DecisionPermissions`.
4. **Deterministic Scheduling** (`tryDeterministicSchedulingReply`) — если может сам ответить (день закрыт/нет слотов/есть слоты), отправляет системный ответ и **завершает flow** (как и раньше).
5. **FREE_SLOTS**:
   - при intent BOOKING/UNKNOWN и наличии staff/services:
     - orchestrator вызывает `crm.get_free_slots` на релевантные даты,
     - собирает массив `free_slots` и передаёт его в LLM‑контекст.
6. **LLM‑вызов** (`callAiAgent`) — полностью как раньше: учитывает FREE_SLOTS, KB, business hours.
7. **Client Context Resolver** (`buildClientContext`) — собирает `ClientContext` из:
   - `ConversationRow`,
   - последних сообщений,
   - `BehaviorOverride`,
   - KB‑блока,
   - списка предстоящих записей.
8. **Booking Specialist** (`evaluateBooking`):
   - если intent === BOOKING:
     - на текущем этапе использует только `freeSlots`,
     - определяет `BookingDomainStatus` и `DecisionReasonCode` (например, `exact_slot_available`),
     - возвращает `BookingSpecialistResult` (без выполнения MCP‑действий).
9. **Decision Assembler skeleton** (`assembleDecisionSkeleton`) — строит минимальный `DecisionObject`, включая:
   - `scenario`, `context`, `policy`,
   - `bookingResult` (из предыдущего шага),
   - пустой `actionPlan` и outcome `SKIP/unknown`.
   - объект логируется в debug и может быть использован для аналитики/будущих модулей.
10. **Основной booking‑runtime** — остаётся прежним:
    - анализ LLM‑результата,
    - policy/ confidence guards,
    - вызов `crm.create_appointment` при необходимости,
    - обработка `booking_failed` / `booking_not_confirmed_fallback`,
    - handoff при ошибках.

Таким образом, Booking Specialist уже вынесен и подключён к dispatcher‑ядру, но пока действует **как нормализующий слой статусов**, не меняя решений и поведения. Это создаёт безопасную базу для дальнейшего поэтапного переноса booking‑логики в specialist, когда будет готов следующий этап. 
