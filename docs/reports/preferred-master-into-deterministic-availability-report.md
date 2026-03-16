# Stage Report: preferred-master-into-deterministic-availability

## 1. Goal

Сделать так, чтобы deterministic availability path учитывал приоритеты по мастеру:
1) явно указанного мастера в сообщении;
2) preferred мастера клиента;
3) только затем общую доступность по всем мастерам.
И чтобы текст ответа честно отражал источник слотов (конкретный мастер vs общая доступность).

## 2. Scope

- Orchestrator:
  - `orchestrator/src/services/deterministicScheduling.ts`
  - `orchestrator/src/services/agentProcessor.ts`
- Gateway:
  - **не менялся** — используется уже существующий tool `crm.get_free_slots` для staff-specific availability.

## 3. Problem before implementation

До изменений deterministic path:
- всегда опирался на `crm.get_availability_for_date`, который считает union availability по мастерам;
- не знал ни об explicit staff из текста, ни о preferred master клиента;
- не мог различать:
  - слоты у конкретного мастера;
  - общую доступность салона.

Это ломало бизнес-логику салона:
- приоритетный сценарий «сначала пытаться записать к своему мастеру» не выполнялся;
- deterministic слой мог отвечать «есть слоты», но клиент не понимал, у кого именно;
- staff preference отрабатывал только в AI-path (через free_slots), но deterministic ответ, который срабатывает раньше, обходил эти предпочтения.

## 4. Files reviewed

- `orchestrator/src/services/agentProcessor.ts` — deterministic вызов, загрузка staff/services/appointments, существующий free_slots path.
- `orchestrator/src/services/deterministicScheduling.ts` — логика `tryDeterministicSchedulingReply`, работа с `crm.get_availability_for_date`.
- `gateway/src/mcp/tools/crm/getAvailabilityForDate.ts` — текущий union-availability tool (не менялся в этом этапе).
- `gateway/src/mcp/tools/crm/getFreeSlots.ts` (по существующему использованию в agentProcessor) — как вызывать staff-specific availability.

## 5. Preferred master source

В рамках этого этапа использовано следующее:

- **Explicit staff from message**:
  - уже существующая функция `matchStaffFromMessage(batchText, staff)` из `agentProcessor.ts`;
  - это Priority 1, если клиент явно назвал мастера.

- **Preferred master**:
  - использован уже доступный в рантайме контекст `appointments` (полученный через `admin.get_upcoming_appointments_by_phone`);
  - берётся `appointments[0].master` (последний известный предстоящий визит) и по нему ищется совпадение в `staff` по имени;
  - это Priority 2.

- **Ограничения**:
  - сейчас используется только предстоящая запись (upcoming), а не полный лог завершённых визитов;
  - это честно отражено как «latest known upcoming appointment»; более глубокая история не подтягивается в этом этапе.

## 6. Runtime logic changes

### Orchestrator: deterministicScheduling.ts

- Добавлена helper-функция `getFreeSlotsForStaffOnDate(companyId, staffId, serviceId, date, requestId)`, которая:
  - вызывает `crm.get_free_slots` в gateway для конкретного мастера и услуги;
  - возвращает массив `free_slots` (ISO-строки дат) или пустой массив при ошибке.

- Расширен контракт `tryDeterministicSchedulingReply`:
  - новые параметры:
    - `explicitStaffId?: number`
    - `preferredStaffId?: number`
    - `serviceIdForBooking?: number`
  - существующий `preferredStaffName?: string` остаётся как display name для ответа.

