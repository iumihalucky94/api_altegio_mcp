# Stage Report: admin-ui-decision-observability

## 1. Goal

Сделать enriched `DecisionObject` диагностически наблюдаемым в admin-ui:
- показать ключевые поля scenario/policy/specialists/outcome/reply/handoff/writer/QA,
- встроить это в существующий UI без большого redesign,
- использовать уже существующие `conversation_events` и новый event `decision_object_enriched`.

## 2. Scope

В этом этапе:
- расширен admin-ui `events` view для отображения последнего `decision_object_enriched` snapshot,
- backend-часть (route `/events/:conversationId`) переиспользована без изменения контракта,
- новый модуль backend не создавался; логика осталась в пределах views.

Не делалось:
- изменение других страниц admin-ui,
- новый API слой или изменение orchestrator contracts,
- redesign layout или навигации.

## 3. Current admin-ui findings

До этапа:
- **Conversations view (`conversations.ejs`)**:
  - показывал список бесед (`conversation_id`, телефон, state, язык, текущий сценарий, последняя входящая),
  - имел ссылку "События" (`/events/:conversationId`) для просмотра событий конкретной беседы.
- **Events view (`events.ejs`)**:
  - отображал все события из `conversation_events` таблицы,
  - формат:
    - таблица с колонками "Время", "Тип", "Payload",
    - payload показывался как raw JSON/строка, через `pre` и `JSON.stringify`.
  - не было выделенного блока для `decision_object_enriched`, события отображались линейно.
- **server.js**:
  - имел роут:
    - `GET /events/:conversationId` → запрос к `conversation_events` и рендер `events.ejs` с `events: r.rows`.
  - backend уже умел отдавать `event_payload_json`, не требовалось менять запрос.

Почему выбран именно `events` view:
- это место, где уже отображается полный chronological log по беседе,
- логично добавить туда summary последнего enriched decision snapshot,
- не нужно создавать отдельный "diagnostics" route/page — интеграция минимальна и инвазивна только в одну view.

## 4. Files reviewed

- `admin-ui/server.js`
- `admin-ui/views/conversations.ejs`
- `admin-ui/views/events.ejs`
- отчёты по DecisionObject enrichment/persistence (`decision-object-action-plan-enrichment-report.md`, `decision-object-persistence-diagnostics-report.md`)

## 5. UI integration approach

Выбран подход:
- **conversation detail → events**:
  - админ идёт из списка бесед (`/conversations`) в события (`/events/:conversationId`),
  - сверху страницы событий отображается компактный diagnostics block "Последний decision snapshot",
  - ниже остаётся исходная таблица со всеми событиями.

Причины выбора:
- минимальная точка интеграции,
- не требует изменения других страниц,
- логически соответствует задаче "посмотреть, что решил оркестратор по конкретной беседе".

## 6. Data flow changes

- **server.js**:
  - маршрут `GET /events/:conversationId` не менялся по сути:
    - по-прежнему делает запрос:
      ```sql
      SELECT id::text, event_type, event_payload_json, created_at::text
      FROM conversation_events
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      ```
    - и рендерит `events.ejs` с `conversationId` и `events`.
  - никаких новых полей/контрактов на backend не добавлялось.

- **events.ejs**:
  - на стороне view:
    - вычисляется:
      ```js
      const decisionEvents = (events || []).filter(e => e.event_type === 'decision_object_enriched');
      ```
    - выбирается последний snapshot:
      ```js
      const last = decisionEvents[decisionEvents.length - 1];
      const d = typeof last.event_payload_json === 'object'
        ? last.event_payload_json
        : (last.event_payload_json ? JSON.parse(last.event_payload_json) : null);
      ```
    - payload `d` используется как diagnostic snapshot, ожидаемый по структуре:
      - `scenario`, `policy`, `specialists`, `handoff`, `reply`, `outcome`, `writer`, `replyQa`.

Поля, которые отображаются:
- `scenario.intent`, `scenario.code`, `scenario.confidence`
- `policy.permissions.canReply`, `canExecuteMutating`, `canCreateHandoff`, `requiresAdminApproval`, `confidenceThreshold`
- `specialists.booking/reschedule/cancellation` (если есть):
  - `status`, `domainStatus`, `reasonCode`
- `outcome.type`, `outcome.reasonCode`, `outcome.confidence`
- `reply.language`, `reply.text` (усечённый уже на стороне orchestrator)
- `handoff.reasonCode`, `handoff.priority`, `handoff.summary`
- `writer.usedFallback`
- `replyQa.fallbackUsed`, `replyQa.issues[].code`

## 7. UI rendering model

Файл `admin-ui/views/events.ejs` был переработан так:

- **Шапка и навигация**:
  - Сохранились:
    - заголовок с `conversationId`,
    - кнопки "← Беседы", "On hold", "Добавить оценку".

