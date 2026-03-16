# Stage Report: cancellation-specialist-extraction

## 1. Goal

Сформировать и выделить Cancellation Specialist в orchestrator, который:
- использует уже существующий policy layer, MCP-инструменты и текущий orchestration flow,
- не меняет текущее runtime-поведение отмены записи,
- нормализует состояние отмены в типизированный `CancellationSpecialistResult`,
- интегрируется в `DecisionObject` как `cancellationResult` для диагностики и будущей эволюции decision layer.

## 2. Scope

В рамках этапа были изменены только:
- shared типы orchestrator (`contracts.ts`, `reasonCodes.ts`),
- новый модуль `cancellationSpecialist.ts`,
- диагностическая интеграция в `agentProcessor.ts` и `decisionAssembler.ts`,
- отчётный файл с описанием этапа.

Не трогались:
- handoff architecture, writer / reply QA guard, prompt strategy,
- booking/reschedule specialists (кроме минимальной совместимости),
- admin-ui, gateway / wa-service, ingest/MCP контракты.

## 3. Current cancellation flow findings

Найденные части логики, относящиеся к отмене записи:
- **agentProcessor**
  - Intent `CANCEL_REQUEST` определяется в `intent.ts` и мапится на scenario code `cancel` через `scenarioPolicy.ts`.
  - Текущий high-level flow:
    - orchestrator собирает контекст: `appointments` (через `admin.get_upcoming_appointments_by_phone`), `services`, `staff`, `free_slots`, `kb_text`.
    - Весь контекст передаётся LLM внутри `callAiAgent` (`context.appointments`, `context.free_slots`, бизнес-часы и др.).
    - После ответа LLM:
      - policy-guards управляют тем, можно ли выполнять mutating MCP-вызовы (`canExecuteMutating`, `canCreateHandoff`, `canReply`).
      - В ветке `result.decision === 'RESPOND'` orchestrator перебирает `result.mcp_calls` и:
        - через `isMutatingTool` и policy решает, исполнять ли их;
        - вызывает `callMcp` для каждого инструмента.
      - Для cancel сейчас используется gateway-side логика:
        - `crm.cancel_appointment.plan` / `crm.cancel_appointment.apply` (через `gateway/src/mcp/tools/crm/cancelAppointment.ts` и router).
      - Локальные system-ответы уже учитывают провал/успех только для booking (`booking_failed`, `booking_not_confirmed_fallback`), но не строят отдельный cancellation-status.
- **policy layer**
  - `scenario_policies` и facade `policySpecialist` дают:
    - `permissions.canExecuteMutating` — можно ли вообще выполнять mutating инструменты (в т.ч. cancel).
    - `permissions.requiresAdminApproval` — нужен ли approval для действий в данном сценарии.
  - Для сценария `cancel` эти флаги определяют, будет ли LLM-план с cancel-инструментами выполнен автоматически, потребует approval / NEED_APPROVAL, либо приведёт к handoff.
- **MCP flow**
  - Gateway предоставляет:
    - `crm.cancel_appointment.plan` / `crm.cancel_appointment.apply` как пару план/применение с:
      - встроенной idempotency,
      - учётом policy/approval на gateway-уровне (через rules),
      - логикой планирования отмены и её применения.
  - Orchestrator не должен дублировать эти механизмы, а лишь решать, когда и можно ли до них «дойти».
- **current appointment lookup flow**
  - Поиск текущей записи реализован через:
    - `admin.get_upcoming_appointments_by_phone` в MCP,
    - дальнейшую логику внутри LLM (выбор нужной записи для отмены).
  - До этого этапа в orchestrator не было слоя, который типизированно выражает:
    - отсутствие текущей записи для отмены,
    - необходимость approval / reschedule-first,
    - готовность к безопасной отмене.
