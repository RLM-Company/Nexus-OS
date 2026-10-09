# Kosmora — блок 22, отдельная итерация owner privacy coordinator

**Точная база:** tracked source `b15912d23ab15a99e38370e22e472faf28c99961` + уже переданный пакет `kosmora-b20-22-changed-files.zip` (проверить контрольные суммы из отчёта). Этот патч **добавляется к** пакету блоков 20–22, не заменяет его. Не устанавливает пакеты, не тратит токены провайдера, не затрагивает VPS или GitHub. Центральные файлы выделены в `*-integration.patch`, изменения собственных модулей — в `*-isolated.patch`.

## Статус

- **Реализовано локально:** `OwnerPrivacyCoordinator`, строгий registry обязательных адаптеров, одноразовое подтверждение, owner-epoch lifecycle (`active`/`quiescing`/`deleting`/`deleted`/`error`), асинхронный drain, запрет новых записей, fail-closed on unknown stores, snapshot/preview/export, подробный JSON и аутентифицированный same-origin URL на каждый перечисленный оригинал, отказ при недоступном бинарнике/неполноте/лимите 20 МБ, отчёт deletion per store, запрет повторного старого удаления.
- **Реализовано для исходных store:** `AccountCorePrivacyAdapter` с существующими chat/project/messages/runs/materials/GitHub drafts/prefs, summary legacy usage+retained, translation entries/holds без обнуления. SQLite триггеры `0030` сохраняют canonical usage **перед каскадом** при удалении родительского чата/проекта и при прямом удалении строки canonical usage. Перенос сохраняет статусы, лимиты верхней границы, reported tokens, provider/model, currency/amount. Двойного подсчёта между live и retained нет: миграция переносит строки только при удалении.
- **Проверено локально:** 10 Node тестов на реальных SQLite миграциях (с включёнными FK), отдельно исходные 0000–0024 + предыдущие settings tables + 0030. Сценарии: обязательные store; owner isolation; full binary manifest; incomplete/oversized export; удержание canonical usage/uncertain holds; обычный cascade; fail-closed quiesce; fail-closed partial delete; concurrent quiesce and late INSERT; reserved uncertain upper bound. Само API приложение с Fastify/Next и production DB не тестировалось.

## Обязательный контракт внешних адаптеров

Файл `apps/api/src/account-settings/privacy/coordinator.ts` содержит `PrivacyAdapter`:

```ts
interface PrivacyAdapter {
  readonly id: string; // уникальный фиксированный идентификатор
  quiesce(ownerId: string, epoch: number): Promise<{drained:true; fence_epoch:number}>;
  export(ownerId: string): Promise<{
    records: Record<string, unknown[]>; // все owned metadata+text
    originals: {id:string; filename:string; content_type:string; size_bytes:number; sha256:string}[];
    complete: boolean;
    limitations?: string[];
  }>;
  delete(ownerId: string, epoch: number): Promise<{deleted_records:number}>;
  readBinary?(ownerId: string, opaqueId: string): Promise<BinaryStream|null>;
}
```

`quiesce` **обязательно** останавливает новые owner-задания, отменяет уже выполняемые, дожидается callbacks и запрещает поздние записи, проверяя общий durable `epoch` непосредственно перед commit, после async-паузы. Только затем возвращает `drained:true` и равный `fence_epoch`. Не возвращать фиктивный receipt. При отказе или ошибке coordinator оставляет владельца в `error` и НЕ возвращает `deleted:true`. Восстановление `error` — отдельная ручная операторская процедура после проверки всех storage; автоматического un-fence нет. Асинхронная внешняя запись без проверки fence **не соответствует** контракту.

`export` возвращает все metadata/text и манифест **всех реально сохранённых бинарных оригиналов**, не пути к файлам и не открытые внешние ссылки. `complete:true` допустимо только после полной инвентаризации и проверки, что каждый original доступен из `readBinary(ownerId,id)` после аутентификации пользователя. Не выдавать секреты аутентификации, PAT, модели или провайдера. Если original недоступен или перечисление неполное — `complete:false` или ошибка; coordinator **не создаёт** частичный файл. Ссылки имеют вид `/api/v1/personal-settings/binaries/<store>/<opaque-key>` и требуют тот же авторизованный owner-сеанс; метод `readBinary` обязан повторно разрешать owner/id и не возвращать сторонний файл по чужому id. Не использовать `file:`, `data:`, внешние URL. Существующие старые чат-вложения содержат только сохранённую информацию; оригиналов, никогда не сохранённых прежним продуктом, этот патч не создаёт.

`delete` идемпотентен в рамках своей области, не трогает authentication/provider secrets/system audit/canonical usage/uncertain holds, не удаляет чужие записи, очищает объектные оригиналы. Если deletion partial, возвращает ошибку. Включить реальный source of truth, не пустой заглушечный адаптер ради разблокировки кнопки.

