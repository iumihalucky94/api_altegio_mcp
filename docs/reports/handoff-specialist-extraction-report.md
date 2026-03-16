# Stage Report: handoff-specialist-extraction

## 1. Goal

Выделить Handoff Specialist в orchestrator как тонкий слой нормализации handoff-состояний, который:
- опирается на уже существующий handoff flow (`handoff.ts`, `pending_admin_actions`, Telegram/admin handling),
- не ломает текущую архитектуру handoff/case storage,
- нормализует handoff state в типизированный `HandoffPreparationResult`,
- частично интегрируется в `agentProcessor` для диагностического использования.

## 2. Scope

В рамках этапа были изменены:
- только orchestrator-слой (новый модуль specialist + интеграция в `agentProcessor`),
- shared типы не перепроектировались (используется уже существующий `HandoffPreparationResult` и `HandoffReasonCode`),
- создан отчётный файл.

Не менялись:
- `handoff.ts` (создание кейсов и pending_admin_actions),
- Telegram/admin handling,
- prompt strategy, Writer, Reply QA Guard,
- gateway / MCP / wa-service контракты,
- booking/reschedule/cancellation specialists (кроме возможной совместимости, но на практике не менялись).

## 3. Current handoff flow findings

Найденные части handoff-логики:

- **agentProcessor**
  - Хранит основную управленческую логику handoff:
    - Ветка `!result` (AI agent не вернул результат):
      - вызывает `createHandoffAndPauseWithSummary` c reason_code `'ai_agent_failed'`,
      - отправляет резюме в summary-log (`sendToSummary`).
    - Ветка `result.confidence < confidenceThreshold`:
      - формирует `summary` для low-confidence: либо `result.handoff?.summary`, либо строку с confidence + tags,
      - создаёт `HandoffContext` с:
        - `reason_code: 'low_confidence'`,
        - `confidence, decision, reply_text_preview, tags`,
      - вызывает `createHandoffAndPauseWithSummary` и summary-log.
    - Ветка `result.decision === 'HANDOFF'`:
      - если policy запрещает handoff — отвечает клиенту и не создаёт handoff,
      - иначе:
        - формирует `summary` из `result.handoff?.summary || result.handoff?.reason || batchText`,
        - собирает `HandoffContext` с `reason_code: 'ai_handoff'`,
        - вызывает `createHandoffAndPauseWithSummary` и (при наличии) отправляет `result.reply_text` клиенту.
    - Ветка `result.decision === 'NEED_APPROVAL'`:
      - при запрете handoff policy — только ответ клиенту,
      - иначе:
        - формирует `summary` из `result.handoff?.summary` или шаблон `"Approval requested: ..."`,
        - строит `HandoffContext` с `reason_code: 'need_approval'`,
        - вызывает `createHandoffAndPauseWithSummary` и (опционально) отправляет ответ клиенту.
    - Дополнительные handoff-триггеры:
      - Ошибка при создании записи (`booking_failed`) → handoff.
      - Фейковое подтверждение без `create_appointment` (`fake_confirmation_blocked`) → handoff.
  - Во всех этих местах формируется контекст для handoff, но до этапа specialist:
    - Не было единого нормализатора с типом `HandoffPreparationResult`.
    - Priority/summary/questionToAdmin определялись локально по месту.

- **handoff.ts**
  - Отвечает за:
    - создание `handoff_cases` через `createHandoffCase`,
    - управление `pending_admin_actions` (открытие/закрытие, напоминания),
    - выборку и агрегацию контактов, требующих внимания (`getContactsNeedingAttention`).
  - Содержит истинный источник данных по:
    - структуре кейсов,
    - связке handoff cases ↔ pending_admin_actions,
    - аудиту handoff-действий.

- **pending_admin_actions flow**
  - Через `addPendingAction` (в `handoff.ts`) orchestrator сохраняет ожидающие действия:
    - TYPE (например, HANDOFF),
    - `approval_id` (для сценариев NEED_APPROVAL),
    - статус OPEN/DONE (через `markPendingDone`).

- **Telegram/admin related handling**
  - В `agentProcessor` в функции `createHandoffAndPauseWithSummary` формируется текст для Telegram:
    - включает reason_code, confidence, решение модели, preview ответа, tags.
  - Этот слой не менялся и продолжает использовать payload, сформированный в `HandoffContext` и `appendConversationEvent`.

