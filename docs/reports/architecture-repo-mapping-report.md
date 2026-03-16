# Stage Report: architecture-repo-mapping

## 1. Goal

Зафиксировать, **как целевая архитектура AI‑администратора** (Scenario Router, Specialists, Guards и т.д.) соотносится с **реальным кодом репозитория** (orchestrator, gateway, wa-service, admin-ui, DB).  
Цель этапа — получить карту «что уже есть / что частично / чего нет» и **безопасный порядок дальнейшей эволюции**, а не выполнять большой рефакторинг.

## 2. Scope

- Входит:
  - `orchestrator/` (ingest, debounce, `processBatch`, `agentProcessor`, prompts, KB, policies, handoff, review).
  - `gateway/` (MCP слой, Altegio client, tools, approvals, deterministic booking rules).
  - `admin-ui/` (просмотр бесед, handoff, policies, reviews).
  - `db/migrations/*.sql` и документ `docs/DATABASE_STRUCTURE_AND_FLOWS.md`.
  - Главный системный промпт: `aiAgentSystemPrompt.ts`.
- Не входит:
  - Существенная смена контрактов между сервисами (`wa-service` ↔ orchestrator, orchestrator ↔ gateway).
  - Переписывание слоёв целиком; только анализ и рекомендации.

## 3. Current repo findings

- Архитектура уже **многоуровневая**, но не полностью совпадает с целевой иерархией модулей:
  - В orchestrator **много логики сосредоточено в `agentProcessor.ts`** (intent, policy, вызов AI, обработка MCP, handoff, события, локализация).
  - Gateway уже выполняет роль **детерминированного CRM/MCP слоя** (Altegio slots, validateSlot, approvals, idempotency, audit).
  - `wa-service` — чистый транспорт слой для WhatsApp, хорошо изолирован.
  - `admin-ui` даёт минимальный **governance уровень**: просмотр бесед, handoff, policies, reviews, тестовые кейсы.
- Структурно уже реализованы:
  - **Scenario policies & guards** (`scenarios`, `scenario_policies`, `scenarioPolicy.ts`, guards в `agentProcessor`).
  - **Conversation events** (`conversation_events` + `conversationEvents.ts`).
  - **Review loop foundation** (`conversation_reviews`, `conversation_review_tags`, `conversationReview.ts`, admin‑routes).
  - **Детерминированный слой расписания** (`deterministicScheduling.ts` + gateway‑tool `crm.get_availability_for_date`).
  - **Language lock & localization** (`localization.ts` + изменения в `agentProcessor.ts` и system prompt).
- Основные «точки давления»:
  - `agentProcessor.ts` выполняет **слишком много ролей сразу** (scenario routing, context, policy, booking, handoff, writer, QA).
  - Gateway MCP слой логически чистый, но **вся доменная логика orchestration/decision‑making сосредоточена в одном месте** (orchestrator), а не разбита на модули «specialists».

## 4. Files reviewed

- **Orchestrator**
  - `src/server.ts`
  - `src/routes/ingest.ts`
  - `src/routes/admin.ts`
  - `src/routes/kb.ts`
  - `src/services/agentProcessor.ts`
  - `src/services/intent.ts`
  - `src/services/conversation.ts`
  - `src/services/messageStore.ts`
  - `src/services/handoff.ts`
  - `src/services/whatsappSend.ts`
  - `src/services/scenarioPolicy.ts`
  - `src/services/conversationEvents.ts`
  - `src/services/conversationReview.ts`
  - `src/services/behaviorOverrides.ts`
  - `src/services/ignoreList.ts`
  - `src/services/localization.ts`
  - `src/services/deterministicScheduling.ts`
  - `src/services/bookingContext.ts`
  - `src/services/kb.ts`
  - `src/services/aiAgent.ts`
  - `src/services/mcpClient.ts`
  - `src/services/debounce.ts`
  - `src/lib/e164.ts`, `src/lib/businessHours.ts`
  - `src/telegram/bot.ts`
  - `src/prompts/aiAgentSystemPrompt.ts`

- **Gateway**
  - `src/server.ts`
  - `src/mcp/router.ts` + tools под `src/mcp/tools/**`
  - `src/altegio/client.ts`
  - `src/altegio/slots.ts`
  - `src/config/resolver.ts`
  - `src/policy/rules.ts`, `src/policy/engine.ts`
  - `src/audit/db.ts`, `src/audit/writeHttpCall.ts`, `src/audit/writeMcpRequest.ts`
  - `src/routes/health.ts`, `src/routes/mcp.ts`, `src/routes/approvals.ts`, `src/routes/adminPolicies.ts`

