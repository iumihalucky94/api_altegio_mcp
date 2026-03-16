# Stage Report: reschedule-specialist-extraction

## 1. Goal

Зафиксировать и выделить слой Reschedule Specialist в orchestrator, который:
- использует уже существующий deterministic scheduling layer, MCP tools и текущий orchestration flow,
- не ломает рабочий runtime поведения переноса записи,
- нормализует результат переноса в виде типизированного `RescheduleSpecialistResult`,
- интегрируется в `DecisionObject` через `DecisionAssembler`,
- подготавливает почву для дальнейшего вынесения логики переноса без резкого рефакторинга.

## 2. Scope

В рамках этапа были затронуты только:
- shared типы orchestrator (`contracts.ts`, `reasonCodes.ts`),
- новый модуль `rescheduleSpecialist.ts`,
- ограниченные правки в `agentProcessor.ts` и `decisionAssembler.ts`,
- отчётный файл с описанием этапа.

Не трогались:
- cancellation specialist, handoff architecture, writer / reply QA guard,
- admin-ui, gateway, wa-service, prompts и внешние контракты ingest/MCP.

## 3. Current reschedule flow findings

Найдены части логики, относящиеся к переносу записи:
- **agentProcessor**
  - intent `RESCHEDULE` определяется в `intent.ts`, но до этого этапа не имел отдельного specialist-модуля.
  - Текущий поток:
    - перед вызовом AI собирается контекст: `appointments` (через `admin.get_upcoming_appointments_by_phone`), `services`, `staff`, `free_slots` (через `crm.get_free_slots`), `kb_text`.
    - весь контекст передаётся в LLM как `context.free_slots`, `context.appointments` и т.п.
    - решение о переносе (какую запись переносить, на какое время, какие слоты доступны) принимается внутри LLM + policy layer, без отдельного reschedule-фаcада.
  - В конце `processWithAiAgent` уже был Diagnostic-слой `DecisionObject` c полем `rescheduleResult`, но без реальной инициализации.
- **deterministicScheduling**
  - Сконцентрирован на сценарии **нового бронирования** (booking), работает для intent `BOOKING`/`UNKNOWN`.
  - Сейчас не вызывается для intent `RESCHEDULE`.
  - В этом этапе мы его не расширяли, чтобы не менять runtime поведения.
- **bookingContext**
  - Содержит `getDatesToFetch`, `matchStaffFromMessage` и резолверы дат/относительных выражений.
  - Уже используется для вычисления `free_slots` при booking/UNKNOWN.
  - Для reschedule пока используется косвенно через те же FREE_SLOTS, которые затем попадают в LLM.
- **MCP flow**
  - Для переноса уже существует MCP tool `crm.reschedule_appointment` (gateway), используемый LLM через существующий MCP слой.
  - Дополнительно для контекста используются:
    - `admin.get_upcoming_appointments_by_phone` — поиск ближайших записей клиента;
    - `crm.list_services`, `crm.list_staff`, `crm.get_free_slots` — те же, что и для booking.
- **current appointment lookup flow**
  - Поиск текущей записи реализован на стороне MCP/Altegio и LLM: LLM получает список `appointments` и использует их при формировании плана переноса.
  - В orchestrator до этого этапа не было отдельного слоя, который различает:
    - "нет текущей записи для переноса",
    - "не хватает нового времени",
    - "есть слоты / нет слотов / ограничено policy".

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/intent.ts`
- `orchestrator/src/services/bookingContext.ts`
- `orchestrator/src/services/deterministicScheduling.ts`
- `orchestrator/src/services/bookingSpecialist.ts`
- `orchestrator/src/services/decisionAssembler.ts`
- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/types/reasonCodes.ts`
- `gateway/src/mcp/router.ts`
- `gateway/src/mcp/tools/crm/rescheduleAppointment.ts`

## 5. New module created

