# Stage Report: internal-contracts-shared-types

## 1. Goal

Создать единый внутренний **shared contract / type layer** для orchestrator, чтобы все будущие модули (Scenario Router, Specialists, Decision Assembler, QA Guard) говорили на общей системе типов — без изменения внешних API (ingest, MCP/gateway, wa-service) и без большого рефакторинга `agentProcessor.ts`.

## 2. Scope

- Входит:
  - Orchestrator: `agentProcessor`, `scenarioPolicy`, `deterministicScheduling`, `bookingContext`, `aiAgent`, `mcpClient`, `handoff`, `conversationEvents`, `conversationReview`, `conversation`, `behaviorOverrides`.
  - Gateway: только в части понимания уже существующих структур (tools/slots), без изменения контракта `/mcp`.
  - Создание **нового слоя типов** в `orchestrator/src/types/`.
  - Минимальные type‑only импорты (без изменения поведения).
- Не входит:
  - Переписывание `agentProcessor`.
  - Изменение промптов, формата ответа LLM.
  - Изменение контрактов ingest (`/ingest/whatsapp-web`) и MCP (`/mcp`).
  - Логический рефакторинг gateway/wa-service/admin-ui.

## 3. Current type/structure findings

### Уже существующие структуры

- **Scenario / policies**
  - `Intent` в `services/intent.ts` (BOOKING/RESCHEDULE/CANCEL/...).
  - `ScenarioPolicy` в `services/scenarioPolicy.ts` (autonomy_mode, allow_agent_to_reply/execute/create_handoff, requires_admin_approval, confidence_threshold...).
  - Таблицы `scenarios`, `scenario_policies` привязаны к кодам `booking`, `reschedule`, `cancel`, `faq`, `complaint`, `refill_policy`, `pricing`, `late_arrival`, `unknown`.

- **Conversation / context**
  - `ConversationState` и `ConversationRow` в `services/conversation.ts`.
  - `BehaviorOverride` в `services/behaviorOverrides.ts`.
  - Контекст клиента в `agentProcessor.ts` собирается «вручную» из:
    - `conversations`,
    - `client_behavior_overrides`,
    - `conversation_messages` (через `getLastMessages`),
    - KB (`getKbContext`),
    - MCP (upcoming appointments).

- **Schedule / booking**
  - `deterministicScheduling.ts` использует объект с полями `status`, `requested_date`, `free_slots`, `alternativeSlots` (но без формальной type‑export).
  - `bookingContext.ts` уже умеет резолвить относительные даты (`resolveRelativeDate`, `extractDateFromMessage`).
  - gateway имеет хорошо определённые структуры для слотов (`WorkingSlot`, `computeFreeSlotStarts`, `validateSlot`), но orchestrator видит только результат MCP (`free_slots`, `working_hours_count`).

- **Handoff**
  - В `agentProcessor.ts` есть `HandoffContext` для обогащения `handoff_created` event (reason_code, confidence, decision, reply_text_preview, tags).
  - `handoff.ts` работает с `handoff_cases` и `pending_admin_actions` без общего интерфейса `HandoffPreparationResult`.

- **Decision / outcome**
  - `aiAgent.ts` описывает формат ответа LLM (decision, confidence, reply_text, mcp_calls, handoff, tags).
  - В `agentProcessor.ts` много string‑литералов для причин:
    - `ai_agent_failed`, `low_confidence`, `ai_handoff`, `need_approval`, `booking_failed`, `fake_confirmation_blocked`, `legacy_handoff`, …
  - Детальный «DecisionObject» отсутствует — решение собирается на лету в `agentProcessor`.

### Несогласованности

- Reason/статус‑коды используются как **разрозненные строки**:
  - в handoff‑контексте,
  - в conversation_events payload,
  - в детерминированном слое расписания.
- Нет единого типа для:
  - «клиентский контекст» (разные функции возвращают отдельные куски),
  - результатов специалистов (booking/reschedule/cancel),
  - итогового решения orchestration‑уровня.