- **conversation_events / handoff-related events**
  - Через `appendConversationEvent` создаются `handoff_created` события с payload:
    - `summary`, `reason_code`, дополнительные поля (`confidence`, `decision`, `reply_text_preview`, `tags`).
  - Эти события используются для аудита и построения истории беседы.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/handoff.ts`
- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/types/reasonCodes.ts`
- `orchestrator/src/services/bookingSpecialist.ts`
- `orchestrator/src/services/rescheduleSpecialist.ts`
- `orchestrator/src/services/cancellationSpecialist.ts`
- связанные участки Telegram/admin handling в `agentProcessor.ts` (внутри `createHandoffAndPauseWithSummary`).

## 5. New module created

- **name**: `orchestrator/src/services/handoffSpecialist.ts`
- **purpose**:
  - Дать единый orchestrator-side фасад, который:
    - принимает минимальный handoff-контекст (scenario, reason, confidence, summary, preview, tags),
    - возвращает нормализованный `HandoffPreparationResult`,
    - может использоваться для диагностики, логирования и будущей интеграции в `DecisionObject.actionPlan.handoff`.
  - Не заменять существующий `handoff.ts` и не менять lifecycle кейсов / pending actions.
- **key inputs** (`HandoffSpecialistInput`):
  - `scenarioCode: ScenarioCode`
  - `reasonCode: HandoffReasonCode`
  - `confidence?: number`
  - `summary: string`
  - `replyPreview?: string`
  - `tags?: string[]`
- **key outputs**:
  - `HandoffPreparationResult`:
    - `shouldHandoff: true`
    - `reasonCode: HandoffReasonCode`
    - `priority: HandoffPriority`
    - `summary: string` (усечённый до 500 символов)
    - `questionToAdmin: string`
    - `tags?: string[]`
- **what existing logic it wraps/reuses**:
  - Использует имеющиеся типы:
    - `ScenarioCode`, `HandoffReasonCode`, `HandoffPriority`, `HandoffPreparationResult`.
  - Не вызывает новые внешние API, не трогает `handoff.ts`.
  - Логика определения priority и questionToAdmin строится поверх уже используемых reason codes:
    - `'ai_agent_failed'`, `'low_confidence'`, `'ai_handoff'`, `'need_approval'`, `'booking_failed'`, `'fake_confirmation_blocked'`, `'policy_forced_handoff'`, `'schedule_violation'`, `'legacy_handoff'`, `'manual_handoff'`, `'other'`.

## 6. Handoff result model

- **shape `HandoffPreparationResult`** (уже существующий в `contracts.ts`):
  - `shouldHandoff: boolean`
  - `reasonCode: HandoffReasonCode`
  - `priority: HandoffPriority`
  - `summary: string`
  - `questionToAdmin: string`
  - `tags?: string[]`
- **используемые reason codes** (`HandoffReasonCode`):
  - `ai_agent_failed`
  - `low_confidence`
  - `ai_handoff`
  - `need_approval`
  - `booking_failed`
  - `fake_confirmation_blocked`
  - `legacy_handoff`
  - `manual_handoff`
  - `policy_forced_handoff`
  - `schedule_violation`
  - `other`
- **определение priority** (`HandoffPriority`):
  - По умолчанию `priority: 'normal'`.
  - Повышенный приоритет:
    - `ai_agent_failed`, `fake_confirmation_blocked`, `booking_failed`, `policy_forced_handoff` → `priority: 'high'`.
  - Можно расширять в будущем (например, `critical` для особых сценариев).
- **summary / questionToAdmin**:
  - `summary` — это усечённая версия входного `summary` (до 500 символов), чтобы быть совместимым с текущими ограничениями.
  - `questionToAdmin` строится в зависимости от `reasonCode` и `scenarioCode`:
    - `low_confidence`:
      - текст о том, что модель не уверена, с указанием сценария и confidence.
    - `need_approval`:
      - просьба проверить и подтвердить действие по сценарию.
    - `booking_failed` / `schedule_violation`:
      - просьба помочь с расписанием/записью.
    - `fake_confirmation_blocked`:
      - предупреждение о том, что модель сообщила об успешной записи без фактического `create_appointment`.
    - `ai_agent_failed`:
      - сообщение о неспособности модели обработать запрос.
    - `policy_forced_handoff`:
      - указание, что политика запрещает автоматическое действие.
    - default:
      - `'Please handle this conversation.'` (совместимо с текущим `handoff.ts` поведением).