- **name**: `orchestrator/src/services/rescheduleSpecialist.ts`
- **purpose**:
  - Нормализовать результат сценария переноса записи на уровне orchestrator.
  - Явно учитывать наличие текущей записи и возможность выполнить перенос с точки зрения policy/слотов.
  - Предоставить `RescheduleSpecialistResult` для диагностики и дальнейшей эволюции decision layer.
- **key inputs** (`RescheduleSpecialistInput`):
  - `intent: Intent` — текущий intent (ожидается `RESCHEDULE`).
  - `upcomingAppointments: Array<{ id?: string; start?: string; service?: string; master?: string }> | undefined` — ближайшие записи клиента, полученные через существующий MCP-вызов.
  - `freeSlots: string[]` — список свободных слотов (тот же FREE_SLOTS, который уже передаётся в LLM).
  - `policyAllowsExecute: boolean` — флаг из scenario policy (`canExecuteMutating`), отражающий, разрешено ли выполнять мутационные действия.
- **key outputs**:
  - `RescheduleSpecialistResult` с:
    - `status: SpecialistStatus` (`ok`, `failed`, `needs_approval`, `skipped`),
    - `domainStatus: RescheduleDomainStatus` (доменный статус переноса),
    - `reasonCode: DecisionReasonCode` (детализированная причина),
    - `rescheduledAppointmentId?: string` (зарезервировано под будущую интеграцию с фактическим выполнением переноса).
- **what existing logic it wraps/reuses**:
  - Не пересчитывает availability, использует уже собранные:
    - `upcomingAppointments` (из MCP),
    - `freeSlots` (через `crm.get_free_slots` и `bookingContext`),
    - policy-флаг `canExecuteMutating` (из `policySpecialist`).
  - Не вызывает новые MCP tools — опирается на результаты уже прошедшего потока в `agentProcessor`.

## 6. Reschedule result model

- **shape `RescheduleSpecialistResult`** (в `orchestrator/src/types/contracts.ts`):
  - `status: SpecialistStatus`
  - `domainStatus: RescheduleDomainStatus`
  - `reasonCode: DecisionReasonCode`
  - `rescheduledAppointmentId?: string`
- **используемые reschedule statuses** (`RescheduleDomainStatus`):
  - `missing_current_appointment` — нет текущей записи для переноса (пустой список `upcomingAppointments`).
  - `missing_new_time` — зарезервировано для случаев, когда не удаётся определить новое время (пока не используется в логике, но присутствует в контракте для последующих этапов).
  - `exact_slot_available` — есть свободные слоты, и перенос потенциально возможен.
  - `alternatives_only` — позже может использоваться, если есть только альтернативы; в текущем этапе оставлен в типах для совместимости с booking-моделью.
  - `day_closed` — будущий статус для случаев недоступности дней; в этом этапе не активирован, чтобы не дублировать deterministic scheduling.
  - `no_capacity` — нет свободных слотов (`freeSlots` пустой).
  - `restricted_by_policy` — policy запрещает выполнение мутаций (`canExecuteMutating = false`).
  - `needs_handoff` — зарезервировано для сценариев, когда перенос лучше передать админу.
  - `execution_ready` — все условия соблюдены, перенос теоретически может быть выполнен.
  - `execution_blocked` — перенос заблокирован по некритичной причине (например, внешней ошибке), зарезервирован под будущее использование.
- **reschedule-specific reason codes** (`DecisionReasonCode` в `reasonCodes.ts`):
  - `reschedule_missing_current_appointment`
  - `reschedule_missing_new_time`
  - `reschedule_exact_slot_available`
  - `reschedule_alternatives_only`
  - `reschedule_day_closed`
  - `reschedule_no_capacity`
  - `reschedule_restricted_by_policy`
  - `reschedule_execution_ready`
  - `reschedule_execution_blocked`
