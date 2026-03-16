# Stage Report: fix-deterministic-availability-generic-booking

## 1. Root cause

Наблюдаемый баг:
- Клиент пишет: `"привет, нужна запись на реснички, на завтра есть окошко?"`.
- Детерминированный слой отвечает: `"В этот день мы не работаем"`.
- В реальности в этот день есть свободные окна у других мастеров.

Причина:
- Gateway tool `crm.get_availability_for_date`:
  - выбирал только **первого мастера** (`firstStaff`) и **первую услугу** (`firstService`),
  - считал `working_hours_count` только для этой пары,
  - если у этой пары `working_hours_count = 0`, возвращал как будто **день закрыт**.
- Orchestrator deterministic layer:
  - использовал `working_hours_count === 0` как сигнал "салон закрыт в этот день",
  - не различал ситуацию "конкретный мастер не работает" vs "вообще никто не работает".

В результате:
- generic booking intent (без указания мастера) интерпретировался как "день закрыт", если только первый мастер не имел расписания, даже если другие мастера имели доступные слоты.

## 2. Что именно изменено

Изменения в двух местах:

1. `gateway/src/mcp/tools/crm/getAvailabilityForDate.ts`
   - вместо использования только одного `staffId`:
     - собирается **список всех мастеров** (`staffIds`) из `listTeamMembers`,
     - если он пуст:
       - пробует использовать fallback `DEFAULT_STAFF_ID` (из config) как `fallbackStaffId`.
   - При расчёте availability:
     - вместо одного вызова `getSchedule` только для `firstStaff`:
       - для **каждого** мастера из `targetStaffIds`:
         - вызывается `getSchedule` на нужную дату,
         - извлекаются рабочие слоты `parseScheduleToWorkingSlots`,
         - извлекаются записи `parseAppointmentIntervalsForStaff`,
         - считаются free slots `computeFreeSlotStarts`.
       - Все рабочие слоты агрегируются в `allWorkingSlots`,
       - Все свободные слоты агрегируются в `allFreeSlots`.
     - Возвращаемое значение:
       - `free_slots: allFreeSlots`,
       - `working_hours_count: allWorkingSlots.length`,
       - `staff_id: targetStaffIds[0] || null`,
       - `service_id` — как и раньше.
   - Контракт tool **сохранён**:
     - всё так же возвращает `{ date, free_slots, working_hours_count, staff_id, service_id }`,
     - semantics `free_slots`/`working_hours_count` теперь по сути "union по всем мастерам", а не только по первому.

2. Дет-слой orchestrator (`orchestrator/src/services/deterministicScheduling.ts`)
   - Логика `working_hours_count === 0 → "В этот день мы не работаем"` уже строилась на предположении "нет работающих мастеров".
   - После изменения gateway это предположение стало более корректным, т.к. `working_hours_count` теперь считает union всех staff, а не только first staff.
   - В коде deterministic слоя специфических изменений не потребовалось — он продолжает:
     - трактовать `working_hours_count === 0` как "нет работающих мастеров в этот день",
     - собирать альтернативные дни/слоты для предложения клиенту.

## 3. Как теперь считается availability для generic booking without explicit staff

При вызове `crm.get_availability_for_date`:

- **Шаг 1**: извлечение staff/services:
  - `listTeamMembers` и `listServices` вызываются как раньше.
  - Все staff элементы превращаются в числовые `staffIds` (если это возможно).
  - `serviceId` по-прежнему берётся как первая услуга из списка (с сохранением fallback на `DEFAULT_SERVICE_ID` через `getConfig`).

- **Шаг 2**: fallback по staff:
  - Если `staffIds` пуст:
    - пытается использовать `DEFAULT_STAFF_ID` как `fallbackStaffId`.
  - Если и `staffIds` пуст и `fallbackStaffId` нет:
    - возвращает "нет данных": `{ free_slots: [], working_hours_count: 0, staff_id: null, service_id: null }`.

