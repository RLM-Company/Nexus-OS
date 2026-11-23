# DELIVERY — PR #620 retry recovery

- **База:** PR head `0f4819defc543002f9a54e5d269cd81dcc3219b6`.
- **Ветка:** `team/file-analysis-retry-ui`. **PR:** обновляется, без merge.
- **Исполнитель:** DeepSeek Harness.

## Воспроизведённые браузерные сбои (CI run 45018265623)

1. `document-answer-retry.spec.ts:83` — `locator.click` timeout на втором force-клике:
   после первого клика источник заменялся готовым ответом, кнопка исчезала,
   двойной клик не проверялся.
2. `:117` — потеря ответа повтора: `toHaveText("Ответ сохранён")` timeout
   (15 s), приложение не находило созданную сервером задачу.
3. `:143` — отменённый запуск: повтор не доводился до отчёта.

## Корень и минимальное обратно совместимое изменение контракта

UI уже писал `x-kosmora-retry-id`, но сервер его игнорировал, а восстановление
искало задачу **по тексту вопроса** — одинаковый вопрос в разных запусках
давал неверную связь. Добавлено:

- миграция `0071_document_answer_retry_link.sql`: nullable `retry_of`,
  `retry_request_id` + индекс `(owner_id, retry_request_id)`;
- `DocumentAnswer` получает опциональные поля, старые строки → `null`;
- `POST /answers/:id/retry` принимает **необязательный** `retry_request_id`
  в JSON-теле (предпочтительно) или заголовке `x-kosmora-retry-id` (старые
  клиенты). Нет тела → валидация не применяется, сервер сам генерирует
  `server:<uuid>`; cool: старые клиенты получают связь автоматически;
- новый `GET /answers/retry/:requestId` (объявлён до `/:id`) возвращает
  именно задачу, созданную этим повтором, в скоупе проекта и владельца.
  Ответ 404 → клиент делает fallback GET истории и ищет точное совпадение
  `retry_request_id`, но **никогда** не POSTит повтор повторно.

Связь: `исходный запуск (id) → retry_request_id (клиент или сервер) →
созданная сервером задача (retry_of = исходный id)`.

## Исправления UI

- `retryAnswer()` — `useRef` in-flight guard (двойной клик не создаёт второй POST);
  источник остаётся выбранным пока `retryPending`, поэтому кнопка видна и
  вторая попытка клика перехватывается;
- POST теперь шлёт JSON `{ retry_request_id }` с `content-type: application/json`;
- после потери ответа сначала GET `/answers/retry/:requestId`, затем fallback
  по истории с точным `retry_request_id`, только затем явный повтор;
- `AnswerReport` расширен опциональными полями.

## Правило публикации

Не изменено: неполное покрытие по-прежнему не публикует результат как
`done`; исходная попытка остаётся в истории с `INCOMPLETE_COVERAGE` и
перечнем пропусков; новый отчёт публикуется только после успешного повтора.

## Проверки

```
packages/db document-answer-retry-link.test.ts   1 passed (один вопрос, 2 повтора, 2 проекта/owner)
apps/api    document-answer-http.test.ts         2 passed (старый клиент без тела → server:-link, GET retry/:id)
apps/api    document-answer-service.test.ts      3 passed
 typecheck db/api/web · lint · prettier · check-secrets — green
```

Браузерные сценарии (3) будут подтверждены в CI на обновлённом PR.
