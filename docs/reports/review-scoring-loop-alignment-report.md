# Stage Report: review-scoring-loop-alignment

## 1. Goal

Сделать human review / scoring loop более осмысленным и привязанным к фактическому решению агента:
- чтобы при создании/просмотре review было понятно, какое решение (DecisionObject) оценивается,
- использовать уже существующие decision snapshots и admin-ui,
- не ломая существующий review storage и UI.

## 2. Scope

В этом этапе:
- использованы уже реализованные decision snapshots (`decision_object_enriched`) и их отображение в admin-ui,
- улучшена страница добавления review (`review-add.ejs`), чтобы она была лучше привязана к decision контексту,
- сам review storage (таблицы, backend-роуты) не менялся.

Не делалось:
- redesign admin-ui,
- изменение полей `conversation_reviews` или `conversation_review_tags`,
- изменение orchestrator/gateway/wa contracts.

## 3. Current review flow findings

До этапа:
- **Создание review**:
  - Страница `/reviews/add` (`review-add.ejs`) содержала форму:
    - `conversation_id`,
    - `reviewer_type`,
    - `score_overall`,
    - `comment`,
    - `tags` (через запятую).
  - Не было никакого отображения decision контекста или snapshot-а; ревьюер ориентировался только по `conversation_id`.
- **Хранение review**:
  - Таблицы:
    - `conversation_reviews` (основная оценка и comment),
    - `conversation_review_tags` (теги: `wrong_language`, `good_sales`, и т.п.).
  - Уже позволяли хранить качественные/количественные оценки, но без прямой ссылки на конкретное decision-состояние.
- **Отображение review**:
  - Страница `/reviews` (`reviews.ejs`) показывала:
    - `id`, `conversation_id` (ссылкой на `/events/:conversationId`),
    - `reviewer_type`,
    - `score_overall`,
    - укороченный `comment`,
    - `tags`,
    - `created_at`.
  - Уже была косвенная связь review → события через ссылку на events, но не было явно подсказано, что там есть decision snapshot.
- **Чего не хватало**:
  - при создании review ревьюер не видел контекст DecisionObject,
  - не было явного guidance, где смотреть scenario/outcome/specialists/writer/QA при выставлении оценки.

## 4. Files reviewed

- `admin-ui/views/review-add.ejs`
- `admin-ui/views/reviews.ejs`
- `admin-ui/views/events.ejs` (где уже показывается decision snapshot)
- `admin-ui/server.js` (routes для reviews и events)
- ранее созданные отчёты по DecisionObject enrichment/persistence и admin-ui observability.

## 5. Alignment approach

Выбран максимально лёгкий и безопасный путь:
- не добавлять новые поля в review storage,
- не изменять backend-роуты `/reviews` и `/reviews/create`,
- использовать уже существующую связку `conversation_id` → `/events/:conversationId`, где теперь отображается enriched decision snapshot,
- улучшить UI формы добавления review, чтобы ревьюер:
  - явно видел, с какой беседой и context он работает,
  - имел быстрый путь перейти к decision snapshot перед выставлением оценки.

Причины:
- минимальное вмешательство,
- reuse уже реализованного diagnostics блока на `/events/:conversationId`,
- возможность в дальнейшем углубить alignment (например, добавив auto-подсказки для тегов) без ломки storage.

## 6. Data flow / UI changes

Основное изменение: файл `admin-ui/views/review-add.ejs`.

- **До**:
  - одна `card` с формой:
    - поля `conversation_id`, `reviewer_type`, `score_overall`, `comment`, `tags`,
    - кнопки "Создать оценку" и "Отмена".
  - Никакого упоминания decision snapshot.

- **После**:
  - Структура разделена на two-column layout (`grid-2`):
    - Левая колонка:
      - та же форма создания review (поля не изменены).
    - Правая колонка (условно, если `conversationId` известен):
      - новый diagnostics card:
        - заголовок: "Decision snapshot для беседы".
        - кнопка: "Открыть все события" → ссылка на `/events/:conversationId` (в новой вкладке).
        - текстовая подсказка:
          - объясняет, что на странице событий ревьюер может увидеть:
            - scenario,
            - policy,
            - specialists,
            - outcome,
            - writer/QA,
          - и что после сохранения оценки можно вернуться к событиям через список reviews.

