# Stage Report: decision-object-action-plan-enrichment

## 1. Goal

Сделать `DecisionObject` и `ActionPlan` более содержательными и полезными для оркестрации, не ломая текущий runtime flow:
- зафиксировать результаты specialists,
- отражать handoff-подготовку,
- включать информацию от Writer и Reply QA Guard,
- по-прежнему использоваться как диагностический / подготовительный слой, а не единственный source of truth.

## 2. Scope

В рамках этапа:
- обновлён shared contract layer (`DecisionObject`, `ActionPlan`, вспомогательные metadata-типы),
- слегка уточнён `decisionAssembler.ts` (использование контракта без изменения поведения),
- `agentProcessor.ts` начал реально обогащать `DecisionObject` в RESPOND- и handoff-ветках.

Не делалось:
- полный перевод runtime на DecisionObject,
- переписывание веток handoff/respond,
- изменение внешних контрактов ingest/MCP/gateway/wa-service.

## 3. Current DecisionObject findings

До этапа:
- **DecisionObject структура**:
  - уже содержал:
    - `scenario: ScenarioRouterResult`,
    - `context: ClientContext`,
    - `policy: PolicyResult`,
    - `schedule?: ScheduleInterpretationResult`,
    - `bookingResult?`, `rescheduleResult?`, `cancellationResult?`,
    - `actionPlan: { reply, execution, handoff? }`,
    - `outcome: { type, reasonCode, confidence }`.
  - однако:
    - `schedule` всегда оставалась `undefined`,
    - `actionPlan.reply` имела `text: null` и `language: fallbackLanguage`,
    - `actionPlan.execution.mcpCalls` всегда был пустым массивом,
    - `actionPlan.handoff` всегда был `null`,
    - `outcome.type` всегда был `'SKIP'` с reasonCode `'unknown'`.
- **Specialist results**:
  - На этапе booking/reschedule/cancellation extraction:
    - `bookingResult`, `rescheduleResult`, `cancellationResult` уже передавались в assembler и сохранялись в `DecisionObject`.
  - Но они использовались только как диагностика в логах; никакого дальнейшего enrichment не было.
- **Writer / QA / Handoff metadata**:
  - Writer и Reply QA Guard существовали как отдельные модули, но:
    - их результаты никак не отражались в `DecisionObject`,
    - `actionPlan.reply` и `outcome` не обновлялись после формирования реального ответа.
  - Handoff Specialist (handoffSpecialist.ts) также не был связан с `DecisionObject.actionPlan.handoff`, только с логами.

## 4. Files reviewed

- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/services/decisionAssembler.ts`
- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/bookingSpecialist.ts`
- `orchestrator/src/services/rescheduleSpecialist.ts`
- `orchestrator/src/services/cancellationSpecialist.ts`
- `orchestrator/src/services/handoffSpecialist.ts`
- `orchestrator/src/services/writer.ts`
- `orchestrator/src/services/replyQaGuard.ts`

## 5. Shared contract updates

Обновлён файл `orchestrator/src/types/contracts.ts`:

- **ReplyPlan / ActionPlan / DecisionOutcome**:
  - Оставлены без радикальных изменений:
    - `ReplyPlan` по-прежнему содержит:
      - `text: string | null`,
      - `language: ResolvedLanguage`.
    - `ActionPlan`:
      - `reply: ReplyPlan`,
      - `execution: ExecutionPlan`,
      - `handoff?: HandoffPreparationResult | null`.
    - `DecisionOutcome`:
      - `type: 'RESPOND' | 'HANDOFF' | 'NEED_APPROVAL' | 'SKIP'`,
      - `reasonCode: DecisionReasonCode`,
      - `confidence: number`.
  - Эти структуры уже были достаточными для хранения плана действий, поэтому изменений не потребовали.

- **Новые metadata-типы**:
  - Добавлен блок "Diagnostics / enrichment metadata":
    - `WriterMetadata`:
      - `usedFallback: boolean` — фиксирует, приходилось ли Writer-у падать на системный fallback.
    - `ReplyQaIssueSummary`:
      - `code: string` — краткий код найденной проблемы (совпадает с кодами из Reply QA Guard).
    - `ReplyQaMetadata`:
      - `fallbackUsed: boolean` — падал ли QA Guard на fallback.
      - `issues: ReplyQaIssueSummary[]` — список найденных проблем по кодам.

- **Расширение DecisionObject**:
  - В `DecisionObject` добавлены поля:
    - `writer?: WriterMetadata;`
    - `replyQa?: ReplyQaMetadata;`
  - Это позволяет централизованно видеть, что произошло на этапах Writer/QA, не ломая текущий формат `actionPlan`/`outcome`.

Причина изменений:
- сохранить существующую структуру `ActionPlan`/`DecisionOutcome`, но добавить лёгкий diagnostics-слой,
- не привносить лишних зависимостей (metadata-типы не тянут за собой сложные контракты).

## 6. Decision Assembler changes

