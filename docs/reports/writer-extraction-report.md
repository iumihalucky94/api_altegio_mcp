# Stage Report: writer-extraction

## 1. Goal

Выделить Writer как отдельный communication-модуль в orchestrator, который:
- отвечает только за формулировку финального клиентского текста,
- не принимает бизнес-решения и не управляет MCP-инструментами,
- опирается на уже существующий decision/context слой и локализацию,
- частично и безопасно интегрирован в `agentProcessor` без ломки текущего runtime flow.

## 2. Scope

В рамках этапа:
- создан новый модуль `writer.ts` в orchestrator,
- минимально адаптирован `agentProcessor.ts` в ветке `RESPOND` для использования Writer,
- существующая логика policy / MCP / deterministic / handoff не изменялась.

Не трогались:
- Reply QA Guard,
- prompt strategy и system prompt,
- handoff storage flow (`handoff.ts`, `pending_admin_actions`),
- booking/reschedule/cancellation runtime behaviour,
- admin-ui и внешние контракты ingest/MCP/gateway/wa-service.

## 3. Current reply generation flow findings

Найдены части customer-facing reply logic:

- **agentProcessor**
  - В non-AI ветке (`processBatch` при отсутствии API-ключа):
    - Формирует ответы через `getSystemMessage('upcoming_appointments' | 'generic_reply')` с `defaultEffectiveLang`.
  - В AI ветке (`processWithAiAgent`), после вызова LLM:
    - Проверка confidence:
      - при `result.confidence < threshold` — создаётся handoff (без ответа клиенту или с ack в отдельных ветках).
    - Ветка `decision === 'HANDOFF'`:
      - создаётся handoff, иногда отправляется `result.reply_text` как holding message.
    - Ветка `decision === 'NEED_APPROVAL'`:
      - создаётся handoff, при наличии policy допуска — отправляется `result.reply_text` или `generic_ack`.
    - Ветка `decision === 'RESPOND'`:
      - до Writer Extraction финальный текст считался так:
        - если `!safePolicy.allow_agent_to_reply`:
          - `replyToSend = getSystemMessage('generic_ack', effectiveLang)`;
        - иначе:
          - `replyToSend = result.reply_text || getSystemMessage('generic_ack', effectiveLang)`;
      - затем текст логировался в `conversation_events` и отправлялся через `sendAndLog`.

- **localization.ts**
  - Определяет:
    - `ResolvedLanguage` (`'de' | 'ru' | 'en'`),
    - `resolveReplyLanguage` и `effectiveLangForReply` (для mixed/heuristics),
    - `getSystemMessage(key, lang, vars?)` с ключами:
      - `booking_failed`, `booking_not_confirmed_fallback`,
      - `generic_ack`, `handoff_ack`,
      - `upcoming_appointments`, `generic_reply`,
      - deterministic-scheduling сообщения (`requested_date_not_open`, `working_time_violation`, ...).
  - Это единый i18n-слой для системных сообщений.

- **AI/prompt flow**
  - Основной system prompt (`aiAgentSystemPrompt.ts`) задаёт:
    - структуру ответов,
    - стиль/тон,
    - requirement JSON-ответа c `reply_text` и `decision`.
  - Ответ модели:
    - `reply_text` — кандидат текста для клиента,
    - `decision` — ветка (`RESPOND`, `HANDOFF`, `NEED_APPROVAL`),
    - `mcp_calls` — список действий,
    - `tags` — для диагностики.

- **fallback/system replies**
  - В местах, где нельзя отвечать напрямую (policy, errors), используется `getSystemMessage('generic_ack', lang)` или специализированные фоллбеки (`booking_failed`, `booking_not_confirmed_fallback`).

