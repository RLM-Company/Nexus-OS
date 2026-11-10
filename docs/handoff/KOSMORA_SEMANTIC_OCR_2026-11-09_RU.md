# OCR-кандидаты: handwriting/таблицы — measurement-only замер

## Согласованный объём

Пункт Gemini November adoption «OCR: диаграммы/handwriting». Формат первого
шага — measurement-only: продуктовый код, зависимости и UI не меняются;
замеряются два offline MIT-кандидата и продуктовый Tesseract baseline на
замороженной синтетической панели. Внедрение не входит в пакет: решение
остаётся за владельцем. CI этот bench не выполняет (модели лежат вне репо).

## Кандидаты

- **TrOCR handwriting** (`microsoft/trocr-base-handwritten`, MIT; ONNX q8
  конверсия `Xenova`, revision `e301d1c4`): image-to-text, 341 053 820 байт
  суммарно (encoder 88 MB + decoder 249,6 MB + tokenizer/config).
- **Table Transformer structure recognition** (`microsoft/`, MIT; `Xenova`,
  revision `5387550d`): object-detection «table row»/«table column» боксы,
  30 161 399 байт.
- **Baseline**: продуктовый Tesseract.js 7.0.0 с `@tesseract.js-data/eng`
  (LSTM, 4.0.0_best_int) из уже установленных изолированных deps
  `desktop/windows/document-reader/deps` — новых зависимостей не добавлялось.

Модели ставит оператор: `scripts/install-semantic-ocr-model.mjs <корень>`
скачивает/проверяет 15 файлов по `scripts/semantic-ocr-model-manifest.mjs`
(SHA256 каждого файла pinned). Bench (`scripts/bench-semantic-ocr.mjs`)
перед загрузкой сверяет все байты и затем блокирует `globalThis.fetch` —
как в продуктовом encoder-worker: сеть исключена после верификации.

## Фикстуры (синтетика, заморожены)

- 8 рукоподобных строк: шрифт Kalam Regular (SIL OFL 1.1, лицензия приложена
  в `packages/db/test/fixtures/semantic-ocr-licenses/`), белые PNG со
  служебными фразами (суммы/коды/сроки).
- 6 таблиц: сетки rows 3–7 × cols 2–6 с метками ячеек вида `A2`, `D3`…
- Все PNG + `manifest.json` (пометка synthetic, размеры, ground truth/сетки)
  в `packages/db/test/fixtures/semantic-ocr-{handwriting,tables}/`; SHA256
  каждого PNG фиксируется в отчёте. Никаких пользовательских данных.

## Прогон (Windows, CPU, q8, 2 intra-op потока; warm-up исключён)

| Замер                       | Результат                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------- |
| TrOCR, 8 строк              | CER 4,56% (case-insensitive primary); exact match 1/8; медиана 3,46 s/линия; load ~6 s |
| Table Transformer, 6 таблиц | точная сетка 6/6 (rows+cols), средняя                                                  | Δ   | строк/колонок = 0; медиана 1,40 s/таблица; load ~1,9 s |
| Tesseract.js baseline       | CER 0,41%; exact 7/8; медиана 0,12 s/линия                                             |

- TrOCR-ошибки точечные: лишняя точка в конце (`"…mugs."`), `15:40 → 15.40`,
  `note → mate`, `9811 → 981 )`.
- TATR на каждой таблице дополнительно нашёл 1 «table column header» — у
  синтетики семантического заголовка нет; это диагностическая особенность
  детектора, не ошибка счётчика.
- Повторяемость: агрегаты двух независимых прогонов совпали бит-в-бит
  (CER/matches 0,004149377593360996 / 1 / 6 одинаково; отличаются только
  машино-специфичные времена — первый прогон: 2,33 s, второй 3,46 s).

Полные пер-кейсы, детекции и SHA256 — в
`docs/research/semantic-ocr-2026-11-09.json`.

## Интерпретация и честные границы

- Панель — печатные «рукоподобные» шрифтовые рендеры, не реальные рукописи
  и не сканы; TrOCR обучен на настоящих рукописях (IAM) — эта панель вне
  его домена, числа — нижняя граница, не вердикт о модели.
- На панели продуктовый Tesseract обгоняет TrOCR по обоим измерениям
  (точность и ~15× скорость), а TATR даёт правильную структуру всех сеток.
  Значит: **замер не подтверждает необходимость нового продукт-пайплайна
  на этом классе входов**. Осмысленные следующие шаги — за владельцем:
  собирать репрезентативную панель реальных рукописей/сканов и повторить
  замер; рассмотреть TATR отдельно (структура таблиц — область, где у
  продуктового Tesseract связки нет); либо оставить Tesseract.
- TATR — только структурные боксы: не чтение ячеек, не graph-диаграммы.
  Тяжёлые кандидаты (Pix2Struct/DePlot и подобное) в замер не включались.
- Не SLA, не «интеллект-заявления»: одна машина, синтетика, measurement-only.

## Воспроизведение

```sh
node scripts/install-semantic-ocr-model.mjs "C:\models\kosmora-semantic-ocr"
node scripts/bench-semantic-ocr.mjs "C:\models\kosmora-semantic-ocr" "C:\...\docs\research\semantic-ocr-2026-11-09.json"
```

Второй аргумент bench — абсолютный путь отчёта; `--no-tesseract` отключает
базовый замер (при недоступности deps baseline помечается `available: false` с
причиной, а не падением).
