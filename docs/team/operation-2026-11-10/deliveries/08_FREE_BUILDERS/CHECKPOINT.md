# CHECKPOINT — 08_FREE_BUILDERS / games-sites-cycle

Обновлено: 26.11.2026. Ветка `studio/games-sites-cycle`, HEAD `0419ff41`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/682.

## Выполнено и запушено

1. `a1a6de30` — цикл 1:структурированную диагностику ошибки game.js → файл → исправление →
   повторный запуск. Unit 10 passed, typecheck/lint/build PASS. E2E добавлен,
   локально не завершён (таймауты webServer на Windows), ждёт CI.
2. `8098f32` — отдельный integration commit: аддитивный контракт
   `kosmora.game-project.v2` (ассеты, сцены, launch settings, 3D-модель),
   subpath export, 5 тестов. typecheck/build/tests PASS. Требует review Codex.
3. `0419ff41` — 3D-рендерер без внешних зависимостей (obj-lite, software projection),
   4 unit-теста. PASS.

## Следующий шаг (точка продолжения)

- Подключить v2-проект и 3D-рендерер к существующему пользовательскому входу
  (GamesWorkbench → CanvasEditor → GameSourcePreview), показать результат в
  правой панели минимальным integration commit (согласовано с владельцем:
  «насколько надо»), не переделывая чат/сайдбар/логотип/глобальные стили.
- Затем цикл 4 (Sites element edit + export/распаковка) и обязательный сценарий
  (3D-игра + сайт + три изменения с проверкой запуском).
- Связь с computer executor (OpenCode №2) — отложена по решению владельца.
- CI PR #682 проверить перед дальнейшими изменениями общего контракта.

## Ограничения

Полный браузерный suite локально на хосте Windows не пройден из-за таймаутов
webServer (API-fixture 60 s / Next 180 s) и предупреждений в чужих
`studio-data-*`/`presentations/*` файлах main. Реальные live/paid провайдеры,
выкладка и ПК владельца не затрагивались.