- Изменена последовательность внутри `tryDeterministicSchedulingReply`:
  1. **Clarification step** для generic lash booking (уже был, не изменялся).
  2. **Staff-specific branch**:
     - определяется `staffIdForSpecific = explicitStaffId ?? preferredStaffId`;
     - если он и `serviceIdForBooking` заданы, вызывается `getFreeSlotsForStaffOnDate(...)` только для этого мастера;
     - если массив слотов не пуст:
       - формируется текст слотов через `formatSlotsForMessage` (максимум 3, многострочно);
       - дата форматируется через `formatDateLabel`;
       - если `preferredStaffName` задан — используется шаблон `slots_available_with_master`;
       - иначе — `slots_available` (generic wording, но технически это всё равно слоты конкретного мастера);
       - в events добавляется `deterministic_reply_sent` с `staff_specific: true` и `staff_id`;
       - deterministic path **возвращает** staff-specific ответ и **не** идёт в union-availability.
  3. **Generic all-staff branch** (fallback):
     - если staff-specific слоты не найдены, вызывается `getAvailabilityForDate` как раньше;
     - далее логика остаётся прежней:
       - если `working_hours_count === 0` → day closed + day alternatives;
       - если `slotsOnRequested.length > 0` → `slots_available` (многострочный текст, общая доступность);
       - иначе → `working_time_violation` / `working_time_violation_no_slots` с альтернативами.

### Orchestrator: agentProcessor.ts

- Перед вызовом `tryDeterministicSchedulingReply` добавлена явная инициализация staff preference:
  - `explicitStaffId`:
    - ищется через `matchStaffFromMessage(batchText, staff)` (Priority 1).
  - `preferredStaffId` и `preferredStaffName`:
    - по `appointments[0].master` ищется `matched` в `staff` по имени;
    - при совпадении сохраняются `matched.id` и `matched.name` (Priority 2).
  - `serviceIdForBooking`:
    - берётся `services[0].id`, если список услуг не пуст (минимально безопасный fallback, уже использующийся в free_slots path).

- Вызов deterministic теперь передаёт:
  - `preferredStaffName`
  - `explicitStaffId`
  - `preferredStaffId`
  - `serviceIdForBooking`

- Остальной free_slots path и AI-path остаются неизменными.

## 7. Availability resolution hierarchy

Фактическая runtime-иерархия в deterministic path теперь такая:

1. **Explicit master (Priority 1)**:
   - если клиент явно указал мастера и мы нашли его в `staff`:
     - deterministic сначала пробует получить слоты только для этого мастера через `crm.get_free_slots`;
     - при успехе отвечает staff-specific текстом (с именем мастера).

2. **Preferred master (Priority 2)**:
   - если explicit нет, но есть `preferredStaffId` по последней предстоящей записи:
     - deterministic пробует получить слоты только для этого мастера через `crm.get_free_slots`;
     - при успехе отвечает staff-specific текстом (с именем мастера из `matched.name`).

3. **Generic all-staff fallback (Priority 3)**:
   - если у explicit/preferred мастера на нужную дату нет слотов:
     - deterministic вызывает `crm.get_availability_for_date` (union availability);
     - и строит generic ответ по текущим правилам:
       - `slots_available` (общая доступность),
       - `requested_date_not_open` + `day_alternatives`,
       - или `working_time_violation` / `working_time_violation_no_slots`.

## 8. Reply wording changes

В рамках этого этапа:

- **Staff-specific template** (уже был добавлен ранее, теперь реально используется для staff-specific ветки):
  - `slots_available_with_master` (DE/RU/EN):
    - RU-пример: «У {{masterName}} на {{date}} есть такие варианты:\n{{slots}}\n\nПодойдёт ли вам что-то из этого?»

- **Generic availability template**:
  - `slots_available` остаётся многострочным, но с явной пометкой общей доступности (RU) / any available staff (EN) / bei einem unserer Team-Mitglieder (DE).
  - Используется, когда:
    - либо нет staff preference;
    - либо staff-specific branch не нашла ни одного слота и мы упали в union-availability.

**Важно:** staff-specific текст используется **только** если слоты были реально получены для конкретного `staffId` через `crm.get_free_slots`. В противном случае используется generic wording.

## 9. Compatibility notes

