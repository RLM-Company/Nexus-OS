# Koswork: восстановление табличных строк из OCR-координат

Дата: 2026-11-08 · Ветка: `desc/koswork-document-reading-20261108` · База:
`338536ee5946f96dcd18768143cc41af998c476a` (main после PR №463). Продолжение
[PDF/OCR пакета](KOSWORK_PDF_OCR_2026-11-04_RU.md) из Gemini November adoption.

## Что было и что работает теперь

Reader возвращал только линейный текст OCR: колоночная структура (суммы,
позиции чеков, счета) терялась в потоке слов. Теперь, когда OCR видит
достаточно согласованную сетку, страницы скана возвращаются со строками,
разбитыми на ячейки табуляцией — по **координатам слов** (bbox из blocks),
без второй модели, сети, движка или новых прав:

- `document-reader/ocr-layout.mjs` (новый, чистая ESM-геометрия):
  `collectOcrWords` (валидация/сортировка слов) и `layoutFromWords`
  (строки → разрыв по широким зазорам → модальная сетка колонок → проверка
  границ медианами). Консервативные отказы: меньше 3 совпавших строк,
  нет устойчивых границ, пересборка не влезает в `maxText`,
  > 5000 слов — тогда сохраняется прежний линейный текст.
- `document-reader/reader.js`: OCR вызывает `recognize(canvas, {}, { text,
blocks })`; пересборка применяется только к OCR-пути, text-layer путь
  не изменён. Все слова сохраняются; слово не выпадает и не переписывается.
- `document-reader/host.cjs`: в allowlist добавлен `ocr-layout.mjs`.
- `desktop/windows/package.json`: check-скрипт и build.files включают модуль.

## Границы без изменений

Один читатель-рендерер, sandbox-сессия, тот же protocol allowlist, те же
grants/отзывы/версии/хеши, тот же контракт результата (добавляется только
содержимое `text`). Это по-прежнему **не** семантическое чтение диаграмм,
не handwriting и не гарантированная структура таблицы: неверные OCR-слова
могут склеить или разрезать ячейку — читается новая limitation-строка в
reader'е, а `confidence` остаётся оценкой движка. `complete_document=false`.

## Проверки (фактические)

```
cd desktop/windows
node --test test/ocr-layout.test.cjs      # 6/6: сетка, отказ
node --test test/*.test.cjs               # 338/339 (lifecycle-guard —
                                          # средовое, нет pwsh; pre-existing)
node --check document-reader/ocr-layout.mjs
```

- `test/ocr-layout.test.cjs`: сетка счёт/hhmm (4×4, границы 150/290/430),
  проза без сетки, строка вне сетки остаётся строкой, отбор невалидных
  слов и x-порядок, caps (5000 слов / maxText), asset-allowlist
  (`ocr-layout.mjs` отдаётся, `secret.cjs`, traversal — нет).
- Настоящий WASM/OCR-прогон выполняется в packaged CI (existing
  native-acceptance на fixture PDF — ожидаемые слова по-прежнему входит в
  текст, так как слова сохраняются). Локально WASM/Chromium недоступен
  (нет node_modules/vendor) — настоящий engine-run в этом пакете не
  вызывался; fixtures синтетические.
- Prettier 3.9.6 (pinned) — чисто; check-secrets — OK.

## Интеграция и откат

- Отдельный PR; merge/deploy не выполнялись. Никаких миграций и решений
  по нравам не требуется. Откат — revert коммита пакета.
