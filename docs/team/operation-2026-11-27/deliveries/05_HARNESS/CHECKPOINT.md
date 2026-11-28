# CHECKPOINT — Harness 2 локальный acceptance harness

Состояние на 2026-11-27 (Europe/Moscow). Ветка
`feature/ds2-memory-skills-business-20261127`, HEAD (на момент запуска):
`185e26482ab8f3e3f5c5e2c962cc1b144aaf17a1`. Коммит НЕ делался.

## Что готово

- `scripts/memory-acceptance.mjs` — воспроизводимый локальный прогон на
  реальных модулях (`packages/core/dist`, `packages/db/dist`, собранных из
  исходников этой ветки) и реальной in-memory SQLite через
  `openDatabase(":memory:") + runMigrations`.
- Покрыты 5 блоков: фикстура двух проектов и нескольких длинных чатов;
  принятие/изменение решения, компакция, JSON round-trip, продолжение в другом
  чате; исключение источника и изоляция owner/project; полный цикл Skill;
  честные границы.
- JSON-журнал: `memory-acceptance.journal.json` в этой же папке. Итог:
  `ACCEPTANCE PASS — 19 assertions`, `provider_called/model_called/network_called = false`.
- Ни один исходный файл, INTERFACES.md, SCENARIOS.md или другой документ не
  изменён.

## Техническое состояние

- Скрипт запускается точной командой из задания, без дополнительных флагов.
- `@cosmora/contracts` резолвится в source через существующий
  `scripts/ds2-resolve-hook.mjs`; core/db грузятся из `dist`, так как
  `--experimental-strip-types` не поддерживает parameter properties в их
  `.ts`. dist собран локально из неизменённых исходников ветки.
- Схема БД взята из реальных миграций (`projects.title`, `chats` как родитель
  `messages`); фикстура создаёт только owner-данные через реальные INSERT.
- Исключение источника проверяется через реальный `excludeMessageIds` в
  `ContextMemoryStore.resolve`; дополнительно вызываются реальные
  `selectContextScope`, `fitContextMemory`, `mergeContextMemory`,
  `selectContextBundle`.

## Осталось / границы

- Не проверяются истина, качество модели, живой провайдер, сетевой путь,
  реальный HTTP-слой и качество семантического ранжирования. Это явно
  перечислено в выводе скрипта и в журнале.
- Старая версия решения может оставаться только как датированный history-отрывок
  с provenance; как активная memory-запись она не возвращается.
- Запись журнала и все документы подготовлены, но не закоммичены.