Файл `orchestrator/src/services/decisionAssembler.ts`:

- **DecisionAssemblerInput**:
  - Небольшая корректировка форматирования (отступы) без изменения списка полей:
    - остаётся:
      - `scenario, context, policy, fallbackLanguage`,
      - `bookingResult?, rescheduleResult?, cancellationResult?`.

- **assembleDecisionSkeleton**:
  - Поведение оставлено прежним:
    - создаёт `ActionPlan` с:
      - `reply.text = null`, `reply.language = fallbackLanguage`,
      - `execution.mcpCalls = []`,
      - `handoff = null`.
    - создаёт `outcome`:
      - `type: 'SKIP'`,
      - `reasonCode: 'unknown'`,
      - `confidence: scenario.confidence`.
    - заполняет:
      - `scenario`, `context`, `policy`,
      - `bookingResult`, `rescheduleResult`, `cancellationResult`.
  - Новые metadata-поля (`writer`, `replyQa`) пока не заполняются assembler-ом:
    - они обогащаются позже, уже в `agentProcessor`, после выполнения Writer и QA Guard.

Итого:
- assembler остаётся "skeleton-builder"-ом, на который затем накладывается enrichment в runtime-потоке.

## 7. Changes in agentProcessor

Основное enrichment произошло в `orchestrator/src/services/agentProcessor.ts`:

- **Комментарий к DecisionObject**:
  - Обновлён, чтобы отражать реальную роль:
    - "skeleton for diagnostics / enrichment (no behaviour change)".

- **Handoff-ветки**:
  - В трёх ветках:
    - low confidence (`result.confidence < threshold`),
    - `result.decision === 'HANDOFF'`,
    - `result.decision === 'NEED_APPROVAL'`,
  - после вызова `prepareHandoff` теперь:
    - если `decisionSkeleton` уже создан:
      - `decisionSkeleton.actionPlan.handoff = handoffPrep;`
      - `decisionSkeleton.outcome` обновляется:
        - для low confidence и AI HANDOFF:
          - `type: 'HANDOFF'`,
          - `reasonCode: 'handoff_requested_by_ai'`,
          - `confidence: result.confidence`.
        - для NEED_APPROVAL:
          - `type: 'NEED_APPROVAL'`,
          - `reasonCode: 'handoff_need_approval'`,
          - `confidence: result.confidence`.
  - Это связывает Handoff Specialist c DecisionObject, не меняя фактическое поведение handoff (всё ещё управляется существующими вызовами `createHandoffAndPauseWithSummary`).

- **RESPOND-ветка с Writer и QA Guard**:
  - После Writer и QA Guard:
    - `writerOutput = writeReply(...)`
    - `qaResult = runReplyQaGuard(...)`
    - `replyToSend = qaResult.finalText`
  - Дополнительно, если `decisionSkeleton` существует:
    - `decisionSkeleton.actionPlan.reply` обновляется:
      - `text: replyToSend`,
      - `language: effectiveLang`.
    - `decisionSkeleton.writer` заполняется:
      - `{ usedFallback: writerOutput.usedFallback }`.
    - `decisionSkeleton.replyQa` заполняется:
      - `fallbackUsed: qaResult.fallbackUsed`,
      - `issues: qaResult.issues.map(i => ({ code: i.code }))`.
    - `decisionSkeleton.outcome` обновляется:
      - `type: 'RESPOND'`,
      - `reasonCode: 'ok'`,
      - `confidence: result.confidence`.
    - Лог добавлен:
      - `logger.debug?.({ conversationId, decisionSkeleton }, 'Decision object enriched with reply/writer/qa');`

Сознательно не тронуто:
- Логика принятия решений (`if result.decision === '...'`),
- MCP-вызовы и их ошибки (включая booking_failure и fake_confirmation_blocked),
- non-AI сценарии,
- handoff storage и Telegram-поток.

## 8. Integration notes

Теперь `DecisionObject` после enrichment:
- содержит:
  - `scenario`, `context`, `policy`,
  - specialist results (`bookingResult`, `rescheduleResult`, `cancellationResult`),
  - `actionPlan`:
    - `reply` (для RESPOND),
    - `handoff` (для веток low_confidence / HANDOFF / NEED_APPROVAL),
  - `outcome` (тип RESPOND/HANDOFF/NEED_APPROVAL или SKIP),
  - `writer` metadata,
  - `replyQa` metadata.
- связан с:
  - Booking / Reschedule / Cancellation Specialists — через соответствующие поля,
  - Handoff Specialist — через `actionPlan.handoff` и outcome,
  - Writer — через `writer.usedFallback` и `actionPlan.reply`,
  - Reply QA Guard — через `replyQa` (fallback флаг и список issues).

Важно:
- DecisionObject всё ещё не используется как основной исполняемый план:
  - фактические действия (MCP-вызовы, handoff-case creation, отправка ответов) продолжают выполняться старым кодом.
  - DecisionObject — это сейчас структурированный "снимок" принятого решения и плана, который можно использовать для логирования, аналитики и последующей миграции.

