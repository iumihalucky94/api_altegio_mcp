# Stage Report: reply-qa-guard-extraction

## 1. Goal

Сформировать Reply QA Guard как отдельный validation-модуль в orchestrator, который:
- проверяет финальный текст ответа перед отправкой клиенту,
- не принимает бизнес-решения заново и не управляет MCP-инструментами,
- может переключить ответ на безопасный fallback при обнаружении явного риска,
- интегрируется в reply flow после Writer без ломки текущего runtime поведения.

## 2. Scope

В рамках этапа:
- создан новый модуль `replyQaGuard.ts` в orchestrator,
- RESPOND-ветка в `agentProcessor.ts` дополнена вызовом QA Guard сразу после Writer,
- остальные ветки (HANDOFF, NEED_APPROVAL, booking errors, non-AI path) не изменялись.

Не трогались:
- admin-ui, prompt strategy,
- booking/reschedule/cancellation/handoff specialists,
- handoff storage (`handoff.ts`, `pending_admin_actions`),
- внешние контракты ingest / MCP / gateway / wa-service.

## 3. Current reply safety findings

Анализ текущего состояния reply-generation показал следующие риски:

- **agentProcessor**
  - В RESPOND-ветке до QA Guard:
    - Writer выбирал текст по схеме:
      - если policy запрещает отвечать → `generic_ack`,
      - иначе → `reply_text` или fallback на `generic_ack` при пустом ответе.
    - Не было финальной проверки:
      - на язык (с учётом `effectiveLang`),
      - на запрещённые фразы (из system prompt),
      - на потенциальные unsafe-подтверждения вне брони (хотя критичный кейс с `fake_confirmation_blocked` уже обрабатывался отдельно),
      - на слишком короткий/пустой текст после Writer.
  - Вспомогательная логика:
    - уже есть блок, который перехватывает «фейковое подтверждение без `create_appointment`» и переводит в handoff,
    - но нет отдельного слоя для мягких валидаторов стиля/языка.

- **writer.ts**
  - Инкапсулирует выбор между `reply_text` и системным `generic_ack` на основе policy.
  - Специально не проверяет:
    - язык текста,
    - forbidden phrases,
    - семантические риски (подтверждения, обещания и т.д.).

- **localization.ts**
  - Даёт корректные многоязычные системные сообщения.
  - Логика безопасных fallback-ов уже есть, но не всегда используется как финальный «стоп-кран» перед отправкой.