## 7. Changes in agentProcessor

Внесены только диагностические изменения; существующий handoff flow не изменён:

- **imports**:
  - Добавлен импорт `prepareHandoff` из `handoffSpecialist.ts`.

- **Ветка low confidence**:
  - До изменений:
    - формировались `summary` и `HandoffContext`,
    - вызывался `createHandoffAndPauseWithSummary` и `sendToSummary`.
  - Теперь дополнительно:
    - вызывается `prepareHandoff` с:
      - `scenarioCode`,
      - `reasonCode: 'low_confidence'`,
      - `confidence: result.confidence`,
      - `summary`,
      - `replyPreview: result.reply_text`,
      - `tags: result.tags`.
    - результат (`handoffPrep`) логируется через `logger.debug`:
      - `logger.debug?.({ conversationId, handoffPrep }, 'Handoff specialist output (low_confidence)');`
    - runtime-поведение (`createHandoffAndPauseWithSummary`) остаётся прежним.

- **Ветка `result.decision === 'HANDOFF'`**:
  - Аналогично:
    - `prepareHandoff` вызывается с `reasonCode: 'ai_handoff'`, `summary` из текущей логики и теми же полями.
    - результат логируется: `'Handoff specialist output (AI HANDOFF)'`.
    - дальнейший вызов `createHandoffAndPauseWithSummary` и отправка reply клиенту остаются без изменений.

- **Ветка `result.decision === 'NEED_APPROVAL'`**:
  - Аналогично:
    - `prepareHandoff` вызывается с `reasonCode: 'need_approval'`, `summary` из текущей логики и соответствующими параметрами.
    - результат логируется: `'Handoff specialist output (NEED_APPROVAL)'`.
    - существующий `createHandoffAndPauseWithSummary` и отправка reply клиенту не изменяются.

- **Важно**:
  - Ни один из новых вызовов specialist не влияет на выбор ветки или параметры фактического вызова `createHandoffAndPauseWithSummary`.
  - Все `prepareHandoff` вызовы обёрнуты в `try/catch` с silent failure, чтобы любые ошибки специалиста не ломали runtime-поведение.

## 8. Integration notes

- Handoff Specialist:
  - На текущем этапе используется только для:
    - формирования `HandoffPreparationResult`,
    - логирования результата в debug-логах.
  - Не интегрирован ещё в `DecisionObject.actionPlan.handoff` и не используется для изменения handoff-поведения.
- Связь с существующим flow:
  - Используемые входные данные приходят из тех же мест, что и раньше:
    - `scenarioCode` (через `intentToScenarioCode`/`routeScenario`),
    - `reasonCode` (значения, которые уже использовались в `HandoffContext`),
    - `confidence`, `summary`, `replyPreview`, `tags`.
  - Таким образом, specialist — это чистый нормализующий слой поверх уже собранного контекста.

## 9. Compatibility notes

- Никаких изменений в:
  - `handoff.ts` (создание кейсов, pending actions),
  - `appendConversationEvent` payload (по-прежнему формируется в `createHandoffAndPauseWithSummary`),
  - Telegram/admin уведомлениях.
- Handoff Specialist:
  - не создаёт/обновляет записи в БД,
  - не меняет тексты сообщений клиенту или админу,
  - не меняет структуру `handoff_cases` и `pending_admin_actions`.
- Все изменения ограничиваются:
  - новым модулем `handoffSpecialist.ts`,
  - дополнительными debug-логами в `agentProcessor.ts`.

## 10. Risks / open questions

- Следующие шаги (будущие этапы) могут:
  - начать использовать `HandoffPreparationResult` для:
    - заполнения `DecisionObject.actionPlan.handoff`,
    - генерации более структурированных handoff payload'ов в БД/Telegram,
    - единообразного определения приоритета.
  - потребовать расширения `HandoffPreparationResult` (например, включения structured context snapshot).
