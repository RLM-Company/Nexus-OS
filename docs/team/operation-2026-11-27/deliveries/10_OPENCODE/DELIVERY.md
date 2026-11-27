# OpenCode 4 — DELIVERY.md

## Срез 1 — Office CSV адресная правка (готов к сдаче)

- **Base SHA:** `3af92583ccc8ceb49f44c0b8633955f40feaf59f`
- **Branch:** `feature/oc4-office-workbench-20261127`
- **Worktree:** `C:/Users/Александр/Documents/Codex/2026-11-27/kosmora-oc4-office`
- **Head SHA:** `ded117cee5a545ac9d762d8a5fa062dcd353c4bb`
- **PR:** [#696](https://github.com/RLM-Company/Nexus-OS/pull/696)

### Что реально работает

CSV-файл можно открыть в существующем рабочем месте Koswork (Studio → Анализ
файлов → Рабочие документы), увидеть адреса ячеек, подготовить план адресных
правок (`set_cell`, `set_range`), посмотреть diff, подтвердить и скачать
новую копию. Версия `sha256:…`, preview-токен привязан к владельцу,
readback сравнивает все неизменённые ячейки. Формулы не вычисляются,
но разрешены только агрегаты по явным ссылкам; строковые значения с
`= + - @` экранируются префиксом `'`.

### Исходники

Все изменения в ветке (полный diff от базы):
`git diff 3af92583ccc8ceb49f44c0b8633955f40feaf59f..HEAD`

Ключевые новые файлы:

- `desktop/windows/workspace/office-csv.cjs`
- `desktop/windows/test/office-csv.test.cjs`
- `apps/api/test/document-workspace-csv.test.ts`
- `docs/team/operation-2026-11-27/deliveries/10_OPENCODE/*.md`

### Проверки (локальные, воспроизводимые)

См. `SCENARIOS.md`. Все зелёные. Live/E2E — отдельный срез, не заявлен.

### Не проверено / остаток

- Playwright E2E и живой браузерный проход (нет назначенного доступа).
- DOCX/PPTX и XLSX остаются на месте и покрыты регрессией (58 тестов);
  следующий срез — расширение сценариев DOCX (таблицы) и XLSX (форматирование).
- Внешние действия не выполнялись.