- **existing fallback paths**
  - Уже есть хорошие fallbacks для:
    - `booking_failed`,
    - `booking_not_confirmed_fallback`,
    - `generic_ack`,
    - deterministic scheduling сообщений.
  - Но не было отдельного QA-слоя, который в спорных случаях предпочёл бы падать на `generic_ack`, не меняя decision flow.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/writer.ts`
- `orchestrator/src/services/localization.ts`
- `orchestrator/src/prompts/aiAgentSystemPrompt.ts`
- `orchestrator/src/types/contracts.ts`

## 5. New module created

- **name**: `orchestrator/src/services/replyQaGuard.ts`
- **purpose**:
  - Выполнить лёгкую безопасную проверку уже сформированного ответа перед отправкой:
    - язык/скрипт,
    - запрещённые фразы,
    - пустота/слабый текст,
    - диагностическая проверка unsafe-подтверждений.
  - При необходимости заменить текст на безопасный системный fallback (`generic_ack`).
- **key inputs** (`ReplyQaGuardInput`):
  - `scenarioCode: ScenarioCode` — код сценария (пока используется для контекста; правила не зависят от него).
  - `language: ResolvedLanguage` — язык ответа, полученный ранее через routing/localization.
  - `text: string` — текст, сформированный Writer.
  - `writerUsedFallback: boolean` — флаг, показывающий, был ли уже использован fallback Writer-ом.
  - `allowAgentToReply: boolean` — policy-флаг (`safePolicy.allow_agent_to_reply`).
  - `bookingToolSucceeded?: boolean` — факт успешного `create_appointment` (для диагностики unsafe confirmation).
  - `replyLooksConfirmed?: boolean` — эвристика из `agentProcessor`, выявляющая фразы “подтвержден / confirmed / booked ...”.
- **key outputs** (`ReplyQaGuardResult`):
  - `approved: boolean` — на данном этапе всегда `true` (guard не блокирует отправку, только может заменить текст).
  - `fallbackUsed: boolean` — был ли заменён текст на fallback внутри guard.
  - `finalText: string` — итоговый текст для отправки клиенту.
  - `issues: ReplyQaIssue[]` — список обнаруженных проблем.
- **what existing logic it wraps/reuses**:
  - Использует `getSystemMessage('generic_ack', language)` из `localization.ts`.
  - Опирается на уже вычисленные флаги и эвристики (`allowAgentToReply`, `replyLooksConfirmed`, `createAppointmentSucceeded`).

## 6. QA model

- **QA input/output shape**:
  - Локально определённые типы:
    - `ReplyQaGuardInput`,
    - `ReplyQaIssue` (`code` + `message`),
    - `ReplyQaGuardResult`.
- **Реализованные проверки**:
  - `empty_or_weak`:
    - Если `allowAgentToReply = false`:
      - guard сразу возвращает `generic_ack` и issue `empty_or_weak` с комментарием, что ответ заблокирован policy.
    - Если текст после Writer пустой или слишком короткий (`length < 3`):
      - добавляется issue `empty_or_weak`,
      - текст заменяется на `generic_ack`, `fallbackUsed = true`.
  - `language_mismatch`:
    - Использует простые эвристики по скриптам:
      - для `ru` — ожидается наличие кириллицы; если есть только латиница/умлауты, считается mismatch.
      - для `de` — ожидается латиница/умлауты; если чистая кириллица без латиницы, считается mismatch.
      - для `en` — ожидается латиница; если есть только кириллица, считается mismatch.
    - При mismatch:
      - добавляется issue `language_mismatch`,
      - текст подменяется на `generic_ack`, `fallbackUsed = true`.
  - `forbidden_phrase`:
    - Список фраз из блока `NEVER SAY` system prompt (немецкие формулировки):
      - `"Das ist unmöglich"`, `"Das geht nicht"`, и т.д. (в коде — в нижнем регистре).
    - Если одна из фраз встречается в тексте:
      - добавляется issue `forbidden_phrase`,
      - текст подменяется на `generic_ack`, `fallbackUsed = true`.
  - `unsafe_confirmation` (диагностически):
    - Если `replyLooksConfirmed === true` и `bookingToolSucceeded === false`:
      - добавляется issue `unsafe_confirmation`,
      - текст **не** переписывается (критичный кейс уже покрыт отдельной веткой `fake_confirmation_blocked` в `agentProcessor`).
- **Используемые fallbacks**:
  - Везде используется `getSystemMessage('generic_ack', language)` как нейтральный, безопасный fallback.
- **Что guard сознательно НЕ делает**:
  - Не изменяет decision (`RESPOND/HANDOFF/NEED_APPROVAL`).
  - Не вызывает MCP tools и не меняет booking/handoff flow.
  - Не пересчитывает сценарий или intent.
  - Не переписывает текст модели по смыслу — только заменяет его на общий ack при явных проблемах.

## 7. Changes in agentProcessor

Изменения сделаны только в RESPOND-ветке:

- **imports**:
  - Добавлен импорт `runReplyQaGuard` из `replyQaGuard.ts`.

- **ранее**:
  - После обработки MCP-вызовов создавался `replyToSend` через Writer:
    - `writerOutput = writeReply(...)`
    - `replyToSend = writerOutput.text`
  - Лог в summary: `AI RESPOND (confidence X) writer_used_fallback=...`.

- **теперь**:
  - После Writer вызывается QA Guard:
    - `const qaResult = runReplyQaGuard({ scenarioCode, language: effectiveLang, text: writerOutput.text, writerUsedFallback: writerOutput.usedFallback, allowAgentToReply: safePolicy.allow_agent_to_reply, bookingToolSucceeded: createAppointmentSucceeded, replyLooksConfirmed });`
    - `replyToSend = qaResult.finalText`
  - Summary-лог расширен:
    - `AI RESPOND (confidence X) writer_used_fallback=... qa_fallback_used=... qa_issues=...`
- **оставлено как есть**:
  - Логика `createAppointmentFailed` / `createAppointmentSucceeded` и ветка `fake_confirmation_blocked` (с `booking_not_confirmed_fallback` и handoff) — не изменялись.
  - Не-AI replies, HANDOFF/NEED_APPROVAL ветки, deterministic scheduling, booking/reschedule/cancellation specialists — без изменений.

## 8. Integration notes

- Writer и Reply QA Guard теперь образуют цепочку:
  - Writer: выбирает текст между LLM-ответом и системным fallback-ом по policy.
  - QA Guard: проверяет полученный текст на базовые риски и при необходимости заменяет его на `generic_ack`.
- Интеграция QA Guard:
  - используется только в RESPOND-ветке,
  - не влияет на выбор decision и MCP-поведение,
  - даёт дополнительную диагностическую информацию через summary лог.

## 9. Compatibility notes

- Runtime flow:
  - Сохраняет предыдущее поведение:
    - если policy запрещает ответы — всё равно отправляется `generic_ack` (Writer + Guard согласованы).
    - если `reply_text` корректен — он проходит, если не нарушает простых правил языка/запрещённых фраз.
  - В edge-кейсах (language mismatch, forbidden phrases, слишком короткий текст) guard заменяет текст на `generic_ack`, что считается безопасным ужесточением, а не ломкой логики.
- Остальной код:
  - Не был изменён, кроме добавления QA Guard в RESPOND-ветку.

## 10. Risks / open questions

- Возможные будущие улучшения:
  - более точная language-детекция для смешанных сообщений,
  - сценарий-специфичные проверки (например, более строгий контроль подтверждений в booking-сценариях).
- Открытые вопросы:
  - Какие дополнительные фразы следует считать запрещёнными на других языках?
  - Нужно ли логировать `issues` в БД (conversation_events) для аналитики (сейчас — только в summary-строке)?

## 11. Next recommended step

- На следующем этапе можно:
  - добавить `ReplyQaGuardResult` в `DecisionObject` как часть диагностической информации,
  - использовать QA Guard также для non-AI ответов (e.g. deterministic/system-only replies),
  - расширять список проверок постепенно, сохраняя принцип «simple & safe».

## 12. Diff summary

- **added**
  - `orchestrator/src/services/replyQaGuard.ts`
  - `docs/reports/reply-qa-guard-extraction-report.md`
- **modified**
  - `orchestrator/src/services/agentProcessor.ts` — RESPOND-ветка теперь вызывает Reply QA Guard после Writer и использует `qaResult.finalText`.
- **untouched**
  - Writer, localization, specialists (booking/reschedule/cancellation/handoff),
  - handoff storage flow, admin-ui, external contracts.

## 13. Validation

- Типы:
  - `ReplyQaGuardInput` и `ReplyQaGuardResult` используют уже существующие `ScenarioCode` и `ResolvedLanguage`; модуль компилируется.
  - Изменения в `agentProcessor.ts` проходят type-check.
- Логика:
  - При стандартных корректных ответах guard не меняет текст.
  - При запрещённых/подозрительных текстах guard мягко переводит ответ на `generic_ack`, что не ломает сценарий, а делает его безопаснее.

## Appendix: Reply flow after QA guard extraction

1. Клиент отправляет сообщение; orchestrator обрабатывает его через `processWithAiAgent`.
2. Определяются `intent`, `scenarioCode`, язык (`lang`, `effectiveLang`), policy-права, контекст.
3. LLM возвращает JSON с `decision`, `confidence`, `reply_text`, `mcp_calls`, `handoff`, `tags`.
4. В зависимости от `decision` и confidence:
   - при низкой уверенности или HANDOFF/NEED_APPROVAL — срабатывают существующие ветки handoff/approval.
5. В RESPOND-ветке:
   - обрабатываются `mcp_calls` (включая `create_appointment`), выставляются флаги `createAppointmentFailed`/`createAppointmentSucceeded`.
   - выполняются проверки booking-failure и fake-confirmation; при ошибках flow уходит в handoff, а RESPOND-ветка заканчивается.
6. Если нет критических booking-ошибок:
   - вызывается Writer:
     - строится `WriterInput` из `scenarioCode`, `effectiveLang`, `result.reply_text`, `safePolicy.allow_agent_to_reply`.
     - Writer возвращает `WriterOutput` с `text` и `usedFallback`.
7. Затем вызывается Reply QA Guard:
   - строится `ReplyQaGuardInput` из:
     - `scenarioCode`, `language: effectiveLang`,
     - `text: writerOutput.text`,
     - `writerUsedFallback: writerOutput.usedFallback`,
     - `allowAgentToReply: safePolicy.allow_agent_to_reply`,
     - `bookingToolSucceeded: createAppointmentSucceeded`,
     - `replyLooksConfirmed` (эвристика).
   - guard выполняет проверки (язык, запрещённые фразы, пустота, unsafe confirmation diag).
   - возвращает `ReplyQaGuardResult` с `finalText` и списком `issues`.
8. `qaResult.finalText` используется как `replyToSend`; ответ логируется в `conversation_events` и отправляется клиенту через `sendAndLog`.
9. В summary-лог добавляется информация о fallback-ах Writer/QA Guard и кодах обнаруженных issues.
10. Остальные слои (policy, MCP, handoff, audit, admin-ui) работают так же, как и до extraction, но теперь финальный текст проходит дополнительный QA-фильтр.