- **Admin UI**
  - `admin-ui/server.js`
  - `admin-ui/views/*.ejs`
  - `admin-ui/data.json`

- **DB & docs**
  - `db/migrations/*.sql` (001–012)
  - `docs/DATABASE_STRUCTURE_AND_FLOWS.md`
  - `docs/booking_logic.md`
  - `docs/IMPLEMENTATION_PLAN_STAGED.md`
  - `docs/TZ_DETERMINISTIC_SCHEDULING_RULES.md`

## 5. Target modules mapping

Ниже — сопоставление целевых модулей («архитектурная карта») с текущим repo.

### 5.1 Scenario Router

- **Purpose**
  - Определить сценарий беседы (booking, reschedule, cancel, faq, complaint, late_arrival, unknown) на основе intent и контекста, выбрать соответствующую `scenario_policy` и направить логику дальше.

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - `orchestrator/src/services/intent.ts` — `classifyIntent(text): Intent`.
  - `orchestrator/src/services/scenarioPolicy.ts` — `intentToScenarioCode(intent) → scenarioCode`, `loadPolicyForScenario(db, scenarioCode)`.
  - `agentProcessor.ts`:
    - вызывает `classifyIntent` и `detectLanguage`;
    - выбирает `scenarioCode` через `intentToScenarioCode`;
    - загружает `ScenarioPolicy` и применяет её к решениям (reply/execute/handoff).
  - DB: `scenarios`, `scenario_policies` (миграция `009_scenarios_and_policies.sql`).

- **What to keep**
  - Текущую реализацию `classifyIntent`.
  - `intentToScenarioCode` и `loadPolicyForScenario`.
  - Модель `ScenarioPolicy` и таблицы `scenarios`, `scenario_policies`.

- **What to extract**
  - Логику «router» можно вынести из `agentProcessor` в более явный модуль, например:
    - `ScenarioRouter.route({ intent, conversation, context }) → { scenarioCode, policy }`.
  - Там же можно централизовать запись событий `intent_detected`, `scenario_selected`, `policy_applied`.

- **What to build new**
  - Лёгкий интерфейс/тип `ScenarioContext` (phone, current state, last events, KB hints), чтобы router не зависел от деталей `agentProcessor`.
  - Возможность учитывать **канал** (сейчас сценарий не зависит от канала, но канал уже закодирован в `conversation_id`).

- **Priority**
  - **High** — это узел, от которого зависит поведение остальных specialists и policy guards.

- **Dependencies**
  - Таблицы `scenarios`, `scenario_policies`.
  - `classifyIntent`, `detectLanguage`.
  - `conversation_events` для аудита (не обязательно, но желательно).

---

### 5.2 Client Context Resolver

- **Purpose**
  - Собрать «портрет клиента» и контекст диалога: телефоны, прошлые записи, поведение (ignore / force_handoff / language_preference), KB‑политики, текущие pending действия.

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - `ingest.ts` + `conversation.ts` + `messageStore.ts`:
    - создают/обновляют `conversations`, `conversation_messages`.
  - `agentProcessor.ts`:
    - читает `conversations` (getConversation),
    - читает `client_behavior_overrides` (getBehaviorOverride),
    - читает последние сообщения (getLastMessages),
    - читает KB (`getKbContext`, `buildKbContextBlock`),
    - читает `pending_admin_actions` / `handoff_cases` косвенно через `handoff.ts` и Telegram‑бот.
  - `behaviorOverrides.ts`, `ignoreList.ts`.

- **What to keep**
  - Текущее разделение: ingest → запись в DB, `processBatch` → чтение всего нужного.
  - Структуры таблиц `conversations`, `conversation_messages`, `client_behavior_overrides`, `agent_ignore_phones`.

- **What to extract**
  - Отдельный модуль вида `clientContext.ts`:
    - `resolveClientContext(conversationId, phone) → { conversation, behaviorOverrides, lastMessages, kbContext, pendingAdminActionsSummary }`.
  - Тогда `agentProcessor` не будет сам собирать всё по кускам.

- **What to build new**
  - Лёгкий тип `ClientContext` и его сериализация в events (например, хранить snapshot в `conversation_events` при значимых изменениях).

