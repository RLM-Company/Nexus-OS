# BACKLOG — Games и Sites (Studio)

База: `5f976d77b9a756ddcb10365e3aa60e1efb69d8b7` (main 25.11.2026).
Ветка: `studio/games-sites-cycle`. Обследование: 26.11.2026.

## Реально работает (подтверждено чтением кода и unit-тестами)

- Games: `GamesWorkbench` → `SitesWorkbench(kind=game_project)` → `CanvasEditor` →
  `GameSourceEditor` / `GameSourcePreview`. Контракт `kosmora.game-project.v1` —
  3 файла (`scene.html`, `styles.css`, `game.js`), ≤128 KiB.
- Запуск игры: Web Worker + OffscreenCanvas, CSP `default-src 'none'`, `connect-src 'none'`,
  console/errors в `<ol id="game-log">`, стоп по таймауту/лимиту сообщений, 10-минутный лимит.
- Сохранение: Canvas версии, diff выбранного файла, Undo/Redo, ZIP import/export,
  защита несохранённых правок при смене проекта/seed.
- Sites: статический HTML, аудит без исполнения, встроенные PNG/JPEG/WebP ≤64 KiB,
  CSP без сети/скриптов.
- Unit: 7 тестов Games/Sites проходят. E2E-спеки `game-development`, `games-workbench`,
  `sites-workbench` существуют.

## Отсутствует (по заданию владельца)

1. Полноценный Games-цикл: диагностика ошибки со ссылкой на конкретный исходный файл,
   исправление и повторный запуск в том же пользовательском пути.
2. 3D-проект: движок/модель/сцена/настройки запуска; источники, просмотр, правка,
   экспорт. В коде нет three.js/glTF/OBJ/Godot/Blender.
3. Sites: изменение конкретного элемента страницы и экспорт с проверкой
   сохранения ресурсов после распаковки.
4. Обязательный сценарий: небольшая 3D-игра + сайт, затем изменение механики,
   модели и раздела сайта с проверкой запуском.
5. Вывод результата в правую рабочую панель (shared `aside` в `page.tsx`, владение Codex)
   — только согласованным минимальным integration commit.

## Решения владельца (26.11.2026)

- 3D — web-нативный стек (three.js + glTF/OBJ) внутри существующего sandbox.
  Нативные Godot/Blender не запускаются; Godot/Blender — только как референсы структуры.
- Правую панель трогать «насколько надо»: минимальный functional integration,
  чат/сайдбар/логотип/глобальные стили не переделывать.
- Связь с computer executor (OpenCode №2) отложена до отдельной координации.

## Порядок срезов

1. Цикл 1: зафиксировать воспроизводимый сценарий create→save→reopen→edit для
   Games и Sites, устранить найденный сбой/пробел. PR с SHA и командами.
2. Цикл 2: Games error diagnostics — error→файл→правка→перезапуск. PR.
3. Цикл 3: 3D runtime + модель/сцена + экспорт + панель (integration commit). PR.
4. Цикл 4: Sites element edit + export/распаковка. PR.
5. Обязательный сценарий: 3D-игра + сайт и три изменения, проверка запуском. PR.

Статусы Supervised by integrator: merge/deploy/vendor VPS/OpenCode №2 — не выполняются.