- **Шаг 3**: расчёт по union staff:
  - `targetStaffIds = staffIds.length > 0 ? staffIds : [fallbackStaffId]`.
  - Один раз вызывается:
    - `listAppointments` на выбранный день и диапазон,
    - `listServices` для определения длительности услуги.
  - Для каждого `sid` из `targetStaffIds`:
    - `getSchedule` для `sid` и даты,
    - `parseScheduleToWorkingSlots` и `parseAppointmentIntervalsForStaff` для `sid`,
    - `computeFreeSlotStarts` для рабочего времени и записей.
  - Агрегация:
    - рабочие слоты всех мастеров в `allWorkingSlots`,
    - free slots всех мастеров в `allFreeSlots` (в ISO).

- **Результат**:
  - `working_hours_count` теперь отражает **общее количество рабочих слотов по всем мастерам**,
  - `free_slots` — объединённый список свободных стартов для всех staff, а не только first staff,
  - `staff_id` в ответе — первый из `targetStaffIds`, что сохраняет контракт, но уже не используется как единственный источник истины для union-availability.

Для generic booking intent без конкретного мастера это означает:
- если хотя бы один мастер имеет рабочее время в этот день:
  - `working_hours_count > 0`,
  - deterministic слой не скажет "В этот день мы не работаем".
- если есть доступные слоты (по хотя бы одному мастеру):
  - они попадут в `free_slots` и будут использованы для reply "Вот какие есть окна...".

## 4. Почему это не сломает текущие flows

- **Контракты tool и orchestrator**:
  - Сигнатура и структура ответа `crm.get_availability_for_date` не изменилась.
  - Orchestrator deterministic слой по-прежнему ожидает:
    - `free_slots: string[]`,
    - `working_hours_count: number`.
- **Семантика `working_hours_count === 0`**:
  - Раньше это условие было ошибочно жёстким (опиралось на первого мастера).
  - Теперь оно более корректно соответствует "нет ни одного работающего мастера в этот день".
- **Altegio truth**:
  - Расчёт по-прежнему использует Altegio schedule + appointments, ничего не придумывает сам:
    - только теперь учитывает несколько staff, а не одного.
- **Booking-specific guards и safety**:
  - Логика deterministic слоя:
    - когда день открыт, а слотов нет, всё равно не подтверждает запись, а предлагает альтернативы.
  - Логика booking execution в `agentProcessor` (`booking_failed`, `fake_confirmation_blocked`) осталась неизменной:
    - deterministic availability по-прежнему **не** создает/подтверждает записи сам,
    - deterministic слой отвечает только текстом/альтернативами.
- **Reschedule/cancel/handoff flows**:
  - Не тронуты: `crm.get_availability_for_date` используется только deterministic scheduling для booking.

Таким образом, изменения:
- только расширили понимание "есть ли хоть одно окно в этот день" для generic booking,
- не вмешались в execution, handoff, policy или другие сценарии.

## 5. Diff summary

- **modified**
  - `gateway/src/mcp/tools/crm/getAvailabilityForDate.ts`:
    - staffId → staffIds/targetStaffIds, расчёт union по всем мастерам,
    - `working_hours_count` теперь сумма рабочих слотов по всем выбранным staff,
    - `free_slots` — объединённые слоты всех staff,
    - fallback `DEFAULT_STAFF_ID` используется только если список staff пуст.
- **untouched**
  - `orchestrator/src/services/deterministicScheduling.ts`:
    - использует прежний контракт, но теперь получает более корректные значения.
  - booking/execution/handoff specialists и остальные модули.

## 6. Validation

- **TypeScript / build**:
  - `gateway` успешно собирается (tsc проходит),
  - `orchestrator` собирается без изменений в deterministic слое.
- **Docker**:
  - `docker compose build orchestrator gateway` завершился успешно,
  - `docker compose up -d orchestrator gateway` перезапустил сервисы.
- **Логическая проверка кейса "на завтра есть окошко?"**:
  - теперь, если хоть один мастер имеет расписание и свободный слот на запрошенную дату:
    - `working_hours_count > 0`,
    - deterministic слой не будет возвращать "В этот день мы не работаем",
    - вместо этого либо:
      - предложит слоты на этот день,
      - либо предложит ближайшие альтернативы, если слоты заняты.

