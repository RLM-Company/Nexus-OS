# Тяжёлый пакет «Анализ файлов» — 24 ноября 2026

Автономный воспроизводимый набор для раздела **«Анализ файлов»**.
Только локальные фикстуры: никаких сетевых вызовов, платных провайдеров,
изображений, видео и музыки (эти форматы ведёт Gemini).

## Состав

| Файл                  | Назначение                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `generate.mjs`        | детерминированная генерация ZIP32 STORE: `heavy.zip`, `nested-evidence.zip`, `manifest.json`, `SHA256SUMS`       |
| `heavy.zip`           | 100550 байт: TXT (840 строк), PDF 140 стр., CSV 600 строк, DOCX, PDF-скан, вложенный ZIP, `notes.md`, `__MACOSX` |
| `nested-evidence.zip` | 2 вложенных документа с breadcrumb `nested-evidence.zip › nested › …`                                            |
| `self-check.mjs`      | независимая проверкаcentralal directory, CRC, сигнатур, страниц, лимитов                                         |
| `manifest.json`       | ожидаемые имена, байты, страницы, фрагменты, цитаты, пропуски, incomplete                                        |

## Покрытие сценария

| Проверка                               | Где                                                                        | Результат                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Загрузка вложенного ZIP (один уровень) | `prepareLibraryUpload` (PR #624) + heavy test                              | 9 документов, 2 пропуска                                                        |
| OCR/скан                               | `scans/scan.pdf` (image-only, incomplete) + `scans/scan.txt` (OCR sidecar) | скан не выдаётся за текст; цитата из sidecar                                    |
| Распределение фрагментов               | `chunkLibraryPages`, `DocumentLibraryStore.complete`                       | 177 chunks, ≤5000 на файл                                                       |
| Цитаты до страницы                     | `validateDocumentAnswer`, `answerReportLines`                              | `«Код станции: SELENE-047»`, `«Сумма 19700»`, «срок сдачи»                      |
| Отмена                                 | `DocumentAnswerService.cancel`                                             | run → `cancelled`                                                               |
| Повтор بعد потери ответа               | `DocumentAnswerService.retry`                                              | новый run → `done`, старый остаётся в истории                                   |
| Частичный сбой                         | `coverage.analyzed + failed = total`                                       | отчёт называет файлы/страницы                                                   |
| Экспорт ZIP                            | `buildWorkResultsArchive`                                                  | `manifest.json` + TXT/DOCX/PDF/CSV одного завершённого результата               |
| Пределы                                | manifest.limits + замер                                                    | 20 MB/файл, 2M символов, 3000 стр., 5000 chunks, 100 файлов, 100 MB, 4 MB архив |

## Замер (локально, Windows, in-memory SQLite)

```
HEAVY_METRICS={"ms":410,"heapMb":46,"files":9,"chunks":177,"archiveBytes":128966}
```

Метрики получены из `apps/api/test/file-analysis-heavy.test.ts`; повторить:

```bash
node docs/handoff/fixtures/file-analysis-heavy/generate.mjs
node docs/handoff/fixtures/file-analysis-heavy/self-check.mjs
pnpm --filter @cosmora/api exec vitest run --pool=threads --maxWorkers=1 test/file-analysis-heavy.test.ts
pnpm --filter @cosmora/api exec vitest run --pool=threads --maxWorkers=1 test/work-results-archive.test.ts
```

## Найденные и исправленные разрывы

1. `DocumentAnswerService.retry` возвращал `CONFLICT`, если отменённый run ещё inertia в `active` map — теперь проверяется реальный durable status.
2. `buildWorkResultsArchive` отклонял breadcrumb-имена (`tables › budget.csv`, `nested-evidence.zip › nested › quote.txt`) — добавлен безопасный ASCII slug для пути при сохранении точного `original_name` в manifest;?????? regression-тесты на path traversal/extensions сохранены.

## Границы

Изображения/видео/музыка не входят. Живые модели, VPS, платные вызовы и merge в main не использовались.