- **approval-related paths**
  - В `agentProcessor` уже есть обработка `result.decision === 'NEED_APPROVAL'`:
    - проверяет `safePolicy.allow_agent_to_create_handoff`,
    - создаёт `handoff` с reason_code `'need_approval'`,
    - не реализует отдельной cancellation-специализации, а работает для всех сценариев.
  - Для cancel это означает, что логика approval по сути уже реализована: AI может запросить approval, а orchestrator создаёт задачу админу.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/intent.ts`
- `orchestrator/src/services/scenarioPolicy.ts`
- `orchestrator/src/services/decisionAssembler.ts`
- `orchestrator/src/services/bookingSpecialist.ts`
- `orchestrator/src/services/rescheduleSpecialist.ts`
- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/types/reasonCodes.ts`
- `gateway/src/mcp/router.ts`
- `gateway/src/mcp/tools/crm/cancelAppointment.ts`
- `gateway/src/policy/rules.ts`

## 5. New module created

- **name**: `orchestrator/src/services/cancellationSpecialist.ts`
- **purpose**:
  - Дать orchestrator-уровневую нормализацию состояний сценария отмены записи.
  - Явно выразить:
    - отсутствие текущей записи для отмены,
    - policy-запрет на выполнение mutating действий,
    - требование admin approval,
    - готовность к безопасной отмене.
  - Подготавливать структурированный `CancellationSpecialistResult` для `DecisionObject`, не подменяя gateway/idempotency/approval движок.
- **key inputs** (`CancellationSpecialistInput`):
  - `intent: Intent` — ожидается `CANCEL_REQUEST`.
  - `upcomingAppointments: Array<{ id?: string; start?: string; service?: string; master?: string }> | undefined` — текущие/ближайшие записи клиента (тот же источник, что и для других специалистов).
  - `requiresAdminApproval: boolean` — из `policyResult.permissions.requiresAdminApproval`.
  - `canExecuteMutating: boolean` — из `policyResult.permissions.canExecuteMutating`.
- **key outputs**:
  - `CancellationSpecialistResult` с:
    - `status: SpecialistStatus` (`ok`, `failed`, `needs_approval`, `skipped`),
    - `domainStatus: CancellationDomainStatus`,
    - `reasonCode: DecisionReasonCode`,
    - `approvalId?: string` (зарезервировано под будущую связку с gateway approvals).
- **what existing logic it wraps/reuses**:
  - Не вызывает новые MCP-инструменты:
    - использует уже собранный `upcomingAppointments` и policy-права (`permissions`),
    - не дублирует план/апплай или idempotency.
  - Работает как фасад над уже существующим:
    - appointment lookup (через MCP),
    - policy-слоем (permissions).

## 6. Cancellation result model

- **shape `CancellationSpecialistResult`** (в `orchestrator/src/types/contracts.ts`):
  - `status: SpecialistStatus`
  - `domainStatus: CancellationDomainStatus`
  - `reasonCode: DecisionReasonCode`
  - `approvalId?: string`
- **используемые cancellation statuses** (`CancellationDomainStatus`):
  - `missing_current_appointment` — нет записей, которые можно отменить.
  - `approval_required` — политика требует admin approval для отмены.
  - `reschedule_first` — зарезервировано для случаев, когда политика/бизнес-правила требуют сначала предложить перенос (на данном этапе не активировано в логике, но есть в типе).
  - `safe_to_cancel` — может использоваться как промежуточное состояние «безопасно отменять» (также зарезервировано под дальнейшую детализацию).
  - `restricted_by_policy` — policy запрещает выполнять mutating действия (даже если запись есть).
  - `needs_handoff` — будущее состояние для сценариев, где отмену лучше передать админу.
  - `execution_ready` — есть запись, policy разрешает execute, approval не обязателен.
  - `execution_blocked` — отмена заблокирована по некритичной причине (например, внешней ошибке/ограничению), зарезервировано.
- **reason codes** (в `DecisionReasonCode`):
  - Добавлены cancellation-specific коды:
    - `cancellation_missing_current_appointment`
    - `cancellation_approval_required`
    - `cancellation_reschedule_first`
    - `cancellation_safe_to_cancel`
    - `cancellation_restricted_by_policy`
    - `cancellation_needs_handoff`
    - `cancellation_execution_ready`
    - `cancellation_execution_blocked`
