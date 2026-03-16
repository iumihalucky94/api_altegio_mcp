# Stage Report: full-architecture-cutover

## 1. Goal

Перевести orchestrator на новую модульную архитектуру как на primary runtime flow, так чтобы:
- основная логика обработки AI-ветки шла через dispatcher core → specialists → DecisionObject → writer → QA → execution/handoff,
- старые разрозненные решения внутри `agentProcessor` стали либо использовать новые модули, либо остались только как чётко ограниченные fallback-пути,
- при этом не ломались существующие интеграции (ingest, MCP/gateway, wa-service, admin-ui) и сохранялась наблюдаемость.

## 2. Scope

В этом этапе:
- зафиксирован текущий cutover на новую архитектуру, реализованный в предыдущих этапах (dispatcher core, specialists, writer/QA, DecisionObject enrichment, diagnostics),
- `agentProcessor` фактически работает как orchestration shell, который:
  - вызывает Scenario Router, Policy Specialist, Client Context Resolver, детерминированный слой,
  - использует Booking/Reschedule/Cancellation/Handoff specialists для нормализации статусов,
  - формирует DecisionObject через Decision Assembler и обогащает его reply/handoff/execution/writer/QA,
  - продолжает выполнять MCP и handoff через существующие совместимые слои,
  - записывает `decision_object_enriched` для admin-ui и review.

Примечание: дополнительные крупные refactors в этом этапе не выполнялись сознательно, так как целевой orchestration-пайплайн уже реализован и используется, а дальнейшие изменения должны быть постепенными и безопасными.

## 3. Starting point

До этого этапа уже было сделано:

- **Модульный dispatcher core**:
  - `scenarioRouter.ts` — intent/scenario routing, язык.
  - `clientContext.ts` — построение `ClientContext` (снимок беседы, язык, overrides, KB summary).
  - `policySpecialist.ts` — загрузка и нормализация `ScenarioPolicy`, расчёт `DecisionPermissions`.
  - `decisionAssembler.ts` — создание skeleton `DecisionObject`.
- **Specialists**:
  - `bookingSpecialist.ts` — нормализация booking outcome.
  - `rescheduleSpecialist.ts` — нормализация reschedule outcome.
  - `cancellationSpecialist.ts` — нормализация cancellation outcome.
  - `handoffSpecialist.ts` — нормализация handoff preparation (`HandoffPreparationResult`).
- **Writer / QA**:
  - `writer.ts` — выбор финального текста на основе policy и `reply_text`.
  - `replyQaGuard.ts` — базовый validation слой (язык, forbidden phrases, пустые ответы, unsafe confirmation diag).
- **DecisionObject enrichment**:
  - `DecisionObject` включает:
    - scenario, context, policy,
    - booking/reschedule/cancellation specialist results,
    - `ActionPlan.reply`, `ActionPlan.handoff`, `ActionPlan.execution`,
    - `outcome`,
    - writer/replyQa metadata.
- **Diagnostics / persistence / admin-ui**:
  - `decisionDiagnostics.ts` — запись `decision_object_enriched` в `conversation_events`.
  - admin-ui:
    - decision snapshot блок (scenario/policy/specialists/outcome/reply/handoff/writer/QA),
    - execution subset (mcpCalls tool/mutating/status/note),
    - review flow с подсказкой смотреть decision snapshot.
- **Booking execution pilot**:
  - `ActionPlan.execution.mcpCalls` заполняется в RESPOND-ветке, когда выполняются MCP-вызовы (особенно `crm.create_appointment`), со статусами `executed`/`skipped`/`failed`.

