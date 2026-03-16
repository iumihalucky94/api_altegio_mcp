# Stage Report: final-runtime-cutover-enforcement

## 1. Goal

Жёстко закрепить новую модульную архитектуру orchestrator как primary runtime flow на уровне кода, а не только в отчётах и diagnostics:
- чтобы основная логика обработки сообщений шла через dispatcher core → specialists → DecisionObject → writer → QA → execution/handoff → diagnostics,
- а legacy-путь оставался только как чётко выделенный fallback.

## 2. Scope

В этом этапе:
- перестроена верхнеуровневая структура `agentProcessor.processBatch` так, чтобы:
  - AI-путь явно шёл через `processWithAiAgent` (модульный pipeline),
  - non-AI путь был вынесен в отдельную функцию `processWithoutAi` и помечен как legacy fallback,
- подтверждено, что DecisionObject и связанные модули уже используются в primary AI runtime flow.

Не делалось:
- переработка внешних контрактов ingest/MCP/gateway/wa,
- изменение модулей dispatcher core / specialists / writer / QA / diagnostics (они уже были внедрены ранее),
- крупный rewrite логики booking/reschedule/cancel/handoff — только структурное усиление разграничения primary vs fallback.

## 3. Why previous cutover was insufficient

Предыдущий этап full-architecture-cutover:
- корректно описал, что:
  - dispatcher core и specialists используются,
  - DecisionObject обогащается,
  - diagnostics и admin-ui работают,
- но по коду:
  - `processBatch` содержал вперемешку:
    - AI-путь через `processWithAiAgent`,
    - non-AI legacy логику (upcoming/generic replies, MCP-fallback + handoff),
  - legacy-путь не был явно выделен как fallback и выглядел как "вторая основная ветка".

Нужно было явно:
- отделить AI primary path от non-AI fallback path,
- пометить и изолировать legacy логику, чтобы она не воспринималась как равноправная архитектура.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- отчёты по:
  - dispatcher-core-extraction,
  - DecisionObject enrichment/persistence,
  - admin-ui observability.

## 5. Primary runtime flow changes

Ключевое изменение:
- `processBatch` теперь:
  - **раньше**:
    - после проверки conversation/state/overrides и определения `apiKey`:
      - если есть API key → `processWithAiAgent` (AI путь),
      - если нет API key → inline non-AI logic (handoff triggers, `admin.get_upcoming_appointments_by_phone`, generic replies).
  - **теперь**:
    - AI-путь остался тем же:
      - при наличии API key → `processWithAiAgent(...)`.
    - non-AI путь:
      - вынесен в отдельную функцию `processWithoutAi(...)` и вызывается:
        ```ts
        await processWithoutAi(
          db,
          batch,
          logger,
          sendToSummary,
          companyId,
          requestId,
          conv,
          clientPhone,
          batchText,
          defaultEffectiveLang
        );
        ```
    - это делает modular AI pipeline однозначно primary runtime path, а non-AI ветку — явным fallback helper-ом.

## 6. agentProcessor restructuring

Конкретные изменения в `agentProcessor.ts`:

- В `processBatch`:
  - Код non-AI обработки (handoff triggers + upcoming/generic reply + MCP error → handoff) удалён из тела `processBatch` и перенесён в новую функцию.
  - Теперь `processBatch`:
    1. Проверяет пустой batch.
    2. Загружает `Conversation`, проверяет `shouldBotRespond`.
    3. Проверяет overrides (`force_handoff`).
    4. Собирает `batchText`, `defaultEffectiveLang`.
    5. Если есть API key → вызывает `processWithAiAgent` (primary modular flow).
    6. Иначе → вызывает `processWithoutAi` (legacy fallback).

- Добавлена новая функция `processWithoutAi`:
  - принимает:
    - `db`, `batch`, `logger`, `sendToSummary`, `companyId`, `requestId`, `conv`, `clientPhone`, `batchText`, `defaultEffectiveLang`,
  - выполняет:
    - поиск handoff-триггеров (`HANDOFF_TRIGGERS`),
    - при их наличии — `createHandoffAndPause`,
    - иначе — пробует `admin.get_upcoming_appointments_by_phone`:
      - при ALLOW+appointments → `upcoming_appointments` system message,
      - иначе → `generic_reply`,
    - при ошибке MCP → пишет лог и делает `createHandoffAndPause`.
  - снабжена ясным комментариям:
    - `/** Legacy non-AI fallback path used only when no AI API key is configured. ... */`

- Итого:
  - modular AI pipeline (`processWithAiAgent`) теперь чётко отделён как primary,
  - legacy non-AI logic — чётко вынесена и помечена как fallback helper.

## 7. DecisionObject runtime role

В этом этапе DecisionObject:
- не переписывался, но:
  - его роль как primary internal state для AI-пути закреплена тем, что:
    - AI-путь теперь очевидно проходит через `processWithAiAgent`, где:
      - строится `DecisionObject` skeleton,
      - обогащается specialists/writer/QA/handoff/execution/outcome,
      - передаётся в diagnostics (`persistDecisionSnapshot`),
  - non-AI fallback путь не использует DecisionObject (как и задумано — это упрощённый режим без AI).

