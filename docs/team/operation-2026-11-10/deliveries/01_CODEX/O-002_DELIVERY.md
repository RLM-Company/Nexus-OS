# O-002: Drive — запрет fallback при утрате современных подтверждений

BASE_SHA:9311cd5702a4899fb3bcd79952d3834c68fa15a4 (кандидат первой волны).
Ветка ops/codex-drive-evidence-20261110, зависит от первой волны PR505.
Точный HEAD и общий CI — в PR этого среза.

До: fallback manager_work_files исключал только published версии. Если версия
была неопубликована/удалена, современный результат мог стать legacy source без
исходного checksum. Checkpoints в fallback не учитывались.
После: legacy metadata и чтение body требуют отсутствие checkpoints и любой
версии данного имени. Старый явный выбор, переставший быть допустимым, даёт
DRIVE_OPERATION_CONFLICT до upload. Настоящий pre-checkpoint legacy не отключён.

Изменены действующие SQL в apps/api/src/cloud-storage/google-drive-snapshot.ts
и регрессии apps/api/test/google-drive-snapshots.test.ts. Никаких DB migration,
новых endpoints/capabilities, UI, OAuth/ключей, провайдера или реальных uploads.

Проверка до исправления:4/4новые регрессии падают по ожидаемой причине.
После: полный snapshot suite26/26passed; scoped lint/format/secrets/diff —
перед commit. Общий CI обязателен. Ограничение: источник с утраченными
подтверждениями не считается доступным legacy; это не ремонт повреждённых данных
и не гарантия полной резервной копии всех когда-либо существовавших результатов.
Не проверено живьём: Google OAuth/API, VPS и устройство владельца.
