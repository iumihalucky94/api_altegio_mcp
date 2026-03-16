# Stage Report: fix-generic-lash-booking-dialog-logic-real-implementation

## 1. Goal

Изменить runtime-поведение для generic lash booking: сначала уточнение типа услуги (коррекция / новое наращивание), не более 3 слотов в ответе, многострочный читаемый формат, по возможности указание мастера или явная формулировка «общая доступность», при наличии preferred master — прокидывание его в deterministic layer для ответа со слотами.

## 2. Scope

- `orchestrator/src/services/deterministicScheduling.ts` — clarification step, ограничение слотов, формат ответа, параметр preferredStaffName.
- `orchestrator/src/services/localization.ts` — ключ `lash_service_clarification`, многострочный `slots_available`, явная «общая доступность», ключ `slots_available_with_master`.
- `orchestrator/src/services/agentProcessor.ts` — вычисление preferredStaffName из appointments + staff и передача в `tryDeterministicSchedulingReply`.

## 3. What was actually implemented

- **Clarification step:** при generic lash-запросе без явного типа услуги deterministic layer возвращает ответ по ключу `lash_service_clarification` и не вызывает `get_availability_for_date`, не показывает слоты.
- **Slot limiting:** `formatSlotsForMessage(slots, maxItems = 3)` — по умолчанию 3 слота, вывод времени построчно через `\n`.
- **Reply formatting:** `slots_available` — многострочный текст с `\n{{slots}}\n\n` и явной пометкой «общая доступность» (RU) / «any available staff» (EN) / «bei einem unserer Team-Mitglieder» (DE). Добавлен ключ `slots_available_with_master` для ответа с именем мастера.
- **Preferred master в deterministic:** в `tryDeterministicSchedulingReply` добавлен опциональный параметр `preferredStaffName`. При показе слотов, если он передан, используется шаблон `slots_available_with_master` («У {{masterName}} на {{date}}…»).
- **Preferred master в agentProcessor:** перед вызовом `tryDeterministicSchedulingReply` по первому предстоящему визиту и списку staff вычисляется `preferredStaffName` (матч по имени мастера) и передаётся в deterministic layer.

## 4. Files changed

| File | Changes |
|------|---------|
| `orchestrator/src/services/deterministicScheduling.ts` | Clarification branch (isGenericLashBooking, hasExplicitServiceType), DETERMINISTIC_CODES.SERVICE_TYPE_CLARIFICATION, formatSlotsForMessage(maxItems=3, join('\n')), параметр preferredStaffName, выбор slots_available vs slots_available_with_master. |
| `orchestrator/src/services/localization.ts` | Ключ `lash_service_clarification` (DE/RU/EN), многострочный `slots_available` с пометкой общей доступности, ключ `slots_available_with_master` (DE/RU/EN). |
| `orchestrator/src/services/agentProcessor.ts` | Вычисление `preferredStaffName` из appointments[0].master + staff, передача `preferredStaffName` в `tryDeterministicSchedulingReply`. Сохранена логика preferred master для free_slots (после deterministic) для AI-path. |

## 5. Clarification logic implementation

- **Где:** `deterministicScheduling.ts`, в начале `tryDeterministicSchedulingReply` после вычисления `requestedDate` и добавления события `relative_date_resolved`.
- **Условие:** `isGenericLashBooking(batchText) && !hasExplicitServiceType(batchText)`.
- **Поведение:** вызывается `getSystemMessage('lash_service_clarification', effectiveLang)`, в events добавляется `deterministic_reply_sent` с кодом `SERVICE_TYPE_CLARIFICATION`, возвращается `{ applied: true, reply, code: SERVICE_TYPE_CLARIFICATION, alternativeSlots: [], events }`. Вызовов `getAvailabilityForDate` и построения ответа со слотами не происходит.
- **Эвристики:** lash — по словам реснич|ресниц|wimpern|lashes?|lash; явный тип услуги — коррекц|refill|auffüllung|full set|neues set|new set|полное наращивани|новое наращивани (и варианты).

## 6. Preferred master implementation

- **В agentProcessor:** до вызова `tryDeterministicSchedulingReply` по `appointments[0].master` (строка) ищем в `staff` запись, у которой `(s.name ?? '').toLowerCase().includes(masterName)`; при совпадении берём `matched.name` как `preferredStaffName`.
- **В deterministic:** в параметрах `tryDeterministicSchedulingReply` добавлен опциональный `preferredStaffName?: string`. При формировании ответа SLOTS_AVAILABLE: если `preferredStaffName` задан, используется ключ `slots_available_with_master` с подстановкой `masterName`, иначе — `slots_available` (общая доступность). Сам поиск слотов по-прежнему выполняется через `get_availability_for_date` (gateway сам выбирает staff); в ответе клиенту лишь подставляется имя предпочитаемого мастера, если оно известно.

