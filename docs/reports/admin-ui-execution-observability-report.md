# Stage Report: admin-ui-execution-observability

## 1. Goal

Сделать execution subset (`execution.mcpCalls[]` из `decision_object_enriched`) видимым в admin-ui:
- чтобы администратор видел, какие MCP-инструменты вызывались по факту,
- различал `mutating`/`non-mutating`, `executed`/`skipped`/`failed`,
- без изменения storage модели и без redesign admin-панели.

## 2. Scope

В этом этапе:
- обновлён diagnostics block на странице событий (`events.ejs`), чтобы он отображал execution subset,
- backend-часть (route `/events/:conversationId`) не менялась по сути,
- остальные страницы admin-ui не затрагивались.

Не делалось:
- новый UI framework,
- изменение `conversation_events` схемы или orchestrator/gateway контрактов,
- полная миграция исполнения на ActionPlan.

## 3. Current UI diagnostics findings

До этапа:
- **Decision snapshot в admin-ui** (после admin-ui-decision-observability):
  - Страница `/events/:conversationId` уже показывала:
    - Scenario (intent, scenarioCode, confidence),
    - Policy permissions (canReply, canExecuteMutating, canCreateHandoff, requiresAdminApproval, confidenceThreshold),
    - Specialists (booking/reschedule/cancellation summary),
    - Outcome (type, reasonCode, confidence),
    - Reply/Handoff (язык, сокращённый текст, reason/priority/summary),
    - Writer/QA (usedFallback, issues).
  - Также был collapsible блок с raw `decision_object_enriched` JSON.
- **Execution subset**:
  - Уже сохранялся в snapshot-е из orchestrator (`decisionDiagnostics.ts`) как:
    ```json
    "execution": {
      "mcpCalls": [
        { "tool": "crm.create_appointment", "mutating": true, "status": "executed", "note": null }
      ]
    }
    ```
  - Но на уровне admin-ui:
    - не было отдельного раздела, который явно визуализировал эти данные,
    - execution можно было увидеть только в raw JSON, что неудобно для быстрого анализа.

Не хватало:
- человекочитаемого execution блока, встроенного в уже существующий diagnostics card.

## 4. Files reviewed

- `admin-ui/views/events.ejs`
- `admin-ui/server.js` (маршрут `/events/:conversationId`)
- `docs/reports/action-plan-execution-booking-pilot-report.md`
- `orchestrator/src/services/decisionDiagnostics.ts` (структура execution subset в snapshot-е)

## 5. UI integration approach

Подход:
- интегрировать execution section **внутрь уже существующего diagnostics card** на `events.ejs`,
- не трогать таблицу всех событий и навигацию,
- использовать данные из `d.execution.mcpCalls` (где `d` — payload последнего `decision_object_enriched`).

Почему так:
- diagnostics card уже является сводкой по DecisionObject (scenario/policy/specialists/outcome/reply/handoff/writer/QA),
- логично добавить execution именно туда, чтобы админ видел всю картину решения в одном блоке,
- не требуется новый route или отдельная страница.

## 6. Rendering model

Изменения в `admin-ui/views/events.ejs`:

- В diagnostics card (второй столбец `grid-2`), после блока Writer/QA, добавлен раздел:

```ejs
<h3 class="section-subtitle">Execution</h3>
<% const exec = d.execution && Array.isArray(d.execution.mcpCalls) ? d.execution.mcpCalls : []; %>
<% if (exec.length > 0) { %>
  <ul class="list">
    <% exec.forEach(call => { %>
      <li>
        <code><%= call.tool %></code>
        — mutating: <%= String(call.mutating) %>,
        status: <code><%= call.status || 'n/a' %></code>
        <% if (call.note) { %>
          <br><small><%= call.note %></small>
        <% } %>
      </li>
    <% }); %>
  </ul>
<% } else { %>
  <p>Execution data: —</p>
<% } %>
```

- Отображаемые поля:
  - `tool` — как `crm.create_appointment`, `admin.*`, и т.д.
  - `mutating` — `true/false` (строковый вывод).
  - `status` — один из:
    - `'executed'` — MCP-вызов прошёл успешно,
    - `'skipped'` — был пропущен политикой (например, `allow_agent_to_execute=false`),
    - `'failed'` — завершился ошибкой,
    - `n/a` — если статус не проставлен.
  - `note` — краткая текстовая заметка, если есть:
    - для `skipped` — например, `"allow_agent_to_execute=false"`,
    - для `failed` — текст ошибки из `callMcp`.