- **Priority**
  - **Medium** — полезно для упрощения `agentProcessor`, но не блокирует текущую работу.

- **Dependencies**
  - Уже существующие сервисы: `conversation.ts`, `behaviorOverrides.ts`, `messageStore.ts`, `kb.ts`.

---

### 5.3 Schedule Interpreter

- **Purpose**
  - Детерминированно интерпретировать запросы по датам/времени: relative/absolute date, рабочий день/время, наличие свободных слотов, предложение альтернативных дней/слотов.

- **Exists status**
  - **exists_partially (очень близко к целевому виду)**.

- **Current repo touchpoints**
  - Orchestrator:
    - `bookingContext.ts` — `resolveRelativeDate`, `extractDateFromMessage`, `getDatesToFetch`, `matchStaffFromMessage`.
    - `deterministicScheduling.ts` — слой, который:
      - получает дату из текста,
      - вызывает `crm.get_availability_for_date`,
      - различает:
        - день закрыт,
        - день открыт, есть слоты,
        - день открыт, но слотов нет;
      - формирует локализованный ответ, **не зависящий от confidence** и не создающий handoff.
    - `localization.ts` — ключи `requested_date_not_open`, `working_time_violation*`, `slots_available`, `day_alternatives`.
  - Gateway:
    - `altegio/slots.ts` — парсинг расписания и расчёт слотов.
    - `mcp/tools/crm/getAvailabilityForDate.ts` — один инструмент для orchestrator.
    - Классические MCP‑tools (`get_master_working_hours`, `get_free_slots`, `validate_slot`, `createAppointment`) — используются как building blocks.
  - Док: `docs/booking_logic.md`, `docs/TZ_DETERMINISTIC_SCHEDULING_RULES.md`.

- **What to keep**
  - `crm.get_availability_for_date` как основной «опрос дня».
  - Разделение ролей:
    - gateway → общается с Altegio и считает слоты;
    - orchestrator → решает, что говорить клиенту.
  - Жёсткие правила FREE_SLOTS в system prompt + gateway‑валидация.

- **What to extract**
  - Внутри orchestrator:
    - чётко позиционировать `deterministicScheduling.ts` как модуль **Schedule Interpreter**, а не «случайный helper»;
    - добавить thin‑интерфейс (например, `interpretScheduleIntent(context)`) вместо прямого вызова из `agentProcessor`.

- **What to build new**
  - Расширение API schedule interpreter:
    - режим «only explain / only suggest days»;
    - более тонкая работа с «клиент хочет именно X, но X недоступно».

- **Priority**
  - **High** — это основной safety‑layer по датам/слотам, уже даёт ценность и должен быть стабилизирован.

- **Dependencies**
  - Gateway MCP tools для Altegio.
  - `localization.ts`.

---

### 5.4 Booking Specialist

- **Purpose**
  - Принимать структурированные решения по **новым бронированиям**: выбор услуги, мастера, слота; координация между Schedule Interpreter, policy, LLM и `crm.create_appointment`.

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - Gateway: `crm.get_free_slots`, `crm.validate_slot`, `crm.create_appointment`, вся логика в `altegio/slots.ts`.
  - Orchestrator:
    - `bookingContext.ts` (выбор дат и мастера для FREE_SLOTS).
    - `agentProcessor.ts`:
      - собирает FREE_SLOTS и передаёт в AI,
      - обрабатывает `mcp_calls` от AI, в т.ч. `crm.create_appointment`,
      - проверяет «AI сказал confirmed, но create_appointment не прошло» и эскалирует.
    - `aiAgentSystemPrompt.ts` — секции BOOKING SLOTS и CREATE APPOINTMENT.

- **What to keep**
  - Валидацию и фактическое создание записи полностью в gateway + Altegio (`createAppointment` + `validateSlot`).
  - Правило: **LLM никогда не подтверждает слоты, которых нет в FREE_SLOTS**.

- **What to extract**
  - Из `agentProcessor` можно выделить модуль `bookingSpecialist.ts`, который:
    - принимает `AI result` и `policy`,
    - решает, какие MCP‑calls по бронированию разрешены,
    - отвечает: `bookingDecision` (success / need_alternative / failed) и, при необходимости, handoff‑контекст.

- **What to build new**
  - Явные статусы бронирования на уровне conversation_events (e.g. `booking_proposed`, `booking_confirmed`, `booking_failed`).