- Некоторые типы (например, schedule status) описаны только имплицитно в коде, а не как публичные объединения/интерфейсы.

## 4. Files reviewed

- Orchestrator:
  - `src/services/agentProcessor.ts`
  - `src/services/scenarioPolicy.ts`
  - `src/services/deterministicScheduling.ts`
  - `src/services/bookingContext.ts`
  - `src/services/aiAgent.ts`
  - `src/services/mcpClient.ts`
  - `src/services/handoff.ts`
  - `src/services/conversation.ts`
  - `src/services/behaviorOverrides.ts`
  - `src/services/conversationEvents.ts`
  - `src/services/conversationReview.ts`
  - `src/services/localization.ts`
  - `src/services/intent.ts`
  - `src/prompts/aiAgentSystemPrompt.ts`

- Gateway:
  - `src/mcp/router.ts`
  - `src/mcp/tools/crm/*.ts` (особенно `getAvailabilityForDate`, `getFreeSlots`, `validateSlot`, `createAppointment`)
  - `src/altegio/slots.ts`

## 5. New shared contracts/types

Созданы **два файла типов** в orchestrator:

1. `orchestrator/src/types/reasonCodes.ts`
2. `orchestrator/src/types/contracts.ts`

Они не меняют поведение, но определяют общий словарь статусов и shape внутренних объектов.

### 5.1 `reasonCodes.ts`

- **name**: `DecisionReasonCode`
  - **purpose**: единый набор причин/статусов для итогов решений (booking, policy, schedule, handoff).
  - **key fields**: это string‑union:
    - `'ok'`
    - `'low_confidence'`
    - `'policy_denied_execute'`
    - `'policy_denied_reply'`
    - `'policy_denied_handoff'`
    - `'ai_agent_failed'`
    - `'booking_failed'`
    - `'booking_not_confirmed'`
    - `'fake_confirmation_blocked'`
    - `'schedule_working_day_closed'`
    - `'schedule_no_slots_on_requested_day'`
    - `'schedule_slots_available'`
    - `'handoff_requested_by_ai'`
    - `'handoff_need_approval'`
    - `'handoff_legacy'`
    - `'handoff_manual'`
    - `'client_force_handoff'`
    - `'unknown'`
  - **where it will be used**:
    - в будущем — в результирующих объектах специалистов (Booking/Reschedule/CancellationSpecialistResult),
    - в DecisionObject.outcome,
    - в `conversation_events` payload.

- **name**: `ScheduleStatus`
  - **purpose**: детализированный статус обработки расписания (Schedule Interpreter).
  - **key fields**: string‑union:
    - `'requested_date_resolved'`
    - `'working_day_closed'`
    - `'working_day_open'`
    - `'slots_available'`
    - `'no_slots_on_requested_day'`
    - `'alternative_slots_found'`
    - `'no_alternatives'`
  - **where it will be used**:
    - в `ScheduleInterpretationResult.status`,
    - в детерминированном слое расписания для логики и событий.

- **name**: `HandoffReasonCode`
  - **purpose**: единый словарь причин handoff (совместимый с HandoffContext в `agentProcessor.ts`).
  - **key fields**: string‑union:
    - `'ai_agent_failed' | 'low_confidence' | 'ai_handoff' | 'need_approval' | 'booking_failed' | 'fake_confirmation_blocked' | 'legacy_handoff' | 'manual_handoff' | 'policy_forced_handoff' | 'schedule_violation' | 'other'`
  - **where it will be used**:
    - в будущем — в `HandoffPreparationResult`,
    - в `conversation_events` (`handoff_created`),
    - в admin‑ui/Telegram summaries.

- **name**: `HandoffPriority`
  - **purpose**: базовый приоритет handoff‑кейса.
  - **key fields**: `'low' | 'normal' | 'high' | 'critical'`.
  - **where it will be used**:
    - в `HandoffPreparationResult`,
    - в `pending_admin_actions` и Telegram/админ‑списках.

### 5.2 `contracts.ts`

#### Scenario layer