- **как specialist учитывает approval и policy ограничения**:
  - Если `upcomingAppointments` пусты:
    - `status: 'failed'`,
    - `domainStatus: 'missing_current_appointment'`,
    - `reasonCode: 'cancellation_missing_current_appointment'`.
  - Если `canExecuteMutating === false`:
    - `status: 'needs_approval'`,
    - `domainStatus: 'restricted_by_policy'`,
    - `reasonCode: 'cancellation_restricted_by_policy'`.
  - Если `requiresAdminApproval === true`:
    - `status: 'needs_approval'`,
    - `domainStatus: 'approval_required'`,
    - `reasonCode: 'cancellation_approval_required'`.
  - Только если:
    - есть текущая запись,
    - mutating действия разрешены,
    - явный approval не требуется,
    — specialist возвращает:
    - `status: 'ok'`,
    - `domainStatus: 'execution_ready'`,
    - `reasonCode: 'cancellation_execution_ready'`.

## 7. Changes in agentProcessor

Изменения строго диагностические:
- **imports**:
  - добавлен импорт `evaluateCancellation` из `cancellationSpecialist.ts`.
- **DecisionObject skeleton блок**:
  - до изменений уже собирались:
    - `bookingResult` (через `evaluateBooking` для `intent === 'BOOKING'`),
    - `rescheduleResult` (через `evaluateReschedule` для `intent === 'RESCHEDULE'`).
  - добавлено:
    - вычисление `cancellationResult` только при `intent === 'CANCEL_REQUEST'`:
      - `upcomingAppointments: appointments`,
      - `requiresAdminApproval: policyResult.permissions.requiresAdminApproval`,
      - `canExecuteMutating: policyResult.permissions.canExecuteMutating`.
    - передача `cancellationResult` в `assembleDecisionSkeleton`.
  - Остальной поток:
    - LLM-вызов (`callAiAgent`),
    - ветки `HANDOFF` / `NEED_APPROVAL` / `RESPOND`,
    - исполнение MCP-инструментов,
    — остались без изменений.

## 8. DecisionObject integration

- В `orchestrator/src/services/decisionAssembler.ts`:
  - импортированы типы `CancellationSpecialistResult`.
  - `DecisionAssemblerInput` дополнен полем `cancellationResult?: CancellationSpecialistResult`.
  - `assembleDecisionSkeleton` теперь принимает и включает `cancellationResult` в возвращаемый `DecisionObject` (вместо прежнего `cancellationResult: undefined`).
- В `orchestrator/src/types/contracts.ts`:
  - уже существующее поле `cancellationResult?: CancellationSpecialistResult` в `DecisionObject` теперь реально заполняется skeleton-слоем.

## 9. Compatibility notes

- Runtime cancellation flow:
  - Не менялся список/семантика MCP-вызовов (по-прежнему используются `crm.cancel_appointment.plan` и `crm.cancel_appointment.apply` через существующий LLM-план).
  - Policy-guards, approval-ветки и handoff-логика не были изменены.
  - Состояние `CancellationSpecialistResult` пока не используется для принятия решений, а только для диагностики.
- Новый слой:
  - Не создаёт новый approval-engine или idempotency.
  - Не запускает самостоятельные cancel-операции; это по-прежнему делает LLM + `agentProcessor` через `callMcp`.

## 10. Risks / open questions

- На следующем этапе можно:
  - начать использовать `CancellationSpecialistResult` для:
    - блокировки опасных cancel-действий без approval,
    - явной рекомендации reschedule-first при `reschedule_first`,
    - инициирования NEED_APPROVAL/HANDOFF для сложных кейсов.
  - более чётко учитывать время до начала записи (например, <48ч) на уровне deterministic/business-логики.
- Открыты вопросы:
  - Как лучше связать `approvalId` в `CancellationSpecialistResult` с gateway approvals (пока поле зарезервировано).
  - В каких точках UX/политик отмены стоит всегда предлагать reschedule перед cancel.

## 11. Next recommended step