- **Priority**
  - **Medium/High** — ключ к управляемой автономии бронирования, но поверх существующей логики.

- **Dependencies**
  - Schedule Interpreter.
  - Scenario policies.

---

### 5.5 Reschedule Specialist

- **Purpose**
  - Управление переносами: выбор новой даты/слота, проверка политик (особенно <48h).

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - Gateway:
    - `mcp/tools/crm/rescheduleAppointment.ts`.
    - `altegio/slots.ts` (общие функции слотов).
  - Orchestrator:
    - Intent `RESCHEDULE` в `intent.ts`.
    - В системном промпте: правила `RESCHEDULE` и policy‑секция.
    - Реализация на стороне AI (LLM) + общая обработка MCP‑вызовов в `agentProcessor`.

- **What to keep**
  - Существующие MCP‑tools.
  - Общий pattern: сначала детерминированная проверка слотов/политик, затем LLM для диалога.

- **What to extract**
  - Модуль `rescheduleSpecialist`, аналогичный booking, чтобы логика переноса была изолирована от остальных сценариев.

- **What to build new**
  - Детерминированные проверки «<48h перенос» и шаблоны ответов.

- **Priority**
  - **Medium** — после стабилизации booking.

- **Dependencies**
  - Scenario Policy + Schedule Interpreter.

---

### 5.6 Cancellation Specialist

- **Purpose**
  - Управлять запросами на отмену, в том числе штрафы, предоплата, окна <48h; взаимодействовать с gateway approvals.

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - Gateway:
    - `crm.cancel_appointment.plan` / `.apply` + `admin.cancel_*` алиасы.
    - Слой approvals + idempotency.
  - Orchestrator:
    - intent `CANCEL_REQUEST`.
    - System prompt/DECISION MATRIX/ESCALATE для cancellation.
    - Общая обработка MCP‑звонков в `agentProcessor`.

- **What to keep**
  - Approvals и idempotency в gateway.
  - Политика «отмена всегда через approval» (сейчас реализуется в system prompt + gateway policies).

- **What to extract**
  - `cancellationSpecialist` для orchestration cancel‑flows (создание планов, коммуникация «нужно одобрение», handoff).

- **What to build new**
  - Dетерминированные ответы на типовые кейсы (отмена позже 24h vs впритык).

- **Priority**
  - **Medium**.

- **Dependencies**
  - Gateway approvals.

---

### 5.7 Policy Specialist

- **Purpose**
  - Централизованно загружать, кешировать и применять scenario‑policies, KB‑policies и другие правила к decision‑flow.

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - `scenarioPolicy.ts` (загрузка policies).
  - `kb.ts` (KB‑policies, templates, playbooks).
  - `agentProcessor.ts` (guards на reply/execute/handoff).
  - DB: `agent_policies`, `scenario_policies`, `approval_policies` (в gateway).

- **What to keep**
  - Разделение: scenario‑level policies в orchestrator, action‑level approvals в gateway.

- **What to extract**
  - `policySpecialist` (или `policyEngine` в orchestrator), который:
    - комбинирует scenarioPolicy + KB + глобальные hard rules,
    - выдаёт единый `DecisionPermissions` (canReply, canExecuteMutating, canHandoff, requiresApproval, thresholds).

- **What to build new**
  - Лёгкий «policy snapshot» для записи в `conversation_events` и admin‑интерфейсы.

- **Priority**
  - **Medium/High** — влияет на безопасность и управляемость.

- **Dependencies**
  - Все policy‑таблицы и KB.

---

### 5.8 Comment/Update Specialist

- **Purpose**
  - Управлять системными комментариями, заметками для админа, обновлением карточки клиента/записей в CRM (не бронирование, а именно метаданные).

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - Gateway:
    - `admin.update_client`, `admin.update_appointment_services`.
  - Orchestrator:
    - Вызовы этих tools из `agentProcessor` по mcp_calls от AI (под policy guards).
  - Admin‑UI:
    - Просмотр handoff‑кейсов и бесед, но не редактирование клиента.

- **What to keep**
  - Admin‑tools в gateway как единственный путь модификации клиентов/записей.

- **What to extract**
  - Лёгкий слой в orchestrator (`commentUpdateSpecialist`), который:
    - принимает из AI структуру «что обновить»,
    - валидирует против policy,
    - вызывает соответствующий MCP tool или создаёт approval/handoff.