- **name**: `ScenarioCode`
  - **purpose**: типизированный код сценария (отражает записи таблицы `scenarios` и `intentToScenarioCode`).
  - **key fields**: `'booking' | 'reschedule' | 'cancel' | 'faq' | 'complaint' | 'refill_policy' | 'pricing' | 'late_arrival' | 'unknown'`.
  - **where used**: во всех policy/decision структурах, где нужен сценарий.

- **name**: `ScenarioRouterResult`
  - **purpose**: результат работы Scenario Router.
  - **key fields**:
    - `intent: Intent` (существующий тип),
    - `scenarioCode: ScenarioCode`,
    - `confidence: number`,
    - `secondarySignals?: Record<string, unknown>`.
  - **where used**:
    - как часть `DecisionObject.scenario`,
    - вход для Policy Specialist и специалистов по сценариям.

- **name**: `ScenarioConfidence`
  - **purpose**: alias для `number`, чтобы явно обозначать confidence уровня сценария.

#### Client context layer

- **name**: `UpcomingAppointmentSummary`
  - **purpose**: агрегированное представление ближайших записей (упрощённая форма результата `admin.get_upcoming_appointments_by_phone`).
  - **key fields**:
    - `count: number`,
    - `nearestDate?: string`.

- **name**: `LastAppointmentSummary`
  - **purpose**: краткое описание последней записи клиента.
  - **key fields**:
    - `date?: string | null`,
    - `serviceName?: string | null`,
    - `staffName?: string | null`.

- **name**: `BehaviorOverrideSnapshot`
  - **purpose**: alias на уже существующий `BehaviorOverride | null`.

- **name**: `ConversationSnapshot`
  - **purpose**: «срез беседы» для Router/Decision.
  - **key fields**:
    - `row: ConversationRow`,
    - `lastMessages: Array<{ ts: string; from: 'client' | 'agent' | 'admin'; text: string }>`
    - `upcomingSummary?: UpcomingAppointmentSummary`,
    - `lastAppointment?: LastAppointmentSummary`.

- **name**: `ClientContext`
  - **purpose**: единый тип для всего, что известно о клиенте и диалоге на момент решения.
  - **key fields**:
    - `phoneE164: string`,
    - `conversation: ConversationSnapshot`,
    - `behaviorOverride: BehaviorOverrideSnapshot`,
    - `language: { detected: ResolvedLanguage; hint: string | null }`,
    - `kbContextSummary?: string`.
  - **where used**:
    - в будущем — вход почти всех specialists и Decision Assembler.

#### Schedule layer

- **name**: `DateResolution`
  - **purpose**: фиксирует, какой текст был резолвнут в какую дату/таймзону.
  - **key fields**:
    - `requestedText: string`,
    - `resolvedDate?: string`,
    - `timezone: string`.

- **name**: `TimePreference`
  - **purpose**: задел на описания предпочтений по времени (утро/вечер/конкретно).
  - **key fields**:
    - `rawText?: string`.

- **name**: `ScheduleInterpretationResult`
  - **purpose**: нормализованный результат работы Schedule Interpreter.
  - **key fields**:
    - `status: ScheduleStatus`,
    - `requestedDate: string`,
    - `timezone: string`,
    - `freeSlotsOnRequestedDay: string[]`,
    - `alternativeSlots: string[]`,
    - `alternativeDays: string[]`.

- **name**: `AmbiguityFlags`
  - **purpose**: флаги неоднозначности (дата/время).
  - **key fields**:
    - `dateAmbiguous?: boolean`,
    - `timeAmbiguous?: boolean`.

#### Booking / reschedule / cancellation layer

- **name**: `SpecialistStatus`
  - **purpose**: общий статус для специалистов.
  - **fields**: `'ok' | 'needs_handoff' | 'needs_approval' | 'failed' | 'skipped'`.

- **name**: `BookingSpecialistResult`
  - **fields**:
    - `status: SpecialistStatus`,
    - `reasonCode: DecisionReasonCode`,
    - `createdAppointmentId?: string`,
    - `suggestedAlternatives?: string[]`.