- **Новый diagnostics блок "Последний decision snapshot"**:
  - Показывается только если есть хотя бы один `decision_object_enriched` event.
  - Внутри:
    - `Scenario`:
      - `Intent`, `Scenario`, `Confidence` (с форматированием до 3 знаков).
    - `Policy`:
      - `canReply`, `canExecuteMutating`, `canCreateHandoff`, `requiresAdminApproval`, `confidenceThreshold`.
    - `Outcome`:
      - `Type`, `Reason`, `Confidence`.
    - `Specialists`:
      - `Booking/Reschedule/Cancellation` строками формата:
        - `status / domainStatus / reasonCode` или `—`, если данных нет.
    - `Reply / Handoff`:
      - `Reply language`, `Reply text`,
      - `Handoff` в виде `reasonCode / priority` + короткий summary, если присутствует.
    - `Writer / QA`:
      - `Writer usedFallback`,
      - `QA fallbackUsed`,
      - список `QA issues` (коды) или `none`.
  - Ниже — collapsible `details`:
    - заголовок "Raw decision_object_enriched payload",
    - `pre` с `JSON.stringify(d, null, 2)` для тех случаев, когда нужен полный JSON.

- **Fallback при отсутствии snapshot**:
  - Если `decision_object_enriched` отсутствует:
    - отображается card с текстом:
      - "Decision snapshot для этой беседы пока не зафиксирован."

- **Исходная таблица событий**:
  - Ниже diagnostics блока оставлена исходная таблица всех событий:
    - "Время", "Тип", "Payload" с raw JSON.
  - Это гарантирует, что существующий UX для событий не ломается.

## 8. Compatibility notes

- Существующий UI:
  - роуты не менялись,
  - уже существующие колонки и данные в таблице событий остались на месте.
- Новый код:
  - осторожно парсит `event_payload_json`:
    - если это объект — использует его как есть,
    - если строка — пытается `JSON.parse`, иначе показывает сообщение о невозможности разобрать.
  - при ошибках парсинга блок diagnostics fallback-ится в "не удалось разобрать payload", но сама страница остаётся рабочей.
- В случае отсутствия snapshot:
  - diagnostics блок отображает понятное сообщение, других эффектов нет.

## 9. Risks / open questions

- Возможные риски:
  - Если структура `decision_object_enriched` в orchestrator поменяется, UI-рендеринг может потерять часть данных или показать их как `undefined`.
    - mitigated тем, что UI везде делает defensively checks (`d && d.xxx`) и fallback-значения.
- Открытые вопросы:
  - Нужно ли в будущем иметь отдельную страницу "Decision diagnostics" с фильтрацией по сценариям, а не только per-conversation view?
  - Имеет ли смысл отображать несколько последних snapshots (таймлайн), а не только последний?

## 10. Next recommended step

- Возможные следующие шаги:
  - добавить в admin-ui фильтры по `decision_object_enriched` событиям (например, список последних проблемных QA issues),
  - связать diagnostics с review-инструментами (например, твёрже подсвечивать беседы с `unsafe_confirmation` или language mismatch),
  - рассмотреть небольшой dedicated diagnostics dashboard на основе уже собранных событий.

## 11. Diff summary

- **added**
  - `docs/reports/admin-ui-decision-observability-report.md`
- **modified**
  - `admin-ui/views/events.ejs` — добавлен diagnostics блок для отображения последнего `decision_object_enriched` snapshot, при этом исходная таблица событий сохранена.
- **untouched**
  - `server.js` роуты и логика выборки событий (запрос к `conversation_events` не менялся по сути),
  - другие views admin-ui (`conversations.ejs`, `handoffs.ejs`, и т.д.),
  - orchestrator/gateway/wa-service контракты, `decisionDiagnostics.ts`.

## 12. Validation

- UI:
  - EJS-шаблон собирается корректно (проверка линтером/views),
  - при наличии `decision_object_enriched` event в `conversation_events` diagnostics блок отображает осмысленные данные,
  - при его отсутствии страница отображается без ошибок, показывая сообщение о том, что snapshot отсутствует.
- Backend:
  - `server.js` компилируется и продолжает отдавать `events` как раньше; event payload обрабатывается в view.

## Appendix: Example rendered decision snapshot

Пример того, как блок выглядит в UI (в текстовом виде):

- **Scenario**
  - Intent: `BOOKING`
  - Scenario: `booking`
  - Confidence: `0.980`
- **Policy**
  - canReply: `true`
  - canExecuteMutating: `false`
  - canCreateHandoff: `true`
  - requiresAdminApproval: `true`
  - confidenceThreshold: `0.970`
- **Outcome**
  - Type: `RESPOND`
  - Reason: `ok`
  - Confidence: `0.980`
- **Specialists**
  - Booking: `ok / exact_slot_available / booking_exact_slot_available`
  - Reschedule: `—`
  - Cancellation: `—`
- **Reply / Handoff**
  - Reply language: `ru`
  - Reply text: `Привет! Да, у нас есть свободное окно на завтра в 15:00. Подойдёт ли вам это время?`
  - Handoff: `—`
- **Writer / QA**
  - Writer usedFallback: `false`
  - QA fallbackUsed: `false`
  - QA issues: `none`

При разворачивании блока "Raw decision_object_enriched payload" администратор может увидеть полный JSON для более детального анализа.

