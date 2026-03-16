# Stage Report: action-plan-execution-booking-pilot

## 1. Goal

Запустить пилотное использование `ActionPlan.execution` только для booking-сценариев, чтобы:
- отражать фактические MCP-вызовы (особенно `crm.create_appointment`) в `DecisionObject`,
- различать mutating/non-mutating execution и статусы (`executed`, `skipped`, `failed`),
- не ломать текущий runtime execution flow и не менять gateway/injest контракты.

## 2. Scope

В этом этапе:
- слегка расширен shared contract для `ExecutionPlan`,
- RESPOND-ветка в `agentProcessor` начала заполнять `actionPlan.execution.mcpCalls` в booking-related execution,
- diagnostics snapshot (`decision_object_enriched`) дополнен компактным view execution subset.

Не делалось:
- миграция reschedule/cancel execution на ActionPlan,
- изменение логики вызова MCP-инструментов,
- новый execution engine или отказ от существующего цикла.

## 3. Current execution flow findings

До этапа:
- **MCP execution**:
  - В RESPOND-ветке `agentProcessor`:
    - проходил по `result.mcp_calls` (ответ модели),
    - для каждого `tool/payload`:
      - проверял policy (`allow_agent_to_execute`) с помощью `isMutatingTool`,
      - логировал события `tool_called`, `tool_succeeded`, `tool_failed`,
      - выполнял `callMcp(tool, payload, companyId, requestId)`.
  - Специфические booking-проверки:
    - `createAppointmentFailed` / `createAppointmentSucceeded` для `crm.create_appointment`,
    - `fake_confirmation_blocked` guard, если reply выглядел как подтверждение, но create_appointment не отработал.
- **ActionPlan.execution**:
  - Структура `ExecutionPlan` существовала, но:
    - всегда заполнялась пустым массивом `mcpCalls: []` в assembler-е,
    - не обновлялась в runtime (оставалась практически пустой).
- **Booking-relevant execution points**:
  - Контекст booking:
    - MCP tool `crm.create_appointment`,
    - policy guard `allow_agent_to_execute`,
    - deterministic-layer и `FREE_SLOTS` проверяли доступность слотов, но не отражались в `ExecutionPlan`.
  - Основная логика исполнения брони оставалась в `agentProcessor` без отражения в `DecisionObject.actionPlan.execution`.

## 4. Files reviewed

- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/decisionDiagnostics.ts`
- отчёты об enrichment DecisionObject и diagnostics persistence.

## 5. Shared contract changes

В `orchestrator/src/types/contracts.ts`:

- **ExecutionPlan**:
  - ранее:
    ```ts
    export interface ExecutionPlan {
      mcpCalls: Array<{
        tool: string;
        payload: Record<string, unknown>;
        mutating: boolean;
      }>;
    }
    ```
  - теперь:
    ```ts
    export interface ExecutionPlan {
      mcpCalls: Array<{
        tool: string;
        payload: Record<string, unknown>;
        mutating: boolean;
        status?: 'planned' | 'executed' | 'skipped' | 'failed';
        note?: string;
      }>;
    }
    ```
- Причина:
  - нужно минимально выразить:
    - статус выполнения (`executed`/`skipped`/`failed`),
    - краткую заметку (`note`) для причин, вроде policy skip или error message,
  - без изменения существующих полей или добавления новых сущностей.

## 6. Execution planning approach

Выбран **executed mirror** с небольшой примесью "skipped/failed":
- В RESPOND-ветке:
  - при проходе по `result.mcp_calls`:
    - для каждого элемента формируется "execution item":
      - `tool`, `payload`, `mutating`,
      - `status`:
        - `skipped` — если mutating tool заблокирован policy (`allow_agent_to_execute=false`),
        - `executed` — успешный `callMcp`,
        - `failed` — исключение в `callMcp`,
      - `note`:
        - `"allow_agent_to_execute=false"` для skipped,
        - текст ошибки для failed.
  - После завершения цикла, если `decisionSkeleton` есть:
    - `decisionSkeleton.actionPlan.execution = { mcpCalls: executionItems }`.
- Почему не "pure planned mirror":
  - в текущем коде проще и полезнее отражать именно фактический результат выполнения MCP-вызовов,
  - планирование "до факта" можно добавить позже, при переходе на полный ActionPlan-driven execution.

## 7. Changes in agentProcessor

Файл `orchestrator/src/services/agentProcessor.ts`:

- Внутри RESPOND-ветки:
  - введён массив `executionItems`:
    ```ts
    const executionItems: {
      tool: string;
      payload: Record<string, unknown>;
      mutating: boolean;
      status?: 'planned' | 'executed' | 'skipped' | 'failed';
      note?: string;
    }[] = [];
    ```
  - В цикле по `result.mcp_calls`:
    - вычисляется `mutating = isMutatingTool(tool)` и `execItemBase`:
      ```ts
      const execItemBase = {
        tool,
        payload: payload as Record<string, unknown>,
        mutating
      };
      ```
    - Если mutating tool заблокирован policy:
      - создаётся `executionItems.push({ ...execItemBase, status: 'skipped', note: 'allow_agent_to_execute=false' });`
    - При успешном `callMcp`:
      - создаётся `executionItems.push({ ...execItemBase, status: 'executed' });`
    - При ошибке `callMcp`:
      - создаётся `executionItems.push({ ...execItemBase, status: 'failed', note: errorMessage });`
  - После цикла и до отправки ответа:
    - если `decisionSkeleton` существует и `executionItems.length > 0`:
      ```ts
      decisionSkeleton.actionPlan.execution = {
        mcpCalls: executionItems
      };
      ```
- Сознательно оставлено по-старому:
  - фактический вызов MCP (`callMcp`) и event-логика (`tool_called`, `tool_succeeded`, `tool_failed`),
  - booking guards (`createAppointmentFailed`, `createAppointmentSucceeded`, `fake_confirmation_blocked`),
  - Writer/QA Guard и RESPOND/HANDOFF/NEED_APPROVAL ветки.

## 8. Diagnostics integration

Файл `orchestrator/src/services/decisionDiagnostics.ts`:

- В payload для `decision_object_enriched` добавлен компактный execution subset:
  ```ts
  execution: {
    mcpCalls: (decision.actionPlan.execution.mcpCalls || []).map((c) => ({
      tool: c.tool,
      mutating: c.mutating,
      status: c.status,
      note: c.note
    }))
  }
  ```
- Не включаются:
  - полный payload каждого вызова (кроме поля `payload` в DecisionObject, но в snapshot-е мы его не повторяем),
  - внутренние детали ошибок (только краткий `note`),
  - любые дополнительные поля, чтобы snapshot оставался компактным.
- Это позволяет:
  - в `decision_object_enriched` видеть:
    - какие booking / другие MCP-инструменты были вызваны,
    - были ли они mutating,
    - их статус и короткое описание причин skip/fail.

## 9. Compatibility notes

- Booking runtime flow:
  - по-прежнему:
    - читает `result.mcp_calls`,
    - вызывает `callMcp`,
    - применяет booking guards,
    - принимает решение RESPOND/HANDOFF/NEED_APPROVAL.
  - Дополнительное:
    - параллельно формируется `executionItems`, не влияя на поведение.
- Внешние контракты:
  - `result.mcp_calls` формат от модели,
  - MCP-инструменты gateway — не менялись.
- DecisionObject:
  - новые поля `status`/`note` в `ExecutionPlan` опциональны,
  - старый код, который читает `ExecutionPlan`, не ломается (если такой появится), но сейчас его нет.

## 10. Risks / open questions

- Риски:
  - Если ExecutionPlan в будущем будет использоваться как source of truth для исполнения, нужно будет убедиться, что:
    - он всегда синхронизирован с фактическими вызовами (в т.ч. при ошибках и early returns),
    - не возникает рассинхронизации между events и ExecutionPlan.
- Открытые вопросы:
  - Следует ли логировать и non-mutating calls в ExecutionPlan (сейчас логируются все, но статус особенно полезен для mutating),
  - Нужно ли в будущем добавлять idempotency/trace-id в execution items.

## 11. Next recommended step

- Потенциальные следующие шаги:
  - начать использовать ExecutionPlan для построения UI/analytics (например, в admin-ui decision view, показывать `execution.mcpCalls`),
  - расширить ExecutionPlan для reschedule/cancel после пилота с booking,
  - постепенно подводить код к тому, чтобы new execution engine мог опираться на ActionPlan, а не raw `result.mcp_calls`.

## 12. Diff summary

- **added**
  - `docs/reports/action-plan-execution-booking-pilot-report.md`
- **modified**
  - `orchestrator/src/types/contracts.ts` — расширен `ExecutionPlan` полями `status?` и `note?`.
  - `orchestrator/src/services/agentProcessor.ts` — RESPOND-ветка теперь формирует `executionItems` для `result.mcp_calls` и записывает их в `decisionSkeleton.actionPlan.execution.mcpCalls`.
  - `orchestrator/src/services/decisionDiagnostics.ts` — snapshot `decision_object_enriched` теперь включает компактный `execution.mcpCalls` (tool, mutating, status, note).
- **untouched**
  - MCP execution semantics (`callMcp`, booking guards),
  - reschedule/cancel execution,
  - admin-ui (использует уже существующий enriched snapshot, но еще не отображает execution subset).

## 13. Validation

- Типы:
  - новые optional-поля в `ExecutionPlan` не ломают существующий контракт,
  - изменения в `agentProcessor` и `decisionDiagnostics` проходят type-check.
- Поведение:
  - проверено, что:
    - при успешном execution booking tools — executionItems получают `status: 'executed'`,
    - при policy skip — `status: 'skipped'` с `note: 'allow_agent_to_execute=false'`,
    - при ошибке `callMcp` — `status: 'failed'` с текстом ошибки в `note`,
    - отсутствие MCP-вызовов оставляет execution.mcpCalls пустым.
  - booking runtime flow (создание/проверка записей, handoff, ответы клиенту) остаётся прежним; ExecutionPlan сейчас выполняет только роль структурированного зеркала.

## Appendix: Example booking execution plan

Пример booking-related `actionPlan.execution` внутри DecisionObject:

```ts
actionPlan: {
  reply: {
    text: 'Привет! Да, у нас есть свободное окно на завтра в 15:00. Подойдёт ли вам это время?',
    language: 'ru'
  },
  execution: {
    mcpCalls: [
      {
        tool: 'crm.create_appointment',
        payload: {
          company_id: 123,
          staff_id: 456,
          service_id: 789,
          cost: 0,
          datetime: '2026-03-20T15:00:00+01:00',
          client_phone: '+4369912345678',
          client_name: 'Ирина',
          seance_length: 3600
        },
        mutating: true,
        status: 'executed'
      }
    ]
  },
  handoff: null
}
```

А в `decision_object_enriched` snapshot-е это отразится компактно как:

```json
"execution": {
  "mcpCalls": [
    {
      "tool": "crm.create_appointment",
      "mutating": true,
      "status": "executed",
      "note": null
    }
  ]
}
```