- **name**: `RescheduleSpecialistResult`
  - аналогично, с `rescheduledAppointmentId`.

- **name**: `CancellationSpecialistResult`
  - аналогично, с `approvalId?: string`.

Эти структуры пока **не внедрены** в текущую реализацию, но отражают ожидаемый интерфейс для будущих модулей.

#### Policy layer

- **name**: `DecisionPermissions`
  - **purpose**: нормализованный набор прав, выведенный из `ScenarioPolicy`.
  - **key fields**:
    - `canReply: boolean`,
    - `canExecuteMutating: boolean`,
    - `canCreateHandoff: boolean`,
    - `requiresAdminApproval: boolean`,
    - `confidenceThreshold: number`.

- **name**: `PolicyResult`
  - **purpose**: «Router + policy snapshot».
  - **key fields**:
    - `scenarioCode: ScenarioCode`,
    - `policy: ScenarioPolicy | null`,
    - `permissions: DecisionPermissions`.

- **name**: `ApprovalRequirement`
  - `'none' | 'required' | 'already_pending'`.

- **name**: `HandoffPermission`
  - **fields**:
    - `allowed: boolean`,
    - `reason?: string`.

#### Handoff layer

- **name**: `HandoffPreparationResult`
  - **purpose**: результат подготовки handoff (до записи в DB).
  - **key fields**:
    - `shouldHandoff: boolean`,
    - `reasonCode: HandoffReasonCode`,
    - `priority: HandoffPriority`,
    - `summary: string`,
    - `questionToAdmin: string`,
    - `tags?: string[]`.

#### Decision layer

- **name**: `ReplyPlan`
  - **fields**:
    - `text: string | null`,
    - `language: ResolvedLanguage`.

- **name**: `ExecutionPlan`
  - **fields**:
    - `mcpCalls: Array<{ tool: string; payload: Record<string, unknown>; mutating: boolean }>` — тонкая обёртка над тем, что сейчас приходит из `aiAgent`.

- **name**: `ActionPlan`
  - **fields**:
    - `reply: ReplyPlan`,
    - `execution: ExecutionPlan`,
    - `handoff?: HandoffPreparationResult | null`.

- **name**: `DecisionOutcomeType`
  - `'RESPOND' | 'HANDOFF' | 'NEED_APPROVAL' | 'SKIP'`.

- **name**: `DecisionOutcome`
  - **fields**:
    - `type: DecisionOutcomeType`,
    - `reasonCode: DecisionReasonCode`,
    - `confidence: number`.

- **name**: `DecisionObject`
  - **purpose**: финальный объект, описывающий, что произошло при обработке сообщения.
  - **fields**:
    - `scenario: ScenarioRouterResult`,
    - `context: ClientContext`,
    - `policy: PolicyResult`,
    - `schedule?: ScheduleInterpretationResult`,
    - `bookingResult?`, `rescheduleResult?`, `cancellationResult?`,
    - `actionPlan: ActionPlan`,
    - `outcome: DecisionOutcome`.

## 6. Reused existing structures

- **Intent / ScenarioPolicy / ConversationRow / BehaviorOverride / ResolvedLanguage**:
  - не переизобретались; в `contracts.ts` используются через `import type`.

- **Handoff reason codes**:
  - `HandoffReasonCode` основан на уже существующих строках из `HandoffContext` в `agentProcessor.ts` (`ai_agent_failed`, `low_confidence`, `ai_handoff`, `need_approval`, `booking_failed`, `fake_confirmation_blocked`, `legacy_handoff`).

- **Schedule status**:
  - `ScheduleStatus` согласован с текущими состояниями в `deterministicScheduling.ts` (`working_day_closed`, `slots_available`, `no_slots_on_requested_day`, `alternative_slots_found`).

- **DecisionOutcomeType**:
  - `'RESPOND' | 'HANDOFF' | 'NEED_APPROVAL'` взяты из текущего контракта LLM (`aiAgent.ts`), добавлен только `'SKIP'` для явного случая «ничего не делаем».

## 7. Compatibility notes

