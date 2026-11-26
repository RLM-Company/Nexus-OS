# Воспроизводимая сдача: поручение с наблюдаемым результатом

**Ветка:** `feature/device-voice-control`, финальный SHA в PR #680.

## Фактический прогон

```
pnpm --filter @cosmora/api exec node --import ../../node_modules/.pnpm/tsx@4.20.6/node_modules/tsx/dist/loader.mjs ../../scripts/run-koswork-local-cycle.mjs --out=<dedicated temp dir>
```

Результат: `passed: true`, exit 0. Артефакты:
[result.json](DEVICE_VOICE_ACCEPTANCE/result.json),
[actions.jsonl](DEVICE_VOICE_ACCEPTANCE/actions.jsonl).

Прогон использует реальные модули `ComputerSession`, `createComputerWorkspace`,
`createComputerHistory` с синтетическим planner'ом и отдельной временной папкой.
Поручение создаёт файл `koswork-cycle.md`, агент повторно читает его и возвращает
результат в журнал. Проверки включают: подключение и выбор папки, открытие
разрешённого приложения (action-level), создание/сохранение файла, возврат
результата, отзыв разрешения во время действия, остановку, восстановление
статуса после перезапуска помощника, потерю ответа при сохранении без
дублирования и соблюдение разрешений.

## Честные границы

- Синтетический planner, без живого платного провайдера.
- Electron-бинарий/установленный Windows-клиент не использовались; минимальный
  desktop-слой проверен 470 node-тестами.
- Восстановление соединения и отключение устройства проверены на уровне
  типизированных recovery-событий и проверки API-сессии; живой GUI reconnect и
  приёмка на основном устройстве владельца согласовываются отдельно.
- Голос: по решению владельца подготовлен research+лицензионный предмет
  (`VOICE_FOUNDATION_RESEARCH.md`), без интеграции.