- **What to build new**
  - UI в admin‑ui для просмотра/редактирования таких изменений (низкий приоритет).

- **Priority**
  - **Low/Medium**.

- **Dependencies**
  - Scenario policies + gateway admin tools.

---

### 5.9 Handoff Specialist

- **Purpose**
  - Управлять жизненным циклом handoff: когда создавать, как формировать summary, как связывать с pending actions, как возвращать бота (`resume/release`).

- **Exists status**
  - **exists_partially (очень близко)**

- **Current repo touchpoints**
  - `handoff.ts` — `createHandoffCase`, `addPendingAction`, выбор контактов с проблемами.
  - `agentProcessor.ts` — все вызовы `createHandoffAndPauseWithSummary`.
  - `telegram/bot.ts` — команды `/takeover`, `/release`, список контактов.
  - DB: `handoff_cases`, `pending_admin_actions`, `conversation_events` (`handoff_created`).
  - Admin‑UI:
    - `handoffs.ejs`, `on-hold.ejs`, просмотр и ручной release.

- **What to keep**
  - Связку: handoff_cases + pending_admin_actions + Telegram + admin‑ui.

- **What to extract**
  - Выделить `handoffSpecialist` как фасад над `handoff.ts`, чтобы `agentProcessor` не управлял деталями (какие поля писать, как формировать reason_code и tags).

- **What to build new**
  - Больше типов handoff‑кодов и шаблонов, плюс граф в admin‑ui.

- **Priority**
  - **High** — ключ для наблюдаемости и качества.

- **Dependencies**
  - Conversation events, audit, Telegram bot.

---

### 5.10 Decision Assembler

- **Purpose**
  - Собрать финальное решение «RESPOND / HANDOFF / NEED_APPROVAL + mcp_calls + tags» на основе:
    - Scenario Router,
    - Client Context,
    - Schedule/Booking/Reschedule/Cancellation specialists,
    - Policy Specialist,
    - LLM‑результата.

- **Exists status**
  - **exists_partially** (как часть `agentProcessor` + aiAgent.ts).

- **Current repo touchpoints**
  - `aiAgent.ts` — вызов LLM и парсинг JSON.
  - `agentProcessor.ts` — применение результата LLM + policy + guards.

- **What to keep**
  - Формат ответа LLM (decision, confidence, reply_text, mcp_calls, handoff, tags).

- **What to extract**
  - Модуль `decisionAssembler`, который:
    - принимает raw result LLM + детерминированный слой + policy,
    - выдаёт финальное структурированное решение, уже очищенное от «некорректных» mcp_calls и противоречий.

- **What to build new**
  - Больше событий `decision_*` в `conversation_events`.

- **Priority**
  - **Medium/High** — после выделения specialists.

- **Dependencies**
  - Почти все предыдущие модули.

---

### 5.11 Writer

- **Purpose**
  - Отвечать за финальный текст ответа клиенту (на выбранном языке, с нужной структурой), используя:
    - templates (KB),
    - локализацию,
    - стиль бренда.

- **Exists status**
  - **exists_partially** (LLM + localization).

- **Current repo touchpoints**
  - System prompt (`STRUCTURE EVERY MESSAGE`).
  - KB (`agent_templates`, `agent_examples`, `agent_playbooks`).
  - `localization.ts` — системные сообщения.
  - `agentProcessor.ts` — выбор ответа (LLM vs system fallback).

- **What to keep**
  - System prompt и KB как источник стиля.
  - `localization.ts` как слой для системных fallback’ов.

- **What to extract**
  - `writer.ts`, который:
    - знает о языках и шаблонах,
    - на вход получает intent/decision и данные, а на выход даёт готовый текст.

- **What to build new**
  - Явные «writer‑моды» (booking, reschedule, apology, policy‑explainer).

- **Priority**
  - **Medium**.

- **Dependencies**
  - KB, localization, language detection.

---

### 5.12 Reply QA Guard

- **Purpose**
  - Финальный «safety check» поверх reply: язык, тон, отсутствие запрещённых фраз, отсутствие бизнес‑ошибок (обещание недоступных слотов и т.п.).

- **Exists status**
  - **exists_partially**

- **Current repo touchpoints**
  - Confidence‑guard в `agentProcessor` (low confidence → handoff).
  - Буферные сообщения `booking_failed`, `booking_not_confirmed_fallback`.
  - System prompt (`NEVER SAY`, `BOOKING SLOTS STRICT`).
  - Policy guards на mutating calls.