Оставалось:
- убедиться, что этот модульный пайплайн реально является primary runtime flow (а не только enrichment),
- задокументировать оставшиеся legacy-compatible пути и fallback-ветки.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/scenarioRouter.ts`
- `orchestrator/src/services/clientContext.ts`
- `orchestrator/src/services/policySpecialist.ts`
- `orchestrator/src/services/decisionAssembler.ts`
- `orchestrator/src/services/bookingSpecialist.ts`
- `orchestrator/src/services/rescheduleSpecialist.ts`
- `orchestrator/src/services/cancellationSpecialist.ts`
- `orchestrator/src/services/handoffSpecialist.ts`
- `orchestrator/src/services/writer.ts`
- `orchestrator/src/services/replyQaGuard.ts`
- `orchestrator/src/services/decisionDiagnostics.ts`
- `orchestrator/src/services/deterministicScheduling.ts`
- `orchestrator/src/services/bookingContext.ts`
- admin-ui views (`events.ejs`, `reviews.ejs`, `review-add.ejs`)

## 5. Architectural cutover strategy

Выбран путь эволюционного cutover:

- **Primary path**:
  - уже реализованный модульный пайплайн, который:
    - в AI-ветке использует Scenario Router, Policy Specialist, deterministic scheduling, specialists, DecisionObject, Writer, QA Guard,
    - управляет RESPOND/HANDOFF/NEED_APPROVAL с учётом policy и deterministic правил.
- **Fallback path**:
  - non-AI legacy path (при отсутствии API key),
  - ограниченные fallback-ветки (например, generic handoff/ack, booking_failed/booking_not_confirmed_fallback),
  - остаются как safety net и совместимость.

Почему это безопасно:
- основной runtime уже давно работает через новые модули и был последовательно обогащён,
- fallback path-ы не переписаны, но используются только в чётко определённых условиях (нет API key, ошибки AI/MCP, policy запрещает действия и т.п.),
- диагностика и admin-ui уже проверены на новых данных.

## 6. Major code changes

В этом этапе **существенных** новых изменений в коде не вносилось; cutover достигнут предыдущими этапами. Здесь фиксируем архитектурную картину:

- **Dispatcher core usage**:
  - `agentProcessor`:
    - использует `routeScenario` для определения `intent`, `scenarioCode`, языка, effectiveLang.
    - использует `evaluatePolicy` для получения `PolicyResult` и `DecisionPermissions`.
    - строит `ClientContext` через `buildClientContext`.
    - создаёт `DecisionObject` skeleton через `assembleDecisionSkeleton`.
- **Specialist integration**:
  - В AI-ветке:
    - Booking/Reschedule/Cancellation Specialists вызываются в зависимости от `intent` и их результаты записываются в `DecisionObject`.
    - Handoff Specialist используется в low-confidence, HANDOFF, NEED_APPROVAL ветках для нормализации `HandoffPreparationResult`, которое кладётся в `ActionPlan.handoff` и влияет на outcome (HANDOFF/NEED_APPROVAL).
- **DecisionObject usage**:
  - После вызова AI и MCP:
    - `DecisionObject.actionPlan.reply` заполняется финальным текстом и языком (Writer + QA).
    - `ActionPlan.handoff` заполняется HandoffPreparationResult в handoff-related ветках.
    - `ActionPlan.execution.mcpCalls` заполняется в booking path как executed mirror MCP-вызовов.
    - `DecisionObject.outcome` обновляется в RESPOND/HANDOFF/NEED_APPROVAL ветках, отражая финальное решение и confidence.
    - Snapshot сохраняется через `persistDecisionSnapshot`.
- **Writer/QA pipeline**:
  - RESPOND-ветка:
    - Writer формирует базовый текст с учётом policy/`reply_text`.
    - Reply QA Guard проверяет язык/запрещённые фразы/пустоту и может заменить текст на safest fallback.
    - Writer/QA метаданные записываются в `DecisionObject.writer` и `DecisionObject.replyQa`.
- **Handoff flow normalization**:
  - `HandoffPreparationResult` используется:
    - для low-confidence,
    - для AI-инициированного HANDOFF,
    - для NEED_APPROVAL сценариев,
  - и сохраняется в `DecisionObject.actionPlan.handoff` + outcome, а фактический handoff storage/Telegram-handling остаются в `handoff.ts`.
- **Execution plan changes**:
  - Booking pilot:
    - execution subset отражает статус `crm.create_appointment` и других MCP-вызовов как часть `ActionPlan.execution`.
- **Diagnostics preservation**:
  - `decision_object_enriched` события сохраняются,
  - admin-ui их отображает (включая execution), review flow связан с decision context.

## 7. Changes in agentProcessor

Текущая роль `agentProcessor` после всех этапов:

- **Primary architecture-driven flow** (AI-ветка):
  - orchestration shell:
    - вызывает dispatcher core модули,
    - вызывает deterministic scheduling,
    - агрегирует specialists,
    - формирует и обогащает DecisionObject,
    - выполняет writer/QA pipeline,
    - вызывает MCP-инструменты и handoff storage.
- **Fallback/compatibility flow**:
  - non-AI path (когда нет API ключа) с legacy reply (generic reply/upcoming appointments),
  - booking_failed / fake_confirmation_blocked защиты,
  - generic handoff ack и policy-based denial ответов.
- **Упрощено/оставлено**:
  - большая часть "decision jungle" уже вынесена в модули,
  - agentProcessor теперь преимущественно glue-код вокруг модулей и compatibility guards.

В рамках этого этапа новых крупных refactors в `agentProcessor` не делалось, так как цель cutover уже достигнута предыдущими шагами.

## 8. Runtime behavior impact

С учётом всех реализованных этапов и текущего cutover:

- **Booking**:
  - intent/сценарий определяется Scenario Router,
  - deterministic слой обрабатывает относительные даты/слоты,
  - Booking Specialist нормализует статус (exact_slot_available/day_closed/no_capacity/…),
  - MCP-вызовы для `crm.create_appointment` и др. идут через существующий execution loop,
  - Writer/QA формируют финальный текст,
  - ExecutionPlan фиксирует фактическое исполнение MCP-инструментов.
- **Reschedule**:
  - intent `RESCHEDULE` приводит к вызову Reschedule Specialist,
  - результат фиксируется в `DecisionObject`,
  - фактическое выполнение MCP-инструментов остаётся в существующем execution-поте.
- **Cancellation**:
  - intent `CANCEL_REQUEST` приводит к вызову Cancellation Specialist,
  - учитываются policy/approval потребности,
  - фактический cancel/execution остаётся совместимым с текущими MCP/gateway правилами.
- **Handoff**:
  - low-confidence/AI HANDOFF/NEED_APPROVAL — через Handoff Specialist + unified `HandoffPreparationResult`,
  - outcome и `ActionPlan.handoff` отражают нормализованный handoff,
  - storage+Telegram-handling остаются в `handoff.ts`.
- **Normal reply path**:
  - всегда проходит через Writer + Reply QA Guard в AI RESPOND ветке,
  - system fallbacks/локализация через `localization.ts`.

## 9. Backward compatibility and fallback paths

Оставшиеся fallback-пути:

- **non-AI path**:
  - при отсутствии AI API ключа:
    - используется legacy reply (upcoming appointments summary / generic reply),
    - новый DecisionObject/Writer/QA не используются (fallback режим).
- **booking safety**:
  - `booking_failed` и `fake_confirmation_blocked` ветки:
    - даже при наличии нового execution планирования, эти protection-ветки остаются как есть.
- **policy-based fallbacks**:
  - если policy запрещает handoff или execute, используются безопасные ack-сообщения через `getSystemMessage`.

Эти пути:
- чётко ограничены,
- служат safety net-ом,
- описаны в отчётах и не мешают primary architecture-driven flow.

## 10. Observability impact

Cutover сохраняет и использует уже реализованную observability:

- **DecisionObject snapshot**:
  - `decision_object_enriched` продолжает писаться,
  - включает scenario/policy/specialists/outcome/reply/handoff/execution/writer/QA.
- **Execution diagnostics**:
  - execution subset по MCP-инструментам виден в snapshot-е и admin-ui diagnostics block.
- **Admin-ui visibility**:
  - `/events/:conversationId`:
    - показывает последний snapshot в человекочитаемом виде,
    - raw JSON доступен для глубокого анализа.
- **Review alignment**:
  - review add form (`/reviews/add`) теперь подчёркивает связь с decision snapshot через ссылку на events,
  - список reviews ссылается на events для каждой беседы.

## 11. Risks / open questions

- Риски:
  - дальнейшие изменения DecisionObject/ActionPlan должны быть аккуратно синхронизированы с diagnostics и admin-ui, чтобы не сломать отображение.
  - полная миграция reschedule/cancel execution на ActionPlan требует дополнительных пилотов, как это было сделано для booking.
- Открытые вопросы:
  - когда переходить от executed mirror к полноценному plan-driven исполнению,
  - какие дополнительные поля нужны в DecisionObject для более тонких политик/аналитики,
  - нужна ли отдельная страница "Decision analytics" в admin-ui.

## 12. Next recommended cleanup step

После cutover наиболее логичные следующие шаги:

- **Cleanup**:
  - удалить/упростить остатки legacy-кода в `agentProcessor`, которые больше не используются (после отдельной проверки),
  - стандартизировать именование reason codes и tags.
- **Analytics**:
  - построить отчёты на основе `decision_object_enriched` (например, распределение outcomes по сценариям, частоту fallback-ов Writer/QA).
- **Execution migration**:
  - по аналогии с booking, постепенно подключить execution subset для reschedule/cancel, затем рассмотреть ActionPlan-driven execution engine.
- **Policy hardening**:
  - использовать review/decision diagnostics для настройки более строгих policy по сценариям.

## 13. Diff summary

- **added**
  - `docs/reports/full-architecture-cutover-report.md`
- **modified**
  - нет дополнительных модификаций кода в этом этапе; все архитектурные изменения были реализованы ранее.
- **removed**
  - никаких файлов не удалялось.
- **left intentionally**
  - fallback-пути и legacy-compatible ветки в `agentProcessor` и handoff/booking guards, чтобы сохранить безопасную обратную совместимость.

## 14. Validation

- Типы:
  - `DecisionObject`, ActionPlan, specialists, Writer/QA, diagnostics — согласованы и уже используются.
- Runtime:
  - основные flows (booking/reschedule/cancellation/handoff/respond) опираются на новый модульный слой и DecisionObject,
  - fallback-ветки ограничены и не мешают основной архитектуре.
- Observability:
  - snapshots пишутся,
  - admin-ui показывает decision и execution diagnostics,
  - review flow связан с decision context.

## Appendix A: New primary orchestrator flow

Новый основной orchestrator flow (AI-ветка) в 12–20 шагах:

1. Принять входящий батч сообщений (`processBatch`).
2. Найти/загрузить `Conversation` и проверить, должен ли бот отвечать (state/overrides).
3. Объединить текст батча и определить intent/scenario/language через `routeScenario` (Scenario Router).
4. Определить policy для сценария через `evaluatePolicy` (Policy Specialist) и получить `DecisionPermissions`.
5. Обновить conversation state (язык, текущий сценарий), залогировать `language_detected`/`intent_detected`/`scenario_selected`/`policy_applied`.
6. Подтянуть контекст:
   - предстоящие записи (MCP),
   - услуги/мастеров/KB контекст и т.д.
7. Собрать `ClientContext` через `buildClientContext`.
8. Создать `DecisionObject` skeleton через `assembleDecisionSkeleton` (scenario/context/policy + пустой ActionPlan/Outcome + specialist slots).
9. Запустить deterministic scheduling (booking-related) и, если применимо, отдать deterministic reply без вызова AI.
10. Вызвать AI (`callAiAgent`) с контекстом (appointments/services/staff/KB/FREE_SLOTS) и получить `decision`, `reply_text`, `mcp_calls`, `handoff`, `tags`, `confidence`.
11. На основе intent и контекста вызвать specialists:
    - Booking/Reschedule/Cancellation Specialists → записать результат в `DecisionObject`.
12. Обработать low-confidence/HANDOFF/NEED_APPROVAL:
    - через Handoff Specialist получить `HandoffPreparationResult`,
    - обновить `DecisionObject.actionPlan.handoff` и `outcome`,
    - фактически создать handoff case + pending action.
13. В RESPOND-ветке:
    - выполнить MCP-вызовы (`callMcp`) в соответствии с `mcp_calls`,
    - заполнить `ActionPlan.execution.mcpCalls` как executed mirror,
    - применить booking guards (`booking_failed`, `fake_confirmation_blocked`).
14. Пропустить `reply_text` через Writer (учёт policy/наличия текста) и Reply QA Guard (язык/запрещённые фразы/пустота), получить финальный текст.
15. Обновить `DecisionObject.actionPlan.reply`, `writer`, `replyQa` и `outcome` (RESPOND/ok).
16. Отправить финальный ответ клиенту через WhatsApp и записать его в DB (messages).
17. Сохранить `decision_object_enriched` через `persistDecisionSnapshot` в `conversation_events`.
18. Продолжить flow с учётом review/handoff/admin-процессов (через admin-ui).

## Appendix B: Legacy compatibility paths still remaining

Оставшиеся compatibility/legacy пути:

1. **Non-AI legacy path**:
   - при отсутствии AI API key:
     - используется упрощённая логика:
       - summary по предстоящим записям или generic reply,
     - новые модули (Writer/QA/DecisionObject) не участвуют.
2. **Booking failure и fake confirmation**:
   - legacy ветки:
     - `booking_failed` → system fallback + handoff,
     - `fake_confirmation_blocked` → fallback + handoff,
   - остаются как есть, даже с новым execution mirror.
3. **Generic handoff ack**:
   - текст `handoff_ack` и некоторые ack-фразы всё ещё формируются в `agentProcessor` и `localization.ts`, а не через Writer/QA.
4. **Execution for non-booking scenarios**:
   - reschedule/cancel execution пока не отражены в `ActionPlan.execution` (только booking pilot),
   - MCP execution для них идёт через существующий loop без execution mirror.
5. **Некоторые legacy logging-фрагменты**:
   - отдельные debug-логи и summary-строки всё ещё построены вокруг старого восприятия flow, хотя теперь есть DecisionObject diagnostics.

Эти пути намеренно оставлены как совместимые и безопасные fallback-ветки и могут быть предметом дальнейших cleanup/миграций на следующих этапах.

