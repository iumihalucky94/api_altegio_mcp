# Stage Report: dispatcher-core-extraction

## 1. Goal

Выделить из перегруженного `agentProcessor.ts` **ядро диспетчера** (Scenario Router, Client Context Resolver, Policy Specialist facade, Decision Assembler skeleton), сохранив текущий бизнес‑flow и внешние контракты (ingest, MCP, wa-service, gateway, prompts).

## 2. Scope

- Входит:
  - Orchestrator: `agentProcessor.ts` и новые сервисы:
    - `services/scenarioRouter.ts`
    - `services/clientContext.ts`
    - `services/policySpecialist.ts`
    - `services/decisionAssembler.ts`
  - Shared types: `types/contracts.ts`, `types/reasonCodes.ts` (без радикальной смены формата).
- Не входит:
  - Booking/Reschedule/Cancellation specialists,
  - Writer/Prompts изменения,
  - Изменения gateway/wa-service/admin-ui контрактов,
  - Переписывание agentProcessor целиком.

## 3. Current extraction targets

Из `agentProcessor.ts` планировалось вынести:

1. **Scenario routing**:
   - вызовы `classifyIntent`, `detectLanguage`, `intentToScenarioCode`;
   - вычисление effective language (`resolveReplyLanguage`/`effectiveLangForReply`).
2. **Client context сборку**:
   - связи `ConversationRow` + `getLastMessages` + `BehaviorOverride` + KB‑summary + upcoming appointments.
3. **Policy load + safePolicy**:
   - логика `loadPolicyForScenario` и построения `safePolicy` + confidenceThreshold.