- **What to keep**
  - Confidence‑guard как часть QA.
  - Policy‑guard на mutating действия.

- **What to extract**
  - Модуль `replyQaGuard`, который:
    - принимает предложенный `reply_text` + context + tags,
    - проверяет паттерны (язык, запрещённые фразы, недопустимые обещания),
    - может заменить ответ на безопасный fallback и/или создать handoff.

- **What to build new**
  - Набор QA‑правил (регулярки/чек‑листы) и их storage в KB/policies.

- **Priority**
  - **Medium**.

- **Dependencies**
  - Writer, Policy Specialist, Schedule Interpreter.

---

## 6. Key architectural pressure points

- **`agentProcessor.ts`**:
  - выполняет функции Scenario Router, Client Context Resolver, Booking/Reschedule/Cancellation Specialist, Policy Specialist, Decision Assembler, Writer и Reply QA Guard одновременно;
  - сложно тестировать изолированно отдельные части (например, только booking).

- **Размытые границы между «детерминированным» и «LLM» уровнями**:
  - Детерминированный слой расписания уже есть, но другие области (отмена, политика, handoff‑решения) пока смешаны с LLM‑логикой.

- **Admin‑инструменты**:
  - admin‑ui даёт хороший обзор, но **управление политиками/KB** всё ещё частично через DB и не полностью отражено в UI.

- **Связка orchestrator ↔ gateway через MCP**:
  - Сильная сторона (всё через ограниченный набор tools), но orchestration‑логика (что именно вызывать и когда) пока централизована в одном месте.

## 7. Safe implementation order

1. **Stabilize Schedule Interpreter (уже почти сделано)**  
   - Сконцентрироваться на `deterministicScheduling.ts` + gateway `get_availability_for_date`.
   - Добавлять новые сценарии (например, относительно недель/месяцев) именно там.

2. **Extract Scenario Router (thin слой)**  
   - Выделить из `agentProcessor` минимальный `ScenarioRouter` + события `scenario_selected`, `policy_applied`.

3. **Client Context Resolver**  
   - Вынести сбор контекста (conversations, overrides, KB, последние сообщения) в отдельный сервис.

4. **Handoff Specialist**  
   - Обернуть текущие вызовы handoff‑логики в модуль, оставить контракты прежними.

5. **Policy Specialist**  
   - Централизовать загрузку и применение scenario policies + KB‑policies.

6. **Booking Specialist**  
   - Вытащить логику бронирования (после Schedule Interpreter) в отдельный модуль.

7. **Reschedule & Cancellation Specialists**  
   - Аналогично booking, но для переноса и отмены.

8. **Writer & Reply QA Guard**  
   - Вынести финальную сборку текста и QA‑проверки отдельно от принятия решения.

На каждом шаге **контракты между сервисами и формат LLM‑ответа остаются прежними**, изменения происходят только внутри orchestrator.

## 8. Compatibility notes

- MCP‑контракты gateway ↔ orchestrator **не меняются** (те же инструменты, тот же формат `/mcp`).
- Ингест WhatsApp (`/ingest/whatsapp-web`) и `wa-service` **остаются такими же**.
- DB‑схема уже поддерживает новые сущности (scenarios, policies, events, reviews); предлагаемый порядок изменений не требует дропать или мигрировать старые таблицы.
- System prompt и формат ответа LLM **не меняются** на этапе mapping/рефактора; модульность строится вокруг уже заданного интерфейса.

## 9. Risks / open questions

- **Риск перегрева `agentProcessor` во время перехода**  
  Пока части логики только частично вынесены в отдельные модули, легко допустить дублирование и расхождение поведения.

- **Неоднородность политик**  
  Сейчас есть scenario_policies, KB‑policies и gateway approvals. Нужна чёткая «иерархия приоритетов» и единый Policy Specialist, чтобы не было конфликтов.

- **Уточнение бизнес‑правил**  
  Некоторая логика (например, конкретные фразы при предложении альтернатив) должна быть согласована на уровне продукта/бренда, а не только кода.

- **Altegio data quality**  
  Все детерминированные решения по расписанию зависят от качества и доступности данных Altegio (расписание, услуги, мастера).

## 10. Next recommended step

