# Точка продолжения 02_DEVELOPER

10 ноября 2026, Москва. Branch `ops/developer-coscode`, [PR #507](https://github.com/RLM-Company/Nexus-OS/pull/507).
BASE_SHA `f9eb45285f3473bfd3fe9a73939c1903dc696b3b`.
HEAD_SHA проверенного кода `fcc183d18e9e465e10cbf663636fefa0139028b0`.
Source `89ec737afdb35d4446193f51604baefe6388c885`; code tree
`223721a5282c57b9ed65cc6e64bafed89a502fba`. Docs head — в PR.

Первый срез: **готово к интеграции**. Строгие доказательства exit/cleanup/journal,
проверка старых rows, UI unknown и ограниченное acknowledgement/cleanup отмены OCI.
Новый временный Git case реально меняет 2 файла, воспроизводит ошибку, проверяет
исправление, stale snapshot, отмену и сохранность README. Подробности в DELIVERY.

Фактически: runtime scoped61, API scoped57, production UI9 PASS. Frozen core exit0:
свежие API986/web290/runtime71 +5 opt-in skips; прочие тесты cache replay. Внешний
code head OCI job CI#1753 — 5/5 PASS. Локальный opt-in последний run4/5 — один прежний
5s setup timeout; не скрывать его. История race/fake timers/build/deps в fixtures.

Следующий независимый срез: воспроизвести потерю несохранённых edits при выборе
другой задачи/проекта и reload, не подменять явное сохранение review. Начать с
`apps/web/src/app/code-agent/page.tsx`: handlers выбора проекта/history и текущие
`proofDirty`/`accept`/`invalidateProof`. Сохраняемый review/checkpoint уже есть;
не создавать второй store/runtime. После исправления UI проверить отмену перехода,
явный discard, saved-review recovery и отсутствие дополнительных model/publish POST.

Полная автономность Coscode ещё не объявлена завершённой. Live foreign push/PR,
реальная модель, ПК владельца, merge/deploy/VPS не разрешены. UI дизайна, Office,
browser/CDP и work runtime не трогать. Общую доску не редактировать.