- **чем specialist отличается от booking specialist**:
  - Booking Specialist исходит из задачи **создания новой записи**, не опираясь на существующую запись.
  - Reschedule Specialist всегда рассматривает пару:
    - существующая запись (`upcomingAppointments`),
    - возможность переноса в новый слот (`freeSlots` + policy).
  - При отсутствии текущей записи `RescheduleSpecialistResult` немедленно фиксирует `missing_current_appointment` вместо попытки трактовать ситуацию как новое бронирование.

## 7. Changes in agentProcessor

В `orchestrator/src/services/agentProcessor.ts` внесены только диагностические изменения:
- **imports**:
  - добавлен импорт `evaluateReschedule` из `rescheduleSpecialist.ts`.
- **перед вызовом DecisionAssembler**:
  - продолжается текущий сбор контекста: `appointments`, `services`, `staff`, `free_slots`, `kb_text` (без изменений поведения).
- **Decision skeleton**:
  - блок построения `DecisionObject` обновлён:
    - `bookingResult` теперь вычисляется через `evaluateBooking` только для `intent === 'BOOKING'` (как и ранее по смыслу).
    - добавлен вызов `evaluateReschedule` только для `intent === 'RESCHEDULE'`:
      - `upcomingAppointments: appointments`,
      - `freeSlots: free_slots`,
      - `policyAllowsExecute: policyResult.permissions.canExecuteMutating`.
    - результат передаётся в `assembleDecisionSkeleton` через новый аргумент `rescheduleResult`.
  - Логирование `decisionSkeleton` сохранено и расширено, чтобы включать `rescheduleResult`.
- **важно**:
  - Никакая существующая ветка принятия решений (`result.decision === 'HANDOFF' | 'NEED_APPROVAL' | 'EXECUTE' | 'REPLY_ONLY'`) не была изменена.
  - Reschedule Specialist не используется для фактического вызова MCP tools — только для формирования диагностического объекта.

## 8. DecisionObject integration

- В `orchestrator/src/services/decisionAssembler.ts`:
  - расширен импорт типов: добавлен `RescheduleSpecialistResult`.
  - интерфейс `DecisionAssemblerInput` дополнен полем:
    - `rescheduleResult?: RescheduleSpecialistResult`.
  - функция `assembleDecisionSkeleton` теперь принимает оба результата:
    - `bookingResult`,
    - `rescheduleResult`,
    и прокидывает их в `DecisionObject` без изменения остальных полей.
- В `orchestrator/src/types/contracts.ts`:
  - поле `rescheduleResult?: RescheduleSpecialistResult` уже было частью `DecisionObject` ранее (на этапе shared contracts), данный этап начал его реальное заполнение.

## 9. Compatibility notes

- Runtime flow переноса:
  - не менялись вызовы MCP (`crm.reschedule_appointment` и др.),
  - не менялась промпт-логика и структура ответа LLM,
  - не менялись policy-guards и handoff-ветки.
- Reschedule Specialist:
  - не выполняет реальный перенос и не вызывает новые tools,
  - использует только уже собранный контекст (`appointments`, `free_slots`, `policyResult`),
  - не может сломать существующий flow, так как его результат пока используется только для диагностики/DecisionObject.
- Дополненные типы и reason codes:
  - добавлены как надстройка над уже существующим типовым слоем, без изменения существующих значений.

## 10. Risks / open questions

- Требуется отдельный этап, где:
  - Reschedule Specialist начнёт реально управлять вызовами `crm.reschedule_appointment` (через orchestrator), а не только диагностировать состояние.
  - deterministic scheduling слой будет явно использоваться и для переноса, с учётом текущей записи (например, запрещать перенос < 24/48 часов).
- Пока не реализовано:
  - Явное различение ситуаций "нет новой даты" (`missing_new_time`) и "нет доступных слотов" (`no_capacity`) на уровне deterministic слоя для reschedule.
  - Стратегия, когда перенос должен автоматически переводиться в handoff (`needs_handoff`) при конфликте policy/availability.

## 11. Next recommended step