- Gateway:
  - не менялся контракт `crm.get_availability_for_date`;
  - используется уже существующий `crm.get_free_slots`, который и так применялся в других частях orchestrator.

- Orchestrator:
  - новые параметры в `tryDeterministicSchedulingReply` используются только из `agentProcessor.ts`;
  - DecisionObject, diagnostics и остальные слои не затронуты.

- Сохранены:
  - clarification step для generic lash booking;
  - максимум 3 слота;
  - многострочный формат;
  - существующие deterministic коды и события.

## 10. Risks / open questions

- Источник preferred master:
  - сейчас это только `appointments[0].master` (последняя предстоящая запись), а не полный лог завершённых визитов;
  - потенциально нужна отдельная сущность «last completed visit» в будущем.

- Match по имени:
  - поиск мастера по подстроке имени может быть неоднозначным при похожих фамилиях/именах;
  - для 100% точности возможно лучше использовать стабильные ID из CRM, если они есть в appointment payload.

- Service selection:
  - пока используется `services[0].id` как serviceIdForBooking;
  - для более точной логики (например, разный сервис для коррекции/нового набора) потребуется связка с уже внедрённым lash clarification и конкретным типом услуги.

## 11. Diff summary

**Added**
- `getFreeSlotsForStaffOnDate` в `deterministicScheduling.ts`.
- Параметры `explicitStaffId`, `preferredStaffId`, `serviceIdForBooking` в `tryDeterministicSchedulingReply`.

**Modified**
- `tryDeterministicSchedulingReply`:
  - добавлена staff-specific ветка перед generic union-availability;
  - staff-specific ветка использует `crm.get_free_slots` + staff-specific/generic шаблоны.
- `agentProcessor.ts`:
  - вычисление `explicitStaffId`, `preferredStaffId`, `preferredStaffName`, `serviceIdForBooking` до deterministic вызова;
  - передача этих параметров в `tryDeterministicSchedulingReply`.

**Untouched**
- Контракты gateway MCP tools.
- AI-path (LLM), booking specialist, DecisionObject, diagnostics.
- Lash clarification, slot limiting, форматирование.

## 12. Validation

- Сборка:
  - `docker compose build orchestrator gateway` успешно отрабатывает (TypeScript build ок).

- Runtime expectations:
  - generic lash запрос → сначала clarification, как и ранее;
  - после уточнения типа услуги:
    - если в тексте указан мастер и у него есть слоты → deterministic отвечает staff-specific шаблоном по этому мастеру;
    - если мастер не указан, но есть preferred master из последней предстоящей записи и у него есть слоты → deterministic отвечает staff-specific шаблоном с его именем;
    - если у explicit/preferred мастера нет слотов → deterministic падает в generic all-staff ветку и отвечает общей доступностью.

## Appendix: Example before/after flow

**До:**
1. Клиент: «привет, нужна запись на реснички, на завтра есть окошко?»
2. Система:
   - не учитывает preferred master в deterministic path;
   - может сразу посчитать union availability и выдать generic слоты без указания мастера.

**После:**
1. Клиент: «привет, нужна запись на реснички, на завтра есть окошко?»
2. Система (deterministic):
   - видит generic lash запрос без типа услуги;
   - отвечает clarification: «вам нужна коррекция или новое наращивание?».
3. Клиент: «коррекция, к Светлане»
4. Система:
   - explicit master = Светлана (из текста);
   - preferred master (из appointments) тоже может совпасть, но explicit имеет приоритет;
   - deterministic сначала вызывает `crm.get_free_slots` для Светланы и выбранной услуги на запрошенную дату;
   - если есть слоты:
     - отвечает staff-specific шаблоном: «У Светланы на четверг есть такие варианты: …» (максимум 3 слота, многострочно);
   - если нет слотов:
     - вызывает `crm.get_availability_for_date` и отвечает generic доступностью: «На четверг у нас есть такие варианты (общая доступность): …».