- Все новые типы:
  - живут в **новых файлах** `orchestrator/src/types/*`,
  - используются только как `type`‑импорты,
  - **не влияют на рантайм**.
- Формат JSON‑ответа LLM, MCP‑контракты и ingest‑конечные точки остались **неизменными**.
- Существующий код пока **не обязан** использовать новые типы — они подготовлены для постепенной миграции (future PRы могут заменять локальные интерфейсы на shared).

## 8. Risks / open questions

- **Риск: расхождение между кодом и типами**  
  Пока новые типы не подключены во всех местах, возможно частичное дублирование. Необходимо на следующих этапах постепенно заменять локальные интерфейсы на shared.

- **Уровень детализации DecisionObject**  
  DecisionObject сейчас богато описан; важно не перегрузить реальные реализации слишком сложным объектом. Возможно, часть полей останется опциональной.

- **Согласование reason codes**  
  Некоторые коды (`schedule_*`, `policy_*`) пока не используются явно в `conversation_events` и admин‑UI; потребуется согласование, какие из них пойдут в UI/аналитику.

## 9. Next recommended step

- Начать **тонкую интеграцию** новых типов в существующий код:
  - использовать `ScenarioCode`, `PolicyResult`, `DecisionPermissions` в `scenarioPolicy.ts` и `agentProcessor.ts` (только на уровне типов),
  - использовать `ScheduleInterpretationResult` в `deterministicScheduling.ts`,
  - использовать `HandoffPreparationResult` в `handoff.ts` и враппере над `createHandoffAndPauseWithSummary`.
- После этого можно двигаться к этапам **Scenario Router** и **Client Context Resolver**, опираясь уже на единый типовой язык.

## 10. Diff summary

- **added**
  - `orchestrator/src/types/reasonCodes.ts` — общий словарь reason/status codes.
  - `orchestrator/src/types/contracts.ts` — единый набор контрактов для scenario/context/schedule/specialists/policy/handoff/decision.
  - `docs/reports/internal-contracts-shared-types-report.md` (данный отчёт).

- **modified**
  - Нет изменений существующих модулей (кроме type‑import’ов, которые не влияют на рантайм).

- **untouched**
  - `agentProcessor.ts`, `aiAgent.ts`, MCP‑router gateway, ingest‑контракты, wa-service.

## 11. Validation

- Новые файлы типов проходят проверки линтера/TypeScript (нет ошибок в `ReadLints`).
- Внешние контракты и промпты не были изменены.
- Все новые типы соотносятся с уже существующими данными и строковыми кодами в repo, а не выдуманы в отрыве от реальной логики.

---

## Appendix: Proposed decision object shape

Ниже — рекомендуемая структура `DecisionObject` в терминах TypeScript (из `orchestrator/src/types/contracts.ts`):

```ts
export interface DecisionObject {
  scenario: ScenarioRouterResult;
  context: ClientContext;
  policy: PolicyResult;
  schedule?: ScheduleInterpretationResult;
  bookingResult?: BookingSpecialistResult;
  rescheduleResult?: RescheduleSpecialistResult;
  cancellationResult?: CancellationSpecialistResult;
  actionPlan: ActionPlan;
  outcome: DecisionOutcome;
}
```

Где:

- `ScenarioRouterResult` описывает intent + scenarioCode + confidence.
- `ClientContext` инкапсулирует срез беседы и поведения клиента.
- `PolicyResult` фиксирует, какие права и ограничения действуют.
- `ScheduleInterpretationResult` отражает детерминированный анализ дня/слотов.
- `Booking/Reschedule/CancellationSpecialistResult` дают статус соответствующих операций.
- `ActionPlan` определяет, **что именно будет сделано** (ответ, MCP‑вызовы, handoff).
- `DecisionOutcome` фиксирует тип решения (RESPOND/HANDOFF/NEED_APPROVAL/SKIP), причину и confidence.

Эта структура не внедрена целиком в текущий runtime, но задаёт общий «язык», на котором будут говорить будущие модули orchestrator без изменения внешних API.