## 7. Slot limiting implementation

- **Функция:** `formatSlotsForMessage(slots: string[], maxItems: number = 3): string`.
- **Логика:** `slots.slice(0, maxItems)`, каждый слот форматируется как время `toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })`, результат объединяется через `'\n'`.
- **Использование:** при построении ответов SLOTS_AVAILABLE и WORKING_TIME_VIOLATION слоты передаются через `formatSlotsForMessage(slots)` без второго аргумента, т.е. всегда максимум 3 слота и многострочный вывод.

## 8. Reply formatting implementation

- **slots_available:** шаблоны с переносами строк, подстановка `{{date}}` и `{{slots}}`; в тексте явно указано, что это общая доступность / любой мастер (DE: «bei einem unserer Team-Mitglieder», RU: «общая доступность», EN: «any available staff»).
- **slots_available_with_master:** шаблоны «У {{masterName}} на {{date}}…» (RU), «Bei {{masterName}} am {{date}}…» (DE), «With {{masterName}} on {{date}}…» (EN), слоты и вопрос в том же многострочном формате.
- **lash_service_clarification:** один вопрос по языку с просьбой уточнить: коррекция или новое наращивание (refill/full set и аналоги на DE/RU).

## 9. Compatibility notes

- Контракты MCP и gateway не менялись. Определение даты, вызов `get_availability_for_date` и коды событий остаются прежними.
- Если в репозитории не было ключа `lash_service_clarification` или многострочного `slots_available`, после изменений они присутствуют; старые ключи не удалялись.
- Preferred master в deterministic — только подстановка имени в текст ответа; при отсутствии `preferredStaffName` используется прежний шаблон с пометкой общей доступности.

## 10. Risks / open questions

- Матчинг мастера по подстроке имени может дать ложное совпадение при коротких или повторяющихся именах.
- Эвристики lash/explicit service type могут не покрыть все формулировки; при необходимости можно расширить регулярные выражения.
- Gateway по-прежнему сам выбирает staff для `get_availability_for_date`; «preferred» в ответе — только текстовая подсказка для клиента, а не гарантия, что слоты именно у этого мастера (для строгой привязки нужны изменения в gateway).

## 11. Diff summary

- **Added:** DETERMINISTIC_CODES.SERVICE_TYPE_CLARIFICATION, функции isGenericLashBooking, hasExplicitServiceType, блок clarification в tryDeterministicSchedulingReply, параметр preferredStaffName, ключи lash_service_clarification и slots_available_with_master, вычисление preferredStaffName в agentProcessor и передача в tryDeterministicSchedulingReply.
- **Modified:** formatSlotsForMessage — default maxItems 3, join('\n'); slots_available — многострочный формат и формулировка «общая доступность»; выбор шаблона при SLOTS_AVAILABLE в зависимости от preferredStaffName.
- **Untouched:** логика free_slots и preferred staff в agentProcessor для пути после deterministic (AI path), контракты gateway/MCP, остальные ключи локализации.

## 12. Validation

- Сборка: `npm run build` в orchestrator выполняется без ошибок (проверено через Docker).
- Ожидаемое поведение для «привет, нужна запись на реснички, на завтра есть окошко?»: deterministic layer распознаёт generic lash без явного типа услуги, возвращает только уточняющий вопрос (lash_service_clarification), слоты не запрашиваются и не показываются.
- После уточнения типа услуги (или при не-lash запросе) при наличии слотов ответ содержит не более 3 вариантов времени построчно; при известном preferred master в ответе указывается имя мастера, иначе — общая доступность.

## Appendix: Example before/after behavior

**До:** для «нужна запись на реснички, на завтра есть окошко?» deterministic мог сразу запрашивать availability и отдавать длинный список слотов без уточнения типа услуги и без ограничения по количеству.

**После:** для того же сообщения возвращается только уточняющий вопрос (например, RU: «Чтобы подобрать вам подходящее время на ресницы, подскажите, пожалуйста: вам нужна коррекция или новое наращивание?»). Слоты при последующих ответах (или при не-lash запросе) — не более 3, многострочно; при известном мастере из предстоящих записей — «У [имя] на [дата]…», иначе — «На [дата] есть такие варианты (общая доступность): …».
