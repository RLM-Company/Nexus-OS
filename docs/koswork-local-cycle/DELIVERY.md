# Koswork ↔ локальный исполнитель Windows: автоматический сквозной прогон

**Ветка:** `stage3/koswork-local-cycle`. **База:** PR #621 head `dff95ddd` +
документы #621. Дата: 24 ноября 2026.
**Владелец сферы:** пользовательский путь Koswork → локальный executor;
установка и обновление клиента — другой чат (здесь не трогались).

## Что запускалось

```
pnpm test:koswork-local-cycle
# или с фиксированным каталогом артефактов:
node scripts/run-koswork-local-cycle.mjs --out=<dedicated temp dir>
```

`run-koswork-local-cycle.mjs` использует **реальные модули продукта** —
`ComputerSession`, `createComputerWorkspace`, `createComputerHistory`,
`validateComputerAction` — с отдельной временной папкой и синтетическим
детерминированным planner'ом. Это не мок executed-логики: действия
`workspace_*` выполняются настоящим workspace-адаптером на реальных байтах
временной папки. Мок заменяет только модель и GUI-драйвер.

## Цикл и результаты

| Шаг | Проверка                                      | Результат                                                                                                                         |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Подключение и выбор рабочего пространства     | **pass** — workspace id есть, snapshot совпадает                                                                                  |
| 2   | Открытие тестового приложения                 | **pass** — `open_app` принят, unsafe-путь отклонён                                                                                |
| 3   | Создание и сохранение файла                   | **pass** — `koswork-cycle.md`, 61 байт, SHA256 `923a7e406cea…`                                                                    |
| 4   | Чтение файла и возврат результата в Koswork   | **pass** — `workspace_read` видит контрольный текст, `done`, session `completed`, history `completed`                             |
| 5   | Отзыв разрешения во время действия            | **pass** — запись после revoke отклонена (`COMPUTER_WORKSPACE_CHANGED`), файл не создан                                           |
| 6   | Остановка                                     | **pass** — abort до execute, `WORKSPACE_OPERATION_CANCELLED`                                                                      |
| 7   | Перезапуск помощника и восстановление статуса | **pass** — новый `ComputerHistory` читает `completed` и тот же workspaceId                                                        |
| 8   | Потеря ответа при сохранении                  | **pass** — повторный `workspace_create` даёт `WORKSPACE_ALREADY_EXISTS`; `workspace_read` подтверждает те же байты, дубликата нет |
| 9   | Соблюдение разрешений                         | **pass** — чужой owner/origin отклонён, native desktop input не использован                                                       |

Итог: **10/10 проверок pass**, exit 0. Воспроизведено дважды (свежий temp и
`--out=<dedicated>`). Артефакты: [result.json](result.json),
[actions.jsonl](actions.jsonl). Журнал содержит connection, подтверждения,
proposal/notify, результат сессии, файл с хешем и все проверки.

## Честные границы

- Нет Electron-бинария и установленного Windows-клиента, поэтому **живой GUI
  и управление ПК владельца не проверялись** — установку/обновление ведёт
  другой чат. Открытие тестового приложения проверено на уровне валидации
  действия (`open_app`), не реальным запуском окна.
- Модель синтетическая, платных вызовов нет; контрольные числа вымышленные.
- Это автоматическая fixture-приёмка интеграции, не live acceptance
  установленного клиента.

## Следующий шаг

Когда другой чат подготовит зафиксированный Electron-бинарий, повторить тот же
цикл через `scripts/run-computer-control-live.mjs --run --electron <pinned>`;
это отдельный live-прогон с тем же набором проверок.

## Команды

```
pnpm install --frozen-lockfile
pnpm test:koswork-local-cycle
node scripts/run-koswork-local-cycle.mjs --out=$TEMP/koswork-cycle-check
```
