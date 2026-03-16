# Stage Report: decision-object-persistence-diagnostics

## 1. Goal

Сделать enriched `DecisionObject` наблюдаемым через существующую event-инфраструктуру, не меняя runtime flow:
- сохранять компактный diagnostic snapshot в `conversation_events`,
- использовать его для аналитики и review,
- не создавать новую тяжёлую storage-схему.

## 2. Scope

В рамках этапа:
- добавлен diagnostics helper для сериализации `DecisionObject`,
- добавлен новый event type в `conversation_events`-слой,
- `agentProcessor` начал писать snapshot в ограниченных ключевых точках (handoff/RESPOND).

Не делалось:
- новая таблица в БД,
- изменение ingest/MCP/gateway/wa-service контрактов,
- полный перевод исполнения на DecisionObject.

## 3. Current diagnostics/logging findings

До этапа:
- **debug logs**:
  - `agentProcessor` логировал `decisionSkeleton` в debug при построении,
  - также логировались handoff-подготовка, MCP-вызовы, AI-решения и т.д.
  - проблема: debug-логи трудно агрегировать и анализировать постфактум.
- **conversation_events**:
  - уже использовались для:
    - `language_detected`,
    - `intent_detected`,
    - `scenario_selected`,
    - `policy_applied`,
    - `tool_called` / `tool_succeeded` / `tool_failed`,
    - `handoff_created`,
    - `reply_sent` / `reply_blocked`,
    - `execution_denied_by_policy` и пр.
  - но не было единого snapshot-события, агрегирующего всё принятые решения и планы для сообщения.
- **summary logs**:
  - через `sendToSummary` писались короткие строки:
    - AI RESPOND / HANDOFF / NEED_APPROVAL,
    - флаги вроде `writer_used_fallback`, `qa_fallback_used`, `qa_issues`.
  - полезно для быстрой отладки, но не структурировано для машинной аналитики.
- **handoff events**:
  - через `handoff_created` и `pending_admin_actions` был хороший след handoff-потока.
  - однако эти события не включали полный контекст решения (policy, specialists, writer/QA).