- Расширить Reschedule Specialist:
  - добавить явную проверку допустимости переноса по времени (например, политика <48ч),
  - интегрировать deterministic scheduling-декодер для reschedule (направленный на поиск ближайших альтернатив по аналогии с booking, но с учётом уже существующей записи),
  - начать использовать `RescheduleSpecialistResult` для принятия решений о:
    - NEED_APPROVAL,
    - автоматическом переносе при `execution_ready`,
    - handoff при `needs_handoff`.

## 12. Diff summary

- **added**
  - `orchestrator/src/services/rescheduleSpecialist.ts`
  - `docs/reports/reschedule-specialist-extraction-report.md`
- **modified**
  - `orchestrator/src/types/contracts.ts` — добавлены `RescheduleDomainStatus` и поле `domainStatus` в `RescheduleSpecialistResult`.
  - `orchestrator/src/types/reasonCodes.ts` — добавлены reschedule-специфичные `DecisionReasonCode`.
  - `orchestrator/src/services/decisionAssembler.ts` — поддержка `rescheduleResult` в `DecisionAssemblerInput` и `DecisionObject`.
  - `orchestrator/src/services/agentProcessor.ts` — вызов `evaluateReschedule` и передача результата в `DecisionAssembler`.
- **untouched**
  - MCP tools и их контракты (включая `crm.reschedule_appointment`).
  - deterministic scheduling реализация.
  - booking specialist, handoff flow, writer/respond-guard, prompts, admin-ui.

## 13. Validation

- Проект собирается на уровне типов:
  - `RescheduleDomainStatus` и новые `DecisionReasonCode` согласованы с существующими типами и не конфликтуют с ними.
  - `DecisionAssemblerInput` и `DecisionObject` компилируются с учётом новых полей.
- Логика:
  - Для intent, отличных от `RESCHEDULE`, `evaluateReschedule` возвращает `status: 'skipped'`, что не влияет на остальные сценарии.
  - При отсутствии `upcomingAppointments` Reschedule Specialist даёт чёткий сигнал `missing_current_appointment`.
  - При отсутствии `freeSlots` фиксируется `no_capacity`.
  - При запрете мутаций policy результат — `restricted_by_policy`.
  - Только при сочетании: есть запись + есть свободные слоты + policy разрешает execute, состояние помечается как `execution_ready`.

## Appendix: Reschedule flow after extraction

1. Клиент пишет сообщение с просьбой перенести запись; `classifyIntent` определяет intent `RESCHEDULE`.
2. В `agentProcessor` для данной беседы собирается контекст: `appointments` через `admin.get_upcoming_appointments_by_phone`, `services`, `staff`, потенциально `free_slots` через уже существующую логику `crm.get_free_slots`.
3. Загружается policy для сценария `reschedule` через `evaluatePolicy`, формируется `policyResult` с флагами `canExecuteMutating` и др.
4. Собирается KB-контекст и формируется `conversationHistory` для LLM (как и раньше).
5. Перед вызовом LLM, в диагностическом блоке, вызывается `evaluateReschedule`:
   - на входе: `intent`, `upcomingAppointments`, `freeSlots`, `policyAllowsExecute`.
   - на выходе: `RescheduleSpecialistResult` с доменным статусом и reason code.
6. Параллельно собирается `ClientContext` через `buildClientContext`, в котором теперь явно присутствуют `upcomingAppointments`.
7. `DecisionAssembler` получает `scenario`, `context`, `policyResult`, `fallbackLanguage`, а также `bookingResult`/`rescheduleResult` и формирует `DecisionObject` skeleton, который логируется в debug-лог.
8. Основной runtime behaviour по-прежнему опирается на результат LLM (`result.decision`, `result.reply_text`, MCP-вызовы), но теперь для дебага и последующего рефакторинга есть структурированное поле `rescheduleResult` внутри `DecisionObject`.
9. В будущем этот `rescheduleResult` может стать основой для перехода от "LLM решает всё" к "deterministic + specialist решают, LLM только пишет текст".