- **KB templates/examples/playbooks**
  - Используются для контекста внутри промпта (в `callAiAgent` через `kb_text`), но напрямую не участвуют в runtime reply-building вне LLM.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/localization.ts`
- `orchestrator/src/prompts/aiAgentSystemPrompt.ts`
- `orchestrator/src/types/contracts.ts`
- `docs/reports/...` предыдущих этапов (для понимания целевой архитектуры dispatcher + specialists).

## 5. New module created

- **name**: `orchestrator/src/services/writer.ts`
- **purpose**:
  - Централизовать формирование финального текста клиенту в одной точке,
  - использовать локализацию и policy-права (`allow_agent_to_reply`) для выбора между:
    - текстом модели (`reply_text`),
    - безопасным системным ack (`generic_ack`),
  - не вмешиваться в бизнес-решения, MCP-вызовы и handoff.
- **key inputs** (`WriterInput`):
  - `scenarioCode: ScenarioCode` — код сценария (пока используется для будущего расширения; в текущей версии не влияет на текст).
  - `language: ResolvedLanguage` — язык ответа (из `effectiveLang`).
  - `replyCandidate: string | null` — кандидат ответа от LLM (`result.reply_text`).
  - `allowAgentToReply: boolean` — флаг из policy (`safePolicy.allow_agent_to_reply`), определяющий, может ли агент вообще отвечать.
- **key outputs** (`WriterOutput`):
  - `text: string` — финальный текст для клиента.
  - `usedFallback: boolean` — флаг, показывающий, был ли использован системный fallback вместо LLM-ответа.
- **what existing logic it wraps/reuses**:
  - Использует `getSystemMessage('generic_ack', language)` из `localization.ts`.
  - Оборачивает уже существующую логику:
    - "если policy запрещает отвечать → generic_ack",
    - "если reply_text пустой → generic_ack".

## 6. Writer model

- **Writer input/output shape**:
  - `WriterInput` и `WriterOutput` объявлены локально в `writer.ts`:
    - Это минимальный контракт, завязанный на уже существующие типы (`ScenarioCode`, `ResolvedLanguage`).
- **Определение language/style**:
  - Writer получает уже подготовленный `language: ResolvedLanguage`, который:
    - вычисляется ранее через `effectiveLangForReply` / routing,
    - учитывает mixed-language и предпочтения клиента.
  - Стиль определяется:
    - либо моделью (когда используется `replyCandidate`),
    - либо системным сообщением `generic_ack` (уже локализованным и стилизованным).
- **Использование localization / KB / expectations**:
  - Writer напрямую использует только `localization.ts` (system messages).
  - KB и playbooks продолжают использоваться через LLM (формируют `reply_text`).
  - Writer не меняет system prompt и не создаёт новый i18n слой.
- **Что Writer сознательно НЕ делает**:
  - Не решает, нужно ли делать handoff или approval.
  - Не управляет MCP-вызовами.
  - Не проверяет слоты или политику.
  - Не переписывает или валидирует содержимое `reply_text` — только выбирает между ним и системным fallback-ом.

## 7. Changes in agentProcessor

Внесены минимальные изменения в ветке `result.decision === 'RESPOND'`:

- **imports**:
  - Добавлен импорт `writeReply` из `writer.ts`.

- **ранее**:
  - `replyToSend` вычислялся так:
    - `const replyToSend = !safePolicy.allow_agent_to_reply
        ? getSystemMessage('generic_ack', effectiveLang)
        : (result.reply_text || getSystemMessage('generic_ack', effectiveLang));`
- **теперь**:
  - используется Writer:
    - `const writerOutput = writeReply({
        scenarioCode,
        language: effectiveLang,
        replyCandidate: result.reply_text ?? null,
        allowAgentToReply: safePolicy.allow_agent_to_reply
      });`
    - `const replyToSend = writerOutput.text;`
  - логирование в summary дополнено:
    - `AI RESPOND (confidence X) writer_used_fallback=...`
- **оставлено как есть**:
  - Ветви HANDOFF / NEED_APPROVAL / booking_failed / fake_confirmation_blocked:
    - по-прежнему используют `getSystemMessage`/handoff-логику напрямую.
  - Нон-AI ветка (`generic_reply`, `upcoming_appointments`) пока не использует Writer.
  - Логика policy, MCP-вызовов и deterministic scheduling не тронута.

## 8. Integration notes

- Writer сейчас:
  - используется только в одной точке — `decision === 'RESPOND'`,
  - не меняет формат ответа, только инкапсулирует выбор текста.
- Интеграция:
  - Writer опирается на уже вычисленный `scenarioCode`, `effectiveLang` и policy-флаги,
  - возвращает текст, который затем передаётся в уже существующую функцию `sendAndLog`.
- Это создаёт явный communication-слой для RESPOND-ветки, на который можно будет навесить Reply QA Guard в будущем.

## 9. Compatibility notes

- Поведение:
  - Writer реализует ту же самую логическую ветку, что и было до этого этапа:
    - при `allow_agent_to_reply = false` → `generic_ack`,
    - при пустом `reply_text` → `generic_ack`,
    - иначе → `reply_text`.
  - Дополнительное поле `usedFallback` только логируется в summary и не влияет на клиента.
- Остальные ветки:
  - Handoff/approval/booking ошибки, deterministic-scheduling и non-AI-путь не изменены.
- Таким образом, runtime-поведение по формированию текста в RESPOND-ветке сохраняется, но теперь инкапсулировано в Writer.

## 10. Risks / open questions

- На следующих этапах:
  - Writer может быть расширен для:
    - выбора разных шаблонов/тональности по `scenarioCode`,
    - более глубокого использования KB (например, шаблонов) без ломки policy.
  - Появится Reply QA Guard, который будет проверять текст до отправки.
- Вопросы:
  - В каких сценариях имеет смысл всегда предпочитать системные шаблоны (например, для некоторых policy violations)?
  - Нужно ли логировать writer input/output в `DecisionObject` для более глубокой диагностики (сейчас это только в summary-line)?

## 11. Next recommended step

- В будущем:
  - добавить writer-результат в `DecisionObject.actionPlan.reply` через `DecisionAssembler`,
  - использовать Writer также для non-AI фоллбеков (upcoming/generic),
  - навесить Reply QA Guard поверх Writer, чтобы:
    - блокировать потенциально опасные формулировки,
    - проверять соответствие языку и стилю,
    - при необходимости переключаться на системные шаблоны.

## 12. Diff summary

- **added**
  - `orchestrator/src/services/writer.ts`
  - `docs/reports/writer-extraction-report.md`
- **modified**
  - `orchestrator/src/services/agentProcessor.ts` — RESPOND-ветка теперь использует Writer для выбора финального текста и логирует `writer_used_fallback`.
- **untouched**
  - `orchestrator/src/services/localization.ts`
  - `orchestrator/src/types/contracts.ts` (Writer-типы локальные в модуле)
  - handoff/bookings/reschedule/cancellation specialists
  - `handoff.ts`, admin-ui, gateway/wa-service/ingest контракты.

## 13. Validation

- Типы:
  - `WriterInput` и `WriterOutput` используют уже существующие `ScenarioCode` и `ResolvedLanguage`; модуль компилируется.
  - Изменения в `agentProcessor.ts` не ломают типизацию.
- Поведение:
  - Проверка логики Writer показывает, что он повторяет прежнее ветвление по `allowAgentToReply` и `reply_text`.
  - RESPOND-ветка по-прежнему:
    - отправляет системный ack при запрете reply,
    - использует текст LLM при наличии `reply_text`,
    - использует fallback при пустом ответе.

## Appendix: Reply flow after writer extraction

1. Клиент отправляет сообщение; orchestrator обрабатывает его в `processWithAiAgent`.
2. Определяются `intent`, `scenarioCode`, язык (`lang`, `effectiveLang`), policy-права и контекст (appointments, KB, FREE_SLOTS и т.д.).
3. LLM вызывается через `callAiAgent` с контекстом; возвращает JSON с `decision`, `confidence`, `reply_text`, `mcp_calls`, `handoff`, `tags`.
4. При низкой уверенности, HANDOFF или NEED_APPROVAL — запускаются соответствующие ветки; Writer здесь не используется.
5. Если `decision === 'RESPOND'`:
   - orchestrator обрабатывает `mcp_calls` (create_appointment и др.) и проверяет ошибки; при критических ошибках может перейти в handoff-ветку.
6. Если нет критических booking-ошибок:
   - формируется `WriterInput` с:
     - `scenarioCode`,
     - `language: effectiveLang`,
     - `replyCandidate: result.reply_text`,
     - `allowAgentToReply: safePolicy.allow_agent_to_reply`.
7. Вызывается `writeReply(input)`:
   - если агенту нельзя отвечать → возвращает `generic_ack` + `usedFallback=true`,
   - если `reply_text` есть → возвращает его + `usedFallback=false`,
   - если `reply_text` пустой → возвращает `generic_ack` + `usedFallback=true`.
8. `WriterOutput.text` используется как `replyToSend`; длина сообщения логируется в `conversation_events`, а сам текст отправляется клиенту через `sendAndLog`.
9. В summary-лог пишется строка с указанием confidence и `writer_used_fallback`, что позволяет анализировать, как часто приходилось падать на системный ack.
10. Остальные слои (policy, MCP, handoff, audit) работают так же, как и до extraction, но теперь выбор финального текста инкапсулирован в Writer.