- Разработать следующий этап:
  - расширить reschedule/cancellation specialists так, чтобы они:
    - принимали во внимание временные ограничения (lateness windows, cancellation policy <48h),
    - управляли тем, когда нужно создавать NEED_APPROVAL / HANDOFF,
    - по результату специалистов формировали `ActionPlan` и `DecisionOutcome` (а не только skeleton).
  - оставляя при этом gateway-инфраструктуру (plan/apply, approvals, idempotency) как source of truth для фактических операций.

## 12. Diff summary

- **added**
  - `orchestrator/src/services/cancellationSpecialist.ts`
  - `docs/reports/cancellation-specialist-extraction-report.md`
- **modified**
  - `orchestrator/src/types/contracts.ts` — добавлены `CancellationDomainStatus` и поле `domainStatus` в `CancellationSpecialistResult`.
  - `orchestrator/src/types/reasonCodes.ts` — добавлены cancellation-specific `DecisionReasonCode`.
  - `orchestrator/src/services/decisionAssembler.ts` — поддержка `cancellationResult` в `DecisionAssemblerInput` и `DecisionObject`.
  - `orchestrator/src/services/agentProcessor.ts` — вызов `evaluateCancellation` при `intent === 'CANCEL_REQUEST'` и передача результата в `DecisionAssembler`.
- **untouched**
  - MCP tools и их контракты (включая cancel-инструменты).
  - deterministic scheduling реализация.
  - booking/reschedule specialists, handoff flow, writer/respond guard, prompts, admin-ui.

## 13. Validation

- Типы:
  - `CancellationDomainStatus` и новые `DecisionReasonCode` согласованы с существующими типами.
  - `DecisionAssemblerInput` и `DecisionObject` корректно расширены.
- Логика:
  - Для intent, отличных от `CANCEL_REQUEST`, `evaluateCancellation` возвращает `status: 'skipped'`, не влияя на остальные сценарии.
  - При отсутствии `upcomingAppointments` specialist фиксирует `missing_current_appointment`.
  - При policy-запрете на execute или требовании approval возвращаются соответствующие `domainStatus` и reason codes.
  - Только при наличии записи и разрешении execute без обязательного approval состояние помечается как `execution_ready`.

## Appendix: Cancellation flow after extraction

1. Клиент пишет сообщение с просьбой отменить запись; `classifyIntent` классифицирует его как `CANCEL_REQUEST`.
2. В `agentProcessor` orchestrator собирает контекст: `appointments` (через `admin.get_upcoming_appointments_by_phone`), `services`, `staff`, потенциальные `free_slots`, `kb_text`.
3. Через `evaluatePolicy` загружается политика для сценария `cancel`, формируются `permissions.canExecuteMutating` и `permissions.requiresAdminApproval`.
4. Перед основным использованием результата LLM в диагностическом блоке вызывается `evaluateCancellation`:
   - вход: `intent`, `upcomingAppointments`, `requiresAdminApproval`, `canExecuteMutating`.
   - выход: `CancellationSpecialistResult` с `domainStatus` и `reasonCode`.
5. Параллельно через `buildClientContext` формируется `ClientContext`, включающий сведения о ближайших записях.
6. `DecisionAssembler` собирает `DecisionObject` skeleton, получая:
   - `scenario`, `context`, `policyResult`, `fallbackLanguage`,
   - а также `bookingResult`, `rescheduleResult`, `cancellationResult`.
7. Этот `DecisionObject` логируется в debug-логах как диагностика текущего состояния cancel-сценария, но не меняет runtime-ветки.
8. Основной flow по-прежнему опирается на:
   - решение LLM (`result.decision`, `result.mcp_calls`, `result.reply_text`),
   - policy-guards (execute/handoff/approval),
   - gateway-инструменты для `crm.cancel_appointment.plan` / `crm.cancel_appointment.apply`.
9. В будущем `cancellationResult` может использоваться для более строгого контроля:
   - когда разрешать cancel без approval,
   - когда сначала предлагать reschedule,
   - когда всегда делать NEED_APPROVAL или прямой handoff.

