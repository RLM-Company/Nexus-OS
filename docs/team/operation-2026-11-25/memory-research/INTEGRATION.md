# INTEGRATION — координация с OpenCode №1

- Общие контракты `packages/contracts`, `app.ts`, `server.ts`, миграции, gateway,
  тарифы, права, UI и VPS в этом срезе **не меняются**.
- Срез #667: `packages/core/src/research/index.ts` (чистые функции), тесты в
  `packages/core/test` / `packages/db/test`.
- Продолжение: `ResearchRun.receipts` добавлен в `packages/core/src/research/index.ts`
  как необязательное поле; `ResearchCoordinator`Fill записывает квитанции в тот же
  момент, что и `answer`; `ResearchStore` сериализует payload как есть — новый
  пользовательский запуск Research возвращает квитанции без join.

## Единый формат ссылки (согласование с OpenCode №1)

`kosmora.source-receipt.v1` — поля:
`claim`, `source_id`, `excerpt_id`, `title`, `url`, `checked_at`,
`content_digest`, `excerpt_sha256`, `position`, `quote`.

- `quote` — данные из доверенного снимка, а не доказательство истинности.
- Старые citations `{source_id, excerpt_id}` остаются входным форматом; квитанции
  — производный вывод, старых клиентов не ломают.
- Неизвестный `S:E` или непрочитанный источник квитанции не даёт.

## Отзыв доступа / исключение источника

- Пользовательский отзыв: `ContextMemoryStore.forget(entryId, version, owner)` —
  производная запись и версии удаляются, **оригинальные исходные сообщения не
  удаляются** (`original_messages_deleted: false`); повторноеCompletion не должен
  воскрешать квитанцию.
- Следующая задача после отзыва получает `answer_evidence: "absent"` и не содержит
  текста исключённого источника.
- История версий до отзыва сохраняется как прошлое состояние памяти, но не
  используется как активный ответ.

Если интегратор выберет другое имя формата или порядок полей —变更 локализован в
чистом модуле `researchSourceReceipts()`, без изменения research runtime.
