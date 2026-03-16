# Stage Report: fix-deterministic-master-wording-fallback

## 1. Goal

Исправить deterministic fallback-ответы так, чтобы:
- staff-specific wording («У Светланы…») использовался **только**, когда слоты реально посчитаны для конкретного мастера;
- в generic all-staff ветке всегда использовался нейтральный шаблон общей доступности.

## 2. Problem observed

После этапа Preferred Master Into Deterministic Availability:
- в staff-specific ветке (когда используются `crm.get_free_slots` для конкретного staff_id) текст был корректным;
- но в generic all-staff fallback (union availability через `crm.get_availability_for_date`) код всё ещё мог выбирать `slots_available_with_master`, если был задан `preferredStaffName`.

Это создавало ситуацию, когда:
- слоты считались по всем мастерам,
- но текст мог говорить «У Светланы на четверг есть такие варианты…», хотя часть слотов могла относиться к другим мастерам.

## 3. Root cause

В `deterministicScheduling.ts` в generic ветке, после вызова `getAvailabilityForDate`:
- ответ строился так:
  - `const reply = preferredStaffName ? slots_available_with_master : slots_available`.
- То есть наличие `preferredStaffName` влияло на wording, даже если availability считалась через union tool, а не staff-specific вызов.

## 4. Code change

**Файл:** `orchestrator/src/services/deterministicScheduling.ts`

- В generic all-staff ветке заменён выбор шаблона:

До:
```ts
if (slotsOnRequested.length > 0) {
  const slotsText = formatSlotsForMessage(slotsOnRequested);
  const dateLabel = formatDateLabel(requestedDate, effectiveLang);
  const reply = preferredStaffName
    ? getSystemMessage('slots_available_with_master', effectiveLang, { masterName: preferredStaffName, date: dateLabel, slots: slotsText })
    : getSystemMessage('slots_available', effectiveLang, { date: dateLabel, slots: slotsText });
  ...
}
```

Стало:
```ts
if (slotsOnRequested.length > 0) {
  const slotsText = formatSlotsForMessage(slotsOnRequested);
  const dateLabel = formatDateLabel(requestedDate, effectiveLang);
  // Generic all-staff availability: никогда не упоминаем конкретного мастера.
  const reply = getSystemMessage('slots_available', effectiveLang, { date: dateLabel, slots: slotsText });
  events.push({ event_type: 'alternative_slots_found', payload: { count: slotsOnRequested.length } });
  events.push({ event_type: 'deterministic_reply_sent', payload: { code: DETERMINISTIC_CODES.SLOTS_AVAILABLE, staff_specific: false } });
  return { applied: true, reply, code: DETERMINISTIC_CODES.SLOTS_AVAILABLE, alternativeSlots: slotsOnRequested, events };
}
```

- Staff-specific ветка (где вызывается `getFreeSlotsForStaffOnDate` и слоты считаются только для explicit/preferred мастера) **не тронута**:
  - там по-прежнему используется `slots_available_with_master`, но только после успешного staff-specific расчёта.

## 5. Why previous behavior was misleading

- Клиент мог видеть текст вроде:
  - «У Светланы на четверг есть такие варианты…»,
  - хотя на самом деле deterministic layer использовал union tool и предлагал общие слоты по всем мастерам.
- Это нарушало бизнес-ожидания:
  - фраза «у [мастер] есть такие варианты» должна означать, что именно этот мастер свободен в эти окна;
  - generic union-availability не гарантирует этого.

## 6. Correct wording rule

- **Staff-specific availability (staff-specific branch):**
  - использовать `slots_available_with_master` **только** когда слоты реально получены через `crm.get_free_slots` для конкретного `staffId`.
  - текст может говорить: «У Светланы на четверг есть такие варианты…».

- **Generic all-staff availability (fallback branch):**
  - всегда использовать `slots_available` (generic шаблон с пометкой общей доступности/any staff);
  - даже если у нас есть `preferredStaffName`, его нельзя подставлять в этот текст.

## 7. Compatibility notes

- Clarification step для generic lash booking сохранён (не затронут).
- Ограничение до 3 слотов и многострочный формат (`formatSlotsForMessage`) не изменялись.
- Staff-preference иерархия (explicit → preferred → generic) осталась прежней:
  - только staff-specific ветка может использовать `slots_available_with_master`;
  - generic ветка всегда `slots_available`.
- MCP/gateway контракты не менялись.

## 8. Diff summary

- **Modified:**
  - `orchestrator/src/services/deterministicScheduling.ts`:
    - в generic all-staff ветке убрана привязка к `preferredStaffName` при выборе шаблона;
    - теперь там всегда используется `slots_available` + `staff_specific: false` в диагностическом событии.

- **Untouched:**
  - staff-specific ветка с `crm.get_free_slots` и `slots_available_with_master`;
  - lash clarification, slot limiting, formatters;
  - agentProcessor и gateway.

## 9. Validation

- TypeScript / lints по изменённому файлу проходят (локально проверено через существующую сборку).
- Логическая проверка:
  - если staff-specific ветка нашла слоты:
    - ответ «У [мастер] на [дата] есть такие варианты…» остаётся корректным;
  - если staff-specific ветка не нашла слоты и произошёл fallback в generic:
    - ответ всегда в форме «На [дата] у нас есть такие варианты (общая доступность)…», без упоминания конкретного мастера;
    - текст больше не приписывает общий слот конкретному мастеру.