Таким образом:
- review creation UI теперь явно подсказывает:
  - куда смотреть, чтобы видеть DecisionObject context,
  - что review привязан к `conversation_id`, для которого уже есть diagnostics.

Фактический data flow review:
- остаётся:
  - `conversation_id` → хранение в `conversation_reviews`,
  - через `/events/:conversationId` ревьюер получает enriched DecisionObject,
  - через теги/score/комментарий ревьюер фиксирует своё мнение о качестве этого решения.

## 7. Compatibility notes

- Backend:
  - маршруты `/reviews`, `/reviews/add`, `/reviews/create` не менялись,
  - структура POST-формы осталась прежней.
- UI:
  - старая форма просто обёрнута в `grid-2` и дополнена правой колонкой.
  - если `conversationId` не передан (открытие `/reviews/add` без параметров):
    - diagnostics card не рендерится, форма работает как раньше.
  - никаких зависимостей от `decision_object_enriched` напрямую в `review-add.ejs` нет (только ссылка на `/events/:conversationId`).

Следовательно:
- существующий review flow не ломается,
- для уже существующих сценариев использования форма остаётся работоспособной,
- новые подсказки лишь направляют ревьюера на уже существующую diagnostics страницу.

## 8. Risks / open questions

- Возможный риск:
  - ревьюер может не перейти на `/events/:conversationId` и всё равно сделать поверхностный review.
  - но это организационный, а не технический риск; UI теперь явно подсказывает правильный путь.
- Открытые вопросы:
  - нужно ли в будущем:
    - автоматически подтягивать короткий summary decision snapshot прямо на форму review (без перехода),
    - добавлять шаблоны тегов, завязанные на specialist/QA issues (например, "unsafe_confirmation", "language_mismatch").

## 9. Next recommended step

- В дальнейшем можно:
  - добавить на `/reviews` (list view) mini-context по последнему snapshot-у для каждой беседы (например, intent/scenario/outcome),
  - автоматически предзаполнять suggested tags на основе QA issues / specialists (e.g., `wrong_language`, `unsafe_confirmation`),
  - расширить review типами, отражающими уровень доверия к автодействиям агента.

## 10. Diff summary

- **added**
  - `docs/reports/review-scoring-loop-alignment-report.md`
- **modified**
  - `admin-ui/views/review-add.ejs` — добавлен правый diagnostics блок с ссылкой на events/decision snapshot, форма обёрнута в `grid-2`.
- **untouched**
  - backend-роуты review (`server.js`),
  - таблицы `conversation_reviews`, `conversation_review_tags`,
  - `events.ejs` decision snapshot rendering (используется как есть),
  - orchestrator/gateway/wa-service контракты.

## 11. Validation

- EJS-шаблон `review-add.ejs`:
  - валиден, линтер ошибок не показал,
  - при наличии `conversationId` diagnostics блок корректно рендерится,
  - при отсутствии `conversationId` diagnostics блок пропускается.
- Review flow:
  - тестовая отправка формы с `conversation_id`, `score_overall`, `comment`, `tags` по-прежнему приводит к созданию записи в `conversation_reviews` и `conversation_review_tags`,
  - навигация к `/events/:conversationId` открывает страницу с decision snapshot (realized на предыдущем этапе).

## Appendix: Example review context block

Пример того, как review теперь видит decision context:

- Открывая `/reviews/add?conversationId=abc-123`, ревьюер видит:
  - слева:
    - форму ввода `conversation_id = abc-123`,
    - поля для `score_overall`, `comment`, `tags`.
  - справа:
    - заголовок "Decision snapshot для беседы",
    - кнопку "Открыть все события", ведущую на `/events/abc-123`,
    - текст: "Чтобы увидеть подробный decision snapshot (scenario, policy, specialists, outcome, writer/QA), откройте страницу событий для этой беседы...".
- Переходя по ссылке, на странице событий ревьюер видит:
  - компактный блок с:
    - Scenario, Policy, Specialists, Outcome, Reply/Handoff, Writer/QA,
  - и при желании raw JSON в collapsible блоке.
- После ознакомления с этим контекстом ревьюер возвращается на форму и заполняет оценку/комментарий/теги уже в привязке к конкретному решению агента.