- **Шаг 1:** формально оформить и стабилизировать Schedule Interpreter как отдельный модуль в orchestrator, зафиксировав его контракт (вход: текст и companyId; выход: либо детерминированный ответ, либо «не применимо»).  
- **Шаг 2:** на базе уже реализованных `scenarioPolicy.ts` и событий начать выносить Scenario Router в отдельный модуль, не меняя пока саму логику решений.

Это даст чёткую границу между:
- «что мы можем решить детерминированно до LLM» и
- «что передаётся в LLM + policy guards».

## 11. Diff summary

- В рамках этого этапа:
  - **Новых крупных модулей не добавлено**, кроме **аналитического отчёта** `docs/reports/architecture-repo-mapping-report.md` (этот файл).
  - Никаких изменений в контрактах ingest / MCP / wa-service не произведено.
  - Изменения в кодовой базе до этого отчёта относились к детерминированному расписанию и admin‑ui; в рамках **Stage Report: architecture-repo-mapping** добавлен только этот отчёт.

## 12. Validation

- Repo‑обзор покрывает основные слои (orchestrator, gateway, admin‑ui, DB, prompts).
- Целевая архитектура (Scenario Router, Specialists, Guards) **сопоставлена** с существующими файлами и таблицами; для каждого элемента определён статус (full/partial/missing) и предложен путь эволюции.
- Предложенный порядок внедрения **сохраняет совместимость** с текущей системой и не требует изменения внешних контрактов.

---

## Appendix: Proposed module ownership

### Orchestrator

- Scenario Router  
  - `intent.ts`, `scenarioPolicy.ts` (+ новый фасад `ScenarioRouter`).
- Client Context Resolver  
  - `conversation.ts`, `messageStore.ts`, `behaviorOverrides.ts`, `kb.ts` (+ новый модуль `clientContext.ts`).
- Schedule Interpreter  
  - `deterministicScheduling.ts`, `bookingContext.ts`.
- Booking Specialist  
  - новый `bookingSpecialist.ts` (поверх текущего `agentProcessor` + MCP calls).
- Reschedule Specialist  
  - новый `rescheduleSpecialist.ts`.
- Cancellation Specialist  
  - новый `cancellationSpecialist.ts`.
- Policy Specialist  
  - `scenarioPolicy.ts`, `kb.ts` (+ новый фасад `policySpecialist.ts`).
- Comment/Update Specialist  
  - новый `commentUpdateSpecialist.ts` (использует MCP admin tools).
- Handoff Specialist  
  - `handoff.ts`, `telegram/bot.ts` (+ фасад `handoffSpecialist.ts`).
- Decision Assembler  
  - `aiAgent.ts`, `agentProcessor.ts` (+ новый слой `decisionAssembler.ts`).
- Writer  
  - `localization.ts`, KB (`agent_templates`, `agent_examples`, `agent_playbooks`) + новый `writer.ts`.
- Reply QA Guard  
  - часть `agentProcessor.ts` + новый `replyQaGuard.ts`.

### Gateway

- MCP/CRM/Altegio deterministic layer:
  - `mcp/router.ts`, `mcp/tools/**`, `altegio/client.ts`, `altegio/slots.ts`.
- Approvals & idempotency:
  - `approvals/service.ts`, `approvals/idempotency.ts`, `db/migrations/00{1,2,3}.sql`.
- Policy engine для plan/apply:
  - `policy/rules.ts`, `policy/engine.ts`.
- Конфиг и rate limiting:
  - `config/resolver.ts`, `rateLimit/**`.

### Admin‑UI

- Governance & наблюдаемость:
  - `server.js` + `views/*`:
    - просмотр бесед, handoff‑кейсов, reviews, policies;
    - тест‑кейсы по языкам/сценариям/policy gating;
    - smoke‑матрица (handoff/respond/blocked execution).
- В перспективе:
  - UI для редактирования scenario_policies, KB, client overrides, corrections.

### Shared types/contracts

- Формат LLM‑ответа:
  - `aiAgent.ts` + `aiAgentSystemPrompt.ts` — общий контракт JSON: decision, confidence, reply_text, mcp_calls, handoff, tags.
- MCP‑envelope:
  - `gateway/src/mcp/envelope.ts`, `orchestrator/src/services/mcpClient.ts` — структура `/mcp` запросов/ответов.
- Conversation‑ID / phone:
  - `conversations.conversation_id`, `client_phone E.164` (`lib/e164.ts`), используются всеми слоями как основной идентификатор диалогов/клиентов.