4. **Decision skeleton**:
   - хотя бы минимальный `DecisionObject`, построенный из (scenario, context, policy), пока не управляющий поведением.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts`
- `orchestrator/src/services/intent.ts`
- `orchestrator/src/services/localization.ts`
- `orchestrator/src/services/scenarioPolicy.ts`
- `orchestrator/src/services/conversation.ts`
- `orchestrator/src/services/behaviorOverrides.ts`
- `orchestrator/src/services/messageStore.ts`
- `orchestrator/src/services/kb.ts`
- `orchestrator/src/services/handoff.ts`
- `orchestrator/src/services/deterministicScheduling.ts`
- `orchestrator/src/services/aiAgent.ts`
- `orchestrator/src/types/contracts.ts`
- `orchestrator/src/types/reasonCodes.ts`

## 5. New modules created

### 5.1 `services/scenarioRouter.ts`

- **name**: `routeScenario`
- **purpose**:
  - централизовать определение intent, scenarioCode и языков (LanguageCode + ResolvedLanguage) на основе текста сообщения и hints.
- **key inputs**:
  - `ScenarioRouterInput`:
    - `text: string`
    - `languageHint: string | null`
    - `languagePreference: string | null`
- **key outputs**:
  - `ScenarioRouterOutput` (расширяет `ScenarioRouterResult`):
    - `intent: Intent`
    - `scenarioCode: ScenarioCode`
    - `confidence: number` (пока фиксировано 1.0 для skeleton)
    - `languageCode: LanguageCode` (из `detectLanguage`)
    - `effectiveLanguage: ResolvedLanguage` (из `resolveReplyLanguage`)
- **what existing logic it wraps/reuses**:
  - `classifyIntent` и `detectLanguage` из `intent.ts`,
  - `intentToScenarioCode` из `scenarioPolicy.ts`,
  - `resolveReplyLanguage` из `localization.ts`.

### 5.2 `services/clientContext.ts`

- **name**: `buildClientContext`
- **purpose**:
  - собрать `ClientContext` в одном месте из уже полученных в `agentProcessor` данных, без дополнительных DB/MCP вызовов.
- **key inputs** (`BuildClientContextParams`):
  - `phoneE164: string`
  - `conversation: ConversationRow`
  - `lastMessages: Array<{ ts; direction; author; text }>` (из `getLastMessages`)
  - `behaviorOverride: BehaviorOverride | null` (из `getBehaviorOverride`)
  - `detectedLanguage: ResolvedLanguage`
  - `languageHint: string | null`
  - `kbContextSummary?: string` (готовый KB‑блок)
  - `upcomingAppointments?: Array<{ id?; start?; service?; master? }>` (результат MCP, если есть)
- **key outputs**:
  - `ClientContext` (из `types/contracts.ts`):
    - `phoneE164`, `conversation: ConversationSnapshot`, `behaviorOverride`, `language`, `kbContextSummary`.
- **what existing logic it wraps/reuses**:
  - `ConversationRow` и `BehaviorOverride`,
  - `getLastMessages` (преобразуется в `ConversationSnapshot.lastMessages`),
  - списки предстоящих записей агрегируются в `UpcomingAppointmentSummary` (`count` и `nearestDate`).

### 5.3 `services/policySpecialist.ts`

- **name**: `evaluatePolicy`
- **purpose**:
  - оформить загрузку scenario policy и построение `safePolicy` + `DecisionPermissions` как отдельный фасад.
- **key inputs**:
  - `db: DbPool`
  - `scenarioCode: ScenarioCode`
- **key outputs**:
  - `{ safePolicy: ScenarioPolicy; result: PolicyResult }`, где:
    - `safePolicy` — текущая логика default‑policy (ASSIST_ONLY, execute=false, handoff=true, approval=true, threshold=0.97),
    - `PolicyResult` включает:
      - `scenarioCode`,
      - `policy` (null, если не найдено),
      - `permissions: DecisionPermissions` (canReply/canExecuteMutating/canCreateHandoff/requiresAdminApproval/confidenceThreshold).
- **what existing logic it wraps/reuses**:
  - `loadPolicyForScenario` из `scenarioPolicy.ts`,
  - старый код `safePolicy` и расчёта confidenceThreshold из `agentProcessor.ts` (перенесён без изменения логики).

### 5.4 `services/decisionAssembler.ts`

- **name**: `assembleDecisionSkeleton`
- **purpose**:
  - построить минимальный `DecisionObject`, который потом может быть расширен booking/reschedule/cancel specialists и QA guard, но **сейчас** служит лишь диагностическим skeleton (не влияет на поведение).
- **key inputs** (`DecisionAssemblerInput`):
  - `scenario: ScenarioRouterResult`
  - `context: ClientContext`
  - `policy: PolicyResult`
  - `fallbackLanguage: ResolvedLanguage`
- **key outputs**:
  - `DecisionObject`:
    - `scenario`, `context`, `policy`,
    - `schedule/bookingResult/rescheduleResult/cancellationResult` пока `undefined`,
    - `actionPlan` с `reply.text = null`, `execution.mcpCalls = []`, `handoff = null`,
    - `outcome` с `type: 'SKIP'`, `reasonCode: 'unknown'`, `confidence` = `scenario.confidence`.
- **what existing logic it wraps/reuses**:
  - только типы из `types/contracts.ts`; бизнес‑логика принятия решений пока не перенесена.

## 6. Changes in agentProcessor

В `processWithAiAgent` внесены **минимальные структурные изменения**:

1. **Scenario Router**
   - Вместо прямых вызовов:
     - `const intent = classifyIntent(batchText);`
     - `const lang = detectLanguage(batchText, languageHint);`
     - `const effectiveLang = effectiveLangForReply(lang, batchText, languageHint, languagePreference);`
   - Теперь вызывается:
     - `const routed = routeScenario({ text: batchText, languageHint, languagePreference });`
     - `const intent = routed.intent;`
     - `const lang = routed.languageCode;`
     - `const effectiveLang = routed.effectiveLanguage;`
   - Поведение по сути не меняется: используются те же функции, но через центральный router.

2. **Policy Specialist facade**
   - Вместо:
     - ручного `loadPolicyForScenario` + `safePolicy` + inline `confidenceThreshold` в `agentProcessor`.
   - Теперь:
     - `const { safePolicy, result: policyResult } = await evaluatePolicy(db, scenarioCode as any);`
     - `policy = policyResult.policy;`
     - при ошибках — fallback к прежнему default‑safePolicy и PolicyResult с теми же параметрами.
   - Событие `policy_applied` и запись `updateConversationLanguageAndScenario` остались на месте, логика не менялась.

3. **Client Context**
   - После получения:
     - `conv` (getConversation),
     - `overrides` (getBehaviorOverride),
     - `rows` (getLastMessages),
     - `appointments` (MCP),
     - `kbText` (KB),
   - Строится `ClientContext`:
     - `const clientContext = buildClientContext({ ... });`
   - Этот объект пока **используется только для построения DecisionObject skeleton** и диагностического `logger.debug`; на runtime‑логику не влияет.

4. **Decision Assembler skeleton**
   - После вызова `callAiAgent` и перед существующей обработкой результата:
     - Собирается `DecisionObject`:
       - `decisionSkeleton = assembleDecisionSkeleton({ scenario: routed, context: clientContext, policy: policyResult, fallbackLanguage: effectiveLang });`
     - Пишется debug‑лог (если включён):
       - `logger.debug?.({ conversationId, decisionSkeleton }, 'Decision skeleton built');`
   - Ни одно решение (RESPOND/HANDOFF/NEED_APPROVAL, mcp_calls, reply_text) пока **не берётся** из этого объекта.

Важно: **остальная логика `agentProcessor` (deterministicScheduling, FREE_SLOTS, вызов LLM, guards на confidence/policies, handoff) осталась неизменной**.

## 7. Shared contract adjustments

- Новые модули опираются на уже существующие типы в `types/contracts.ts` и `types/reasonCodes.ts`.  
  Дополнительных изменений в этих файлах на этом этапе не потребовалось.
- Все reason/status‑коды, используемые в skeleton (`'unknown'`, outcome `'SKIP'`), уже были описаны в `DecisionReasonCode` и `DecisionOutcomeType`.

## 8. Compatibility notes

- Внешние API:
  - `/ingest/whatsapp-web`,
  - `/mcp` (gateway),
  - контракты wa-service  
  **не изменялись**.
- Формат ответа LLM (`AiAgentOutput`) и system prompt — без изменений.
- MCP‑вызовы из `agentProcessor` (get_upcoming_appointments, list_services, list_staff, get_free_slots, create_appointment, cancel/reschedule) — прежние.
- Детеминированный слой расписания (`tryDeterministicSchedulingReply`) **вызывается так же, как до extraction**.
- Новые модули используются в режиме:
  - Scenario Router & Policy Specialist — **заменили только «как получить intent/policy»**, но через те же функции и таблицы, что и раньше;
  - Client Context + Decision Assembler — только собирают skeleton и логируют, не вмешиваясь в поведение.

## 9. Risks / open questions

- **Риск несоответствия между skeleton и реальным flow**  
  DecisionObject сейчас не управляет действием, а только отражает минимальный срез; при дальнейшем подключении нужно будет аккуратно синхронизировать его с реальной логикой, чтобы не было «двух разных правд».

- **Вопрос: где и как хранить DecisionObject**  
  Пока он существует только в памяти внутри `processWithAiAgent` и пишется в debug‑лог. Возможно, в будущем понадобится сохранять его в DB/события для аналитики.

- **Риск постепенной миграции**  
  Пока часть логики (например, FREE_SLOTS, MCP‑guard’ы) продолжает жить напрямую в `agentProcessor`, а skeleton не содержит этих деталей; при переносе в specialists потребуется аккуратная поэтапная миграция.

## 10. Next recommended step

- Начать **постепенное заполнение DecisionObject**:
  - добавить в него результат детерминированного расписания (`schedule`),
  - аккуратно подключить Booking/Reschedule/Cancellation specialists, опираясь на уже определённые типы.
- Параллельно:
  - вынести часть логики handoff в `Handoff Specialist`, используя `HandoffPreparationResult` и `HandoffReasonCode`.
  - начать использовать `DecisionPermissions` не только в `agentProcessor`, но и в будущих specialists.

## 11. Diff summary

- **added**
  - `orchestrator/src/services/scenarioRouter.ts` — Scenario Router.
  - `orchestrator/src/services/clientContext.ts` — Client Context Resolver (builder).
  - `orchestrator/src/services/policySpecialist.ts` — Policy Specialist facade.
  - `orchestrator/src/services/decisionAssembler.ts` — Decision Assembler skeleton.
  - `docs/reports/dispatcher-core-extraction-report.md` — данный отчёт.

- **modified**
  - `orchestrator/src/services/agentProcessor.ts`:
    - использует `routeScenario` для intent/language/scenario,
    - использует `evaluatePolicy` для загрузки policy и построения safePolicy/DecisionPermissions,
    - собирает `ClientContext` через `buildClientContext`,
    - строит `DecisionObject` skeleton через `assembleDecisionSkeleton` (только для debug).

- **untouched**
  - Вся бизнес‑логика по расписанию/слотам/booking/reschedule/cancel/handoff/QA:
    - deterministicScheduling,
    - FREE_SLOTS логика,
    - вызов LLM и разбор ответа,
    - policy guards на mutating tools и handoff,
    - writer/localization,
    - MCP contracts и wa-service.

## 12. Validation

- `ReadLints` для всех новых и изменённых файлов — без ошибок.
- `agentProcessor.ts` продолжает корректно компилироваться; signature функции `processWithAiAgent` не изменена.
- Никакие внешние контракты не поменялись, изменения — только внутри orchestrator и только на уровне модулей диспетчера.

---

## Appendix: Dispatcher flow after extraction

Новый укрупнённый flow обработки батча сообщений (только AI‑ветка, без детерминированного слоя до AI):

1. **processBatch**:
   - получает `conversationId`, `clientPhone`, `batchText`;
   - проверяет состояние беседы (`shouldBotRespond`) и overrides (`force_handoff`).

2. **Scenario Router (routeScenario)**:
   - по `batchText`, `languageHint`, `language_preference`:
     - определяет `intent`,
     - вычисляет `scenarioCode`,
     - определяет `languageCode` и `effectiveLanguage`,
     - возвращает `ScenarioRouterOutput`.

3. **Policy Specialist (evaluatePolicy)**:
   - по `scenarioCode` загружает `ScenarioPolicy` (если есть),
   - строит `safePolicy` (fallback),
   - формирует `DecisionPermissions` (canReply/canExecuteMutating/canCreateHandoff/confidenceThreshold).

4. **KB / MCP context**:
   - как и раньше, `agentProcessor`:
     - читает KB для intent/language (`getKbContext` + `buildKbContextBlock`),
     - запрашивает ближайшие записи (`admin.get_upcoming_appointments_by_phone`),
     - загружает `list_services` и `list_staff` через MCP.

5. **Deterministic Scheduling**:
   - для BOOKING/UNKNOWN остаётся прежний вызов `tryDeterministicSchedulingReply`;
   - при `applied: true` отправляется системный ответ и flow завершается.

6. **FREE_SLOTS + LLM‑context**:
   - на основе staff/services и `get_free_slots` формируется список слотов;
   - строится `conversationHistory` и `AiAgentContext`.

7. **Client Context Resolver (buildClientContext)**:
   - из:
     - `ConversationRow` (`conv`),
     - `lastMessages` (`getLastMessages`),
     - `BehaviorOverride`,
     - effective language и languageHint,
     - KB‑блока,
     - списка предстоящих записей;
   - строится `ClientContext`.

8. **LLM‑вызов (callAiAgent)**:
   - полностью как раньше: system prompt + KB + CONTEXT, `AiAgentOutput`.

9. **Decision Assembler skeleton (assembleDecisionSkeleton)**:
   - на основе:
     - `ScenarioRouterResult` (из шага 2),
     - `ClientContext` (из шага 7),
     - `PolicyResult` (из шага 3),
     - fallback‑языка;
   - создаётся минимальный `DecisionObject` с outcome `SKIP` и пустым `ActionPlan`.
   - объект логируется в debug (при включённом уровне), но **не управляет дальнейшим поведением**.

10. **Policy/Confidence guards + Hand‑off**:
    - дальше `agentProcessor` работает как прежде:
      - применяет confidence‑guard,
      - применяет policy‑guard на mutating calls,
      - создаёт handoff при необходимости,
      - отправляет replies через `sendAndLog`.

Таким образом, на этом этапе ядро диспетчера (router + context + policy + skeleton) уже вынесено в отдельные модули и интегрировано **без изменения бизнес‑логики**, подготавливая почву для дальнейшего выделения specialists и полного использования `DecisionObject` в будущем. 