- Empty/fallback cases:
  - Если `d.execution` нет или `execution.mcpCalls` пуст:
    - выводится строка: `"Execution data: —"`.
  - Это покрывает беседы без MCP-вызовов или сценарии, где execution ещё не заполняется.

- Raw JSON:
  - Collapsible блок с полным payload (`JSON.stringify(d, null, 2)`) сохранён без изменений.

## 7. Compatibility notes

- Existing UI:
  - таблица событий внизу страницы не изменялась,
  - верхний diagnostics card продолжает отображать прежние блоки (Scenario, Policy, Specialists, Outcome, Reply/Handoff, Writer/QA).
- Новый execution блок:
  - использует `d.execution` только если он есть,
  - защищён проверкой `Array.isArray(d.execution.mcpCalls)`, чтобы избежать ошибок при отсутствии или другой структуре.
- Backend:
  - `server.js` для `/events/:conversationId` не менялся по логике; всё по-прежнему отдаёт `events` с `event_payload_json`.
- Таким образом:
  - существующий admin-ui поведение никак не ломается,
  - новые поля аккуратно встроены как дополнительная секция diagnostics.

## 8. Risks / open questions

- Риски:
  - Если формат `execution.mcpCalls` изменится в будущем, UI может перестать отображать статусы корректно, но:
    - блок построен максимально defensively (проверки наличия/массива),
    - raw JSON всегда доступен для fallback-анализа.
- Открытые вопросы:
  - Нужно ли в дальнейшем подсвечивать проблемные элементы (например, `failed` / `skipped`) визуально (цветом/иконками)?
  - Стоит ли в будущем добавлять фильтрацию/сводки по execution на отдельной странице или хватит per-conversation view?

## 9. Next recommended step

- В дальнейшем можно:
  - интегрировать execution subset в review/analytics инструменты (например, автогенерировать теги review на основе `failed`/`skipped` с определёнными причинами),
  - добавить всплывающие подсказки с более подробным описанием ошибок,
  - постепенно включать execution subset для reschedule/cancel сценариев, когда появится соответствующий pilot.

## 10. Diff summary

- **added**
  - `docs/reports/admin-ui-execution-observability-report.md`
- **modified**
  - `admin-ui/views/events.ejs` — в diagnostics card добавлена секция "Execution", которая:
    - читает `d.execution.mcpCalls`,
    - отображает `tool`, `mutating`, `status`, `note`,
    - показывает fallback `"Execution data: —"` при отсутствии данных.
- **untouched**
  - `admin-ui/server.js` (кроме чтения `events`), другие views admin-ui,
  - orchestrator/gateway/wa-service контракты,
  - persistence/генерация `decision_object_enriched` на стороне orchestrator.

## 11. Validation

- EJS-шаблон:
  - проходит линтер, синтаксически корректен,
  - при наличии execution subset-а:
    - отображает список MCP-вызовов в удобочитаемом формате,
  - при его отсутствии:
    - показывает понятное сообщение, не ломая страницу.
- Взаимодействие:
  - Страница `/events/:conversationId` по-прежнему загружается корректно:
    - diagnostics card (со Scenario/Policy/Specialists/Outcome/Reply/Handoff/Writer/QA/Execution),
    - таблица всех событий.

## Appendix: Example execution block in UI

Пример того, как execution subset теперь выглядит в diagnostics block:

> **Execution**  
> `crm.create_appointment` — mutating: true, status: `executed`  
> `admin.get_upcoming_appointments_by_phone` — mutating: false, status: `executed`  
> `crm.create_appointment` — mutating: true, status: `skipped`  
> _allow_agent_to_execute=false_  

В этом виде администратор сразу видит:
- какие инструменты вызваны,
- какие из них были mutating,
- прошло ли исполнение, было ли оно пропущено политикой, или упало с ошибкой (через `status` и `note`),
- и при необходимости может раскрыть raw JSON для глубокой диагностики.