**Обязательные ID**: `account-core` (реально реализован), `documents` (библиотека 0025 и originals), `work` (0026 плюс memory/artifacts), `research` (0028), `media`, `code`, `agent-studio` (действующие legacy agent objects) и `policy-projects` (project policy state; системный audit сохраняется). До подключения всех восьми **экспорт и удаление заблокированы** (503/409) и UI явно отображает отсутствующие модули. Для иных новых store следует расширить `required` при создании coordinator, не оставлять их вне реестра. Перед привязкой убедиться, что `code` приостанавливает running executors, а `media` отменяет jobs и блокирует late artifacts. Core удаляется строго после остальных.

## Интеграция в главном checkout

1. Наложить пакет на уже интегрированные **блоки 20–22**. Применить `isolated.patch`, затем `integration.patch` **с ручным переносом маленьких hunks** в текущие общие файлы. Не заменять `app.ts`, `server.ts`, фоновые coordinators, `page.tsx` целиком: в основной копии уже исправлены double count global/project ledger и квота перед ProjectChat-dispatch. Никакого перезаписывания этих исправлений. В `server.ts` удалён `accountStore.migrate()`: таблицы настроек предоставляет уже выделенная управляемая миграция 0027.
2. Перенести SQL `packages/db/migrations/0030_owner_privacy_lifecycle.sql` в обычный migration pipeline. Запись `idx:30,when:1791580800005,tag:0030_owner_privacy_lifecycle` добавить в **фактический** `packages/db/migrations/meta/_journal.json` ПОСЛЕ интеграции 0025..0029. В доставленном integration patch запись добавлена относительно старого 0024 — для живой базы не заменять уже существующий journal. Дальше только `pnpm ... db:migrate`/штатный `runMigrations`, не runtime DDL.
3. В `server.ts` создать `ownerPrivacy`, зарегистрировать `new AccountCorePrivacyAdapter(sqlite,async owner=>...)` c `quiesceOwner` для обычных чатов и Manager. Сами `quiesceOwner` добавлены минимально в оба coordinators и abort/join только owner-inflight. `work`/`documents`/`media`/`research`/`code`/`agent-studio`/`policy-projects` предоставить из соответствующих веток. Убедиться, что они блокируют новые и late writes при смене эпохи. Передать `ownerPrivacy` в `buildApp` и `registerPrivacyRoutes` из нового модуля.
4. Прямой старый endpoint `AccountStore.deleteData` больше не удаляет данные, а кидает ошибку, старые `/export`, `/delete` и `/delete-challenge` удалены из предыдущего `account-settings/routes.ts` и заменены coordinator routes. Сверить, что в итоговом приложении эти пути зарегистрированы **ровно один раз**.
5. Провести TypeScript lint/build, Browser/UI E2E, Android/Windows если требуется, API auth check, real store adapter inventory, multipart/binary-large link/hash validation, lifecycle across restart and cancel/late write race on integrated modules, project and global quota tests, trial SQLite snapshot then production migration only по решению главного чата. Текущий пакет **не** выполнял платных вызовов, PR/deploy.

## Ограничения и операции

- JSON экспорт формируется полностью до начала отдачи; лимит 20 МиБ — **явный 413** без усечения. Сегментированный экспорт не реализован. Ссылки на оригиналы аутентифицированы, не одноразовые и не являются pre-signed ссылками; adapter обязан обеспечивать длительность жизни и owner-scoped чтение. Связанный файл может стать недоступным после самостоятельного удаления пользователем; контракт требует immutable `opaqueId`+digest.
- Превью снимка и экспорт останавливают текущие пользовательские действия ради консистентности. При snapshot error write-fence снимается; при destructive partial deletion **не** снимается.
- Для старых данных, где исходный PDF/DOCX вообще никогда не сохранялся, экспортируется сохранённый extracted text/metadata, не обещается несуществующий оригинал. Существующие image attachments с `data_base64` включены в манифест и скачиваются после owner-проверки. Никакой ручной/автоматической реконструкции вложений.
- Текущие счётчики используют верхнюю границу для failed/uncertain попыток. Pricing «unknown», никаких фальшивых денег. Retained usage должна быть согласована с уже объединёнными global/project ledger и ownerBudget у интегратора; в этом source пакет не меняет их dispatch, модели/провайдеры, English Relay OFF по умолчанию, два translation-этапа продолжают учитываться.
- Полная типизация monorepo, Next build и E2E непроверены: в архиве отсутствует `node_modules`; npm registry в данном окружении недоступен. Проверены TypeScript/TSX parse, SQLite/Node детерминированные тесты.