Не хватало:
- централизованного, структурированного snapshot-а enriched `DecisionObject`, который:
  - был бы лёгким,
  - писалcя в `conversation_events`,
  - агрегировал бы основные решения (scenario, policy, specialists, handoff, reply, writer/QA).

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/conversationEvents.ts`
- `orchestrator/src/types/contracts.ts`
- ранее созданный отчёт `decision-object-action-plan-enrichment-report.md`

## 5. New diagnostics module / helper

- **name**: `orchestrator/src/services/decisionDiagnostics.ts`
- **purpose**:
  - аккуратно сериализовать enriched `DecisionObject` в компактный diagnostic payload,
  - сохранять его в `conversation_events` через существующую функцию `appendConversationEvent`,
  - быть полностью best-effort (ошибки не ломают основной flow).
- **key inputs**:
  - `DbPool` — подключение к БД.
  - `conversationId: string` — идентификатор беседы.
  - `decision: DecisionObject` — уже обогащённый DecisionObject.
  - `options?: { maxTextLength?: number }` — опциональная настройка для ограничения длины текстовых полей.
- **key outputs**:
  - Побочный эффект: запись события `decision_object_enriched` в `conversation_events`.
  - Публичный API: `persistDecisionSnapshot(...)`.
- **what existing logic it wraps/reuses**:
  - Использует `appendConversationEvent` для записи события.
  - Опирается на текущую структуру `DecisionObject` (scenario/policy/specialists/actionPlan/outcome/writer/replyQa).

## 6. Diagnostic snapshot model

В `persistDecisionSnapshot` формируется payload:

```ts
const payload = {
  scenario: {
    intent: decision.scenario.intent,
    code: decision.scenario.scenarioCode,
    confidence: decision.scenario.confidence
  },
  policy: {
    scenarioCode: decision.policy.scenarioCode,
    permissions: decision.policy.permissions
  },
  specialists: {
    booking: decision.bookingResult
      ? { status, domainStatus, reasonCode }
      : null,
    reschedule: decision.rescheduleResult
      ? { status, domainStatus, reasonCode }
      : null,
    cancellation: decision.cancellationResult
      ? { status, domainStatus, reasonCode }
      : null
  },
  handoff: decision.actionPlan.handoff
    ? {
        reasonCode,
        priority,
        summary: trimmedSummary
      }
    : null,
  reply: {
    text: trimmedReply,
    language: decision.actionPlan.reply.language
  },
  outcome: decision.outcome,
  writer: decision.writer ?? null,
  replyQa: decision.replyQa ?? null
};
```

Где:
- `trimmedReply` и `summary` усечены до `maxTextLength` (по умолчанию 500 символов).

**Почему именно этот subset**:
- **scenario**:
  - даёт понимание intent/scenario code + confidence.
- **policy**:
  - фиксирует scenarioCode и разрешения (reply/execute/handoff/approval).
- **specialists**:
  - нормализованный статус booking/reschedule/cancellation среди domain-specific статусов и reason codes.
- **handoff**:
  - фиксирует, было ли handoff-подготовка и с каким reasonCode/priority/summary.
- **reply**:
  - финальный текст (усечённый) и язык ответа.
- **outcome**:
  - финальный тип решения (RESPOND/HANDOFF/NEED_APPROVAL/SKIP) и reasonCode/ confidence.
 - **writer/replyQa**:
  - отражают, использовались ли fallbacks и какие QA-issues были найдены.

Сознательно **не** сохраняются:
- полный `ClientContext` и history,
- `kbContextSummary`,
- полная форма DecisionObject (только сжатый, полезный subset), чтобы не раздувать payload.

## 7. Event integration

- Используется новый event type:
  - `decision_object_enriched`.
- Snapshot пишется через `appendConversationEvent`:
  - `event_type = 'decision_object_enriched'`,
  - `event_payload_json = payload` (как выше).
- Точки интеграции в flow:
  - в low-confidence ветке, после `createHandoffAndPauseWithSummary(...)`, при наличии `decisionSkeleton`;
  - в ветке `decision === 'HANDOFF'`, после `createHandoffAndPauseWithSummary(...)`, при наличии `decisionSkeleton`;
  - в ветке `decision === 'NEED_APPROVAL'`, после `createHandoffAndPauseWithSummary(...)`, при наличии `decisionSkeleton`;
  - в RESPOND-ветке, после `sendAndLog(...)` финального ответа клиенту, при наличии `decisionSkeleton`.

## 8. Changes in agentProcessor

- Добавлен импорт:
  - `persistDecisionSnapshot` из `decisionDiagnostics.ts`.
- В трёх handoff-ветках:
  - после вызова `createHandoffAndPauseWithSummary(...)`:
    - если `decisionSkeleton` не `null`, вызывается `await persistDecisionSnapshot(db, conversationId, decisionSkeleton);`.
- В RESPOND-ветке:
  - после `sendAndLog(...)`:
    - если `decisionSkeleton` не `null`, также вызывается `await persistDecisionSnapshot(db, conversationId, decisionSkeleton);`.
- Сознательно не тронуто:
  - выбор веток (HANDOFF/NEED_APPROVAL/RESPOND),
  - вызовы MCP-инструментов,
  - deterministic-layer,
  - Writer и QA Guard (кроме чтения их metadata для snapshot).

## 9. Compatibility notes

- `persistDecisionSnapshot` использует `try/catch`:
  - любые ошибки записи diagnostics в `conversation_events` заглушаются,
  - это гарантирует, что клиентский flow не ломается при сбое диагностики.
- В `agentProcessor` запись snapshot происходит только **после** основных действий (handoff/ответ клиенту), и только если `decisionSkeleton` успешно построен.

## 10. Risks / open questions

- Риск роста объёма `conversation_events`:
  - mitigated за счёт:
    - усечения текстов до разумной длины,
    - записи snapshot только в ключевых ветках.
- Открытые вопросы:
  - нужна ли отдельная retention-политика для `decision_object_enriched`,
  - нужно ли в будущем индексировать этот event type для быстрой аналитики.

## 11. Next recommended step

- Возможные следующие шаги:
  - добавить viewer/фильтрацию по `decision_object_enriched` в admin-инструментах,
  - использовать snapshot для semi-автоматического review/quality scoring,
  - при необходимости расширить snapshot небольшим количеством дополнительных полей (например, более подробным schedule-состоянием).

## 12. Diff summary

- **added**
  - `orchestrator/src/services/decisionDiagnostics.ts`
  - `docs/reports/decision-object-persistence-diagnostics-report.md`
- **modified**
  - `orchestrator/src/services/agentProcessor.ts` — добавлены вызовы `persistDecisionSnapshot` в low-confidence/HANDOFF/NEED_APPROVAL/RESPOND ветках.
- **untouched**
  - `orchestrator/src/types/contracts.ts` (используется уже существующий enriched `DecisionObject`),
  - conversation events schema,
  - ingest/MCP/gateway/wa-service контракты,
  - admin-ui.

## 13. Validation

- Типы:
  - `persistDecisionSnapshot` принимает `DecisionObject` и использует только уже существующие поля; типизация проходит.
- Runtime:
  - при нормальной работе:
    - в ключевых ветках появляется дополнительное событие `decision_object_enriched`;
  - при сбое diagnostics:
    - client reply / handoff / MCP-вызовы продолжают работать, так как исключения заглушаются внутри helper-а.

## Appendix: Example diagnostic payload

Пример компактного payload (структура):

```json
{
  "scenario": {
    "intent": "BOOKING",
    "code": "booking",
    "confidence": 0.98
  },
  "policy": {
    "scenarioCode": "booking",
    "permissions": {
      "canReply": true,
      "canExecuteMutating": false,
      "canCreateHandoff": true,
      "requiresAdminApproval": true,
      "confidenceThreshold": 0.97
    }
  },
  "specialists": {
    "booking": {
      "status": "ok",
      "domainStatus": "exact_slot_available",
      "reasonCode": "booking_exact_slot_available"
    },
    "reschedule": null,
    "cancellation": null
  },
  "handoff": null,
  "reply": {
    "text": "Привет! Да, у нас есть свободное окно на завтра в 15:00. Подойдёт ли вам это время?",
    "language": "ru"
  },
  "outcome": {
    "type": "RESPOND",
    "reasonCode": "ok",
    "confidence": 0.98
  },
  "writer": {
    "usedFallback": false
  },
  "replyQa": {
    "fallbackUsed": false,
    "issues": []
  }
}
```

