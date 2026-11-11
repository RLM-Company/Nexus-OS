# Coscode: точная точка завершения

11 ноября 2026, Москва. Максимальный статус исполнителя — **готово к интеграции**.
Ветка `ops/developer-coscode`, Draft PR https://github.com/RLM-Company/Nexus-OS/pull/519.
Code HEAD3936e5f7ebe7abe7780e82debaac71a15743710f,
code tree9e4fd6b0382e12c789027b68862aeb42498c98f3 (local/GitHub equality).
BASE текущего среза be85aef8b394a8a6489239def4399dfd59595a19 сохраняет main
abbcee7eab47d7e8ded86a0cfb1567a133b3a76a. Финальный main026b0df сохранён merge7900ce6 (только Windows/download OpenCode,
без изменений Coscode/API/contracts); итоговые format/secrets/diff проверены отдельно.
Самоссылка docs SHA не создаётся;
финальный docs HEAD доступен в истории ветки/PR и в сообщении сдачи.

## Согласованный путь реализован

Repo/task/issue → bounded context/search/read immutable SHA → exact proposal/diff →
review CAS/checkpoint → текущий sandbox → строгий proof → owner-approved draft PR.
Новое: failed check → отдельное разрешение одной модели → exact working-byte edits,
сохраняющие owner changes → новый diff → та же настоящая проверка → новый review.
Новый endpoint только после repair_once capability. Stable request UUID записан до
модели, replay/второй UUID/restart/unknown не дают вторую генерацию. Старый draft
остаётся при отказе; при принятии нового proposal старые proof/token отделены
атомарно. Источник ошибки/review/digest сохранён. Tool-only revoke race закрыт внутри
guarded callback с сохранением фактического usage. Нового runtime/хранилища нет.

## Проверено

- Scoped API/GitHub/tree115PASS+1opt-inSKIP, exit0.
- Настоящий OCI API/Git repair1PASS: failed1→passed0, cleanup true, exact patch2files,
  owner00123/README сохранены, fresh review обязателен. Внешние model/GitHub fixtures.
- Core exit0: API1029/web290 fresh; остальные неизменённые пакеты cache, см. DELIVERY.
- Strict E2E types0; production Chromium15628PASS0, workers1/retries0.
- Source3936e5f CI isolation job1305101976525PASS, identity success. Не предполагать
  успех остальных jobs без свежего чтения. Исторический local4/5 не подменяется им.
- В fixtures/bounded-repair входы, reviewed/output, patch, receipt, failure history,
  core/browser logs и hashes. Live модель/target publication не выполнялись.

## Следующее действие интегратора

Проверить Draft PR519 и актуальные общие контракты main; общий adapter b22b4f3
выделен отдельно и описан в INTEGRATION.md. Source3936e5f остаётся scoped, миграций
и новых dependencies нет. Принять API+web вместе. Merge/deploy/release подтверждает
интегратор; исполнитель их не выполняет. Все оговорённые программные критерии этого
блока покрыты; не создавать посторонние блоки ради продолжения.

## Реальные ограничения

Без разрешения нет live платной модели/чужого GitHub publish/ПК владельца/VPS.
Runner ограничен Node syntax/node-test и snapshot без сети/install/shell.
Tree128nodes/100k entries/8MB/30s; сверх лимита честный отказ.
Navigation API guard не гарантирован в старых browsers/uncancelable events.
Filename guard не заменяет содержательный аудит секретов выбранного исходника.
Неизвестный модельный исход не повторяется автоматически; ручное продолжение и
бесплатная проверка сохранённого review доступны. Live acceptance не объявлена.