- Вопросы на будущее:
  - Как лучше использовать `scenarioCode` и `tags` для маршрутизации handoff-кейсов между разными администраторами/каналами?
  - Какие reason codes должны считаться `critical` vs `high` vs `normal` в проде?

## 11. Next recommended step

- В будущем:
  - интегрировать `HandoffPreparationResult` в `DecisionObject.actionPlan.handoff` (через `DecisionAssembler`),
  - постепенно переключить создание `handoff_cases` на использование нормализованного `questionToAdmin`/`priority`,
  - сохранить обратную совместимость с текущими текстами, добавляя только новые поля для аналитики и роутинга.

## 12. Diff summary

- **added**
  - `orchestrator/src/services/handoffSpecialist.ts`
  - `docs/reports/handoff-specialist-extraction-report.md`
- **modified**
  - `orchestrator/src/services/agentProcessor.ts` — добавлены диагностические вызовы `prepareHandoff` в ветках low_confidence, HANDOFF, NEED_APPROVAL.
- **untouched**
  - `orchestrator/src/services/handoff.ts`
  - `orchestrator/src/types/contracts.ts` (handoff-структуры использованы как есть)
  - `orchestrator/src/types/reasonCodes.ts` (используем существующие reason codes для handoff)
  - booking/reschedule/cancellation specialists
  - gateway / wa-service / ingest контракты
  - admin-ui

## 13. Validation

- Типы:
  - `HandoffSpecialistInput` использует уже существующие `ScenarioCode`, `HandoffReasonCode`, `HandoffPriority`, `HandoffPreparationResult`.
  - Новый модуль компилируется без конфликтов.
- Логика:
  - В случае любой ошибки внутри `prepareHandoff` (теоретически) handoff-runtime продолжит работать, так как вызовы обёрнуты в `try/catch`.
  - Во всех handoff-ветках (low_confidence, HANDOFF, NEED_APPROVAL) по-прежнему вызывается `createHandoffAndPauseWithSummary` с теми же `summary` и `HandoffContext`, что и до этапа.
  - Дополнительные debug-логи не влияют на клиентские ответы, Telegram-уведомления или БД.

## Appendix: Handoff flow after extraction

1. Клиент пишет сообщение; LLM возвращает результат с `decision` и, при необходимости, полем `handoff`.
2. В `agentProcessor` для каждого batched-сообщения вычисляются `scenarioCode`, `intent`, policy, KB-контекст и пр. (unchanged).
3. Ветка `!result` (ошибка AI) создаёт handoff через `createHandoffAndPauseWithSummary` с reason_code `'ai_agent_failed'` (как и раньше).
4. Ветка low confidence:
   - вычисляет `summary` и `HandoffContext` (`reason_code: 'low_confidence'`),
   - вызывает `prepareHandoff` для нормализации handoff-плана (priority, questionToAdmin, tags) и пишет его в debug-лог,
   - затем вызывает существующий `createHandoffAndPauseWithSummary` и отправляет pause-ответ клиенту.
5. Ветка `decision === 'HANDOFF'`:
   - формирует `summary` и `HandoffContext` (`reason_code: 'ai_handoff'`),
   - вызывает `prepareHandoff` с `reasonCode: 'ai_handoff'` и пишет результат в debug-лог,
   - создаёт handoff-case и, при наличии, отправляет клиенту `result.reply_text`.
6. Ветка `decision === 'NEED_APPROVAL'`:
   - формирует `summary` и `HandoffContext` (`reason_code: 'need_approval'`),
   - вызывает `prepareHandoff` с `reasonCode: 'need_approval'` и пишет результат в debug-лог,
   - создаёт handoff-case и, при наличии, отправляет клиенту `result.reply_text`.
7. В ветках booking-failure и fake-confirmation:
   - поведение handoff остаётся прежним (через `createHandoffAndPauseWithSummary` с соответствующими reason codes).
   - при необходимости в будущем эти ветки также могут вызывать `prepareHandoff` для унификации.
8. `handoff.ts` обрабатывает создание `handoff_cases` и `pending_admin_actions` так же, как и до extraction.
9. Telegram/admin слой получает тот же payload из `handoff_created` событий и `HandoffContext`, но теперь дополнительный нормализованный результат handoff specialist доступен в debug-логах для анализа и будущего развития.

