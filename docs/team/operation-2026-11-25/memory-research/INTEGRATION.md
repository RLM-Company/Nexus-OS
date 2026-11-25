# INTEGRATION — координация с OpenCode №1

- Общие контракты `packages/contracts`, `app.ts`, `server.ts`, миграции, gateway,
  тарифы, права, UI и VPS в этом срезе **не менялись**.
- Изменён только `packages/core/src/research/index.ts` (чистые функции) и добавлены
  тесты в `packages/core/test` / `packages/db/test`.
- Формат квитанции источника, предлагаемый для согласования с OpenCode №1:
  `kosmora.source-receipt.v1` — поля `claim`, `source_id`, `excerpt_id`, `title`,
  `url`, `checked_at`, `content_digest`, `excerpt_sha256`, `position`, `quote`.
  `quote` — данные из доверенного снимка, а не доказательство истинности.
- Старый формат citations `{source_id, excerpt_id}` остаётся входным; квитанции
  являются производным выводом и ломают старых клиентов.
- Если интегратор выберет другое имя формата или порядок полей, adaptable в одном
  чистом модуле без изменения research runtime.