## 9. Compatibility notes

- Runtime flow:
  - ни одна ветка принятия решений, ни один MCP-вызов, ни одна отправка сообщений не были изменены функционально.
  - добавленные изменения действуют только на локальный объект `decisionSkeleton` и debug-логи.
- Внешние контракты:
  - не тронуты,
  - все изменения ограничены внутрирепозиториными типами и логикой оркестратора.

## 10. Risks / open questions

- Потенциальные риски:
  - Если в будущем DecisionObject начнёт использоваться как source of truth, нужно будет убедиться, что:
    - все ветки consistently обновляют `outcome` и `actionPlan`,
    - нет расхождения между фактическим поведением и записанным планом.
- Вопросы:
  - В каких местах имеет смысл начать переносить исполнение MCP-вызовов в `ActionPlan.execution`?
  - Как лучше логировать DecisionObject (в БД или внешнем сторидже) для дальнейшего анализа?

## 11. Next recommended step

- Постепенно:
  - добавить запись DecisionObject (или его subset) в `conversation_events` или отдельную diagnostics-таблицу,
  - начать использовать `ActionPlan.execution` как источник правды для MCP-вызовов в ограниченных сценариях,
  - расширять `schedule` поле, подключая deterministicScheduling-результаты.

## 12. Diff summary

- **added**
  - `docs/reports/decision-object-action-plan-enrichment-report.md`
- **modified**
  - `orchestrator/src/types/contracts.ts`
    - добавлены:
      - `WriterMetadata`,
      - `ReplyQaIssueSummary`,
      - `ReplyQaMetadata`,
      - поля `writer?`, `replyQa?` в `DecisionObject`.
  - `orchestrator/src/services/decisionAssembler.ts`
    - незначительное выравнивание интерфейса `DecisionAssemblerInput` (без изменения поведения).
  - `orchestrator/src/services/agentProcessor.ts`
    - enriched:
      - `DecisionObject.actionPlan.handoff` и `outcome` в handoff-ветках,
      - `DecisionObject.actionPlan.reply`, `writer`, `replyQa`, `outcome` в RESPOND-ветке.
- **untouched**
  - Специалисты (booking/reschedule/cancellation/handoff),
  - Writer и Reply QA Guard контракты,
  - Внешние контракты ingest/MCP/gateway/wa-service,
  - admin-ui.

## 13. Validation

- Типы:
  - TypeScript-типизация проходит; новые поля согласованы с уже существующими типами.
  - DecisionObject по-прежнему может использоваться в прежних местах, так как новые поля опциональны.
- Логика:
  - Все изменения вокруг DecisionObject происходят внутри `try`-блока и guarded на наличие `decisionSkeleton`.
  - Ошибки при обогащении DecisionObject не могут сломать runtime-путь обработки сообщений.

## Appendix: DecisionObject after enrichment

Рекомендуемая форма `DecisionObject` (после enrichment) теперь выглядит так:

```ts
export interface DecisionObject {
  scenario: ScenarioRouterResult;      // intent, scenarioCode, confidence, secondarySignals?
  context: ClientContext;              // phone, conversation snapshot, behaviour overrides, language, kb summary
  policy: PolicyResult;                // scenario policy + permissions

  schedule?: ScheduleInterpretationResult; // (для будущей интеграции deterministicScheduling)

  bookingResult?: BookingSpecialistResult;         // normalized booking domain status
  rescheduleResult?: RescheduleSpecialistResult;   // normalized reschedule domain status
  cancellationResult?: CancellationSpecialistResult; // normalized cancellation domain status

  actionPlan: {
    reply: {
      text: string | null;             // финальный текст, отправленный клиенту (в RESPOND-ветке)
      language: ResolvedLanguage;      // язык ответа
    };
    execution: {
      mcpCalls: Array<{
        tool: string;
        payload: Record<string, unknown>;
        mutating: boolean;
      }>;                               // (пока пусто, но готово к будущему использованию)
    };
    handoff?: HandoffPreparationResult | null; // результат Handoff Specialist для веток HANDOFF/NEED_APPROVAL/low_confidence
  };

  outcome: {
    type: 'RESPOND' | 'HANDOFF' | 'NEED_APPROVAL' | 'SKIP';
    reasonCode: DecisionReasonCode;    // 'ok', 'handoff_requested_by_ai', 'handoff_need_approval', 'unknown', ...
    confidence: number;                // confidence модели/решения
  };

  writer?: {
    usedFallback: boolean;             // пришлос ли Writer-у падать на generic_ack
  };

  replyQa?: {
    fallbackUsed: boolean;             // менял ли QA Guard текст на fallback
    issues: Array<{ code: string }>;   // коды найденных QA-проблем (language_mismatch, forbidden_phrase, и т.п.)
  };
}
```

Эта форма остаётся обратноссовместимой, но теперь значительно богаче и пригодна для дальнейшего развития orchestration-слоя.