## 8. Legacy fallback paths still remaining

После реструктуризации:

- Legacy non-AI path:
  - полностью вынесен в `processWithoutAi`,
  - используется только если нет AI API key,
  - помечен как fallback в комментарии.
- Booking guards и safety fallbacks:
  - `booking_failed`, `fake_confirmation_blocked` и т.п. — остаются внутри AI-пути как safety-ветки.
- Policy-based reply/hand-off fallbacks:
  - когда policy запрещает execute/handoff, используются `generic_ack` и совместимый behaviour.

Все эти пути:
- теперь явно отделены от primary modular AI-пайплайна.

## 9. Runtime behavior impact

- **Booking / Reschedule / Cancellation / Handoff / Respond path**:
  - для случаев с настроенным AI API key:
    - поведение не изменилось:
      - по-прежнему работает через modular pipeline в `processWithAiAgent`.
  - для non-AI (без API key):
    - поведение не изменилось по сути:
      - такая же логика handoff-триггеров и upcoming/generic replies,
      - но теперь в отдельной функции fallback.

## 10. Compatibility notes

- Внешние контракты:
  - ingest, MCP/gateway, wa-service, admin-ui — не менялись.
- Поведение:
  - non-AI путь отделён, но функционально идентичен предыдущему.
  - AI путь продолжает использовать dispatcher core + specialists + DecisionObject как до этапа.

## 11. Risks / open questions

- Риски:
  - минимальные, так как перестановка кода не меняет сам алгоритм, только его структурную организацию.
- Вопросы:
  - когда полностью отказаться от non-AI fallback (например, если AI API ключ будет обязателен),
  - какие дополнительные legacy участки можно безопасно вынести/сжать далее.

## 12. Next recommended cleanup step

- Следующим шагом можно:
  - ещё сильнее сузить non-AI fallback (например, только generic_ack + handoff),
  - удалить/упростить лишние debug-ветки в `agentProcessor`,
  - рассмотреть вынос RESPOND/HANDOFF/NEED_APPROVAL веток в отдельные handler-модули.

## 13. Diff summary

- **added**
  - `docs/reports/final-runtime-cutover-enforcement-report.md`
- **modified**
  - `orchestrator/src/services/agentProcessor.ts`
    - non-AI логика вынесена в `processWithoutAi` и явно помечена как legacy fallback.
- **removed**
  - нет полностью удалённых файлов; legacy код переорганизован, а не удалён.
- **left intentionally**
  - все AI-пути и specialist/DecisionObject/diagnostics/exec логику — без изменений, так как это и есть новый primary flow.

## 14. Validation

- TypeScript-линты:
  - проходят без ошибок для `agentProcessor.ts`.
- Поведение:
  - non-AI сценарии протестированы логически (идентичны предыдущему коду, только вынесены в helper).
  - AI runtime:
    - не затронут реструктуризацией (остаётся после ветки с API key).

## Appendix A: Primary runtime flow after enforcement

С учётом данного этапа, основной AI runtime flow:

1. `processBatch` проверяет batch и загружает `Conversation`.
2. Проверяет `shouldBotRespond`; при `false` просто выходит.
3. Проверяет `force_handoff` overrides; при `true` → `createHandoffAndPause` (fallback).
4. Собирает `batchText`, `defaultEffectiveLang`.
5. Проверяет наличие AI API key:
   - если key есть → идёт в `processWithAiAgent` (primary modular pipeline),
   - если key нет → уходит в `processWithoutAi` (legacy fallback).
6. В `processWithAiAgent`:
   - через `routeScenario` получает `intent`, `scenarioCode`, язык/`effectiveLang`.
   - через `evaluatePolicy` получает `PolicyResult`/permissions.
   - строит `ClientContext` и DecisionObject skeleton через `assembleDecisionSkeleton`.
   - выполняет deterministic scheduling; при успешном deterministic reply может ответить без AI.
   - вызывает AI (`callAiAgent`).
7. После AI:
   - specialists (booking/reschedule/cancellation) нормализуют domain status.
   - Handoff Specialist обрабатывает low-confidence/HANDOFF/NEED_APPROVAL.
8. В RESPOND-ветке:
   - MCP-вызовы выполняются, ExecutionPlan заполняется для booking (и других MCP-вызовов).
   - Writer выбирает базовый текст.
   - Reply QA Guard проверяет текст и при необходимости сваливается на fallback.
9. DecisionObject обогащается (reply/handoff/execution/outcome/writer/QA) и сохраняется через `persistDecisionSnapshot`.
10. Ответ отправляется клиенту через WhatsApp и логируется.

## Appendix B: Legacy fragments that still remain

- Non-AI `processWithoutAi`:
  - работает только при отсутствии AI API key.
  - содержит:
    - handoff triggers,
    - MCP-вызов для upcoming appointments,
    - generic reply,
    - handoff при ошибке.
- Booking safety guard ветки:
  - `booking_failed` и `fake_confirmation_blocked` остаются важными safety-ветками.
- Полная миграция execution для reschedule/cancel сценариев ещё не сделана:
  - ExecutionPlan отражает только booking pilot и другие MCP-вызовы в RESPOND-ветке.

