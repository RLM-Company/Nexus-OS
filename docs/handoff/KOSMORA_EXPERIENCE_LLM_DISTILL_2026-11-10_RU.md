# Опыт: LLM-поворот дистилляции — прогон ждёт установки модели (2026-11-10)

## Статус

Пакет measurement-only: офлайн-бенч LLM-кандидата дистилляции на замороженной
синтетической fixture принятых примеров (те же 13 кейсов, blob-идентично PR
«experience distillation»: fixture_sha256 b7a18513…). Кандидат
`llm-drop-candidate-v1` перефразирует sketch вместо полного выкидывания шагов —
гипотеза: детерминированный extractive-кандидат теряет чистый текст,
co-located со stale-сегментами (там было 2 declared lost), а LLM их сохраняет.

Готово без модели:

- `scripts/experience-llm-worker.mjs` — офлайн-worker генерации по образцу
  shipped `encoder-worker.mjs`: только локальная директория, remote-модели и
  браузерные кэши выключены, fetch заменён на строгий отказ
  (`LLM_NETWORK_DISABLED`) до любой обработки текста, greedy-декодирование
  (`do_sample:false`), `max_new_tokens 700`, CPU.
- `scripts/bench-experience-llm-distill.mjs` — режимы `--prompts`
  (заморозка промптов без модели — выполнено), `--digest` (хелпер оператора),
  полный прогон по manifest (SHA-верификация файлов до генерации).
- Frozen prompts: `prompts_sha256 66d5a98a…`, `system_sha256 6b2e7b9f…`,
  13 промптов 2 361–7 266 байт; ground truth fixture в промпт не включён
  (проверено подстрочным сканом `expected_dropped|relevant_literals|forbidden`).
- Manifest `docs/research/experience-llm-distill-manifest-2026-11-10.json`:
  ревизия `22942cb7…` (HEAD main на момент пина), onnx-коммит `516c8d04…`,
  dtype q4; дайджест весов предзаписан из LFS-указателя
  (`09235a3b…`, файл 786 156 820 байт), мелкие файлы — записывает оператор.
- Error-пути проверены без модели: отсутствие аргументов → exit 2
  (MODELS REQUIRED), manifest без записанных дайджестов/файлов → exit 3
  (`LLM_MANIFEST_NOT_INSTALLED`), расходящийся файл → exit 3
  (`LLM_MANIFEST_MISMATCH:<file>`). Числа без модели не выдаются.

PR намеренно не открыт: пакеты этой очереди доставляются с отчётом,
а полный прогон возможен только после установки модели оператором.

## Что нужно сделать (установка модели, всё вне репозитория)

1. Скачать модель офлайн, сохраняя структуру папок (≈0,8 ГБ, только q4):

   ```
   huggingface-cli download onnx-community/Qwen2.5-0.5B-Instruct --revision 22942cb7d7ba4cc81bb4673549ca4d4614469b5e --include "*.json" "*.txt" "onnx/model_q4.onnx" --local-dir <dir>
   ```

   `<dir>` — любой локальный путь вне репозитория. Другие варианты весов
   (fp32/fp16/int8/uint8/bnb4/quantized/q4f16) не нужны и не верифицируются.

2. Записать дайджесты установленных файлов:

   ```
   node scripts/bench-experience-llm-distill.mjs --digest <dir>
   ```

   и перенести значения в соответствующие `sha256: null` записи
   `docs/research/experience-llm-distill-manifest-2026-11-10.json`
   (ключи совпадают по форме). Сверить дайджест весов с предзаписанным
   `09235a3b…` — он должен совпасть; расхождение означает не ту ревизию.

3. Первый полный прогон:

   ```
   node scripts/bench-experience-llm-distill.mjs <dir> docs/research/experience-llm-distill-manifest-2026-11-10.json docs/research/experience-llm-distill-2026-11-10.json
   ```

4. Повторный прогон с теми же аргументами плюс
   `docs/research/experience-llm-distill-2026-11-10.json` последним —
   bench сравнит поля поведения бит-в-бит и напечатает `REPRODUCED true/false`
   (как в предыдущих пакетах).

## Границы честности

- Продукт-код не меняется; bench не в CI; merge/deploy не исполняются —
  решение о внедрении за владельцем.
- Веса вне репозитория, сеть физически отключена в worker (по образцу
  shipped encoder-worker), модель загружается только из локальной директории
  после SHA-верификации.
- Промпты не содержат ground truth fixture; дайджесты промптов и system
  зафиксированы выше и в manifest.
- Данные fixture — синтетика, помеченная как синтетика.
- Результат прогона — одномашинное наблюдение на синтетике, не SLA и не
  утверждение об «интеллекте»; детерминизм двух проходов проверяется внутри
  прогона (`deterministic_pair`).

## Метрики прогона

На каждый кейс: `parse_ok`, `deterministic_pair`, `sketch_bytes` ≤ 5000,
`reduction` (сравнение с extractive-медианой 0,7935 из
`docs/research/semantic-experience-distill-2026-11-09.json`),
`forbidden_carried` (запрещённые литералы — raw-скан по сериализованному JSON),
`relevant_carried_strong` (посимвольные сохранения),
`declared_lost_recovered` (фокус: co-located-loss кейс),
`fabricated_file_tokens` (изобретённые имена файлов),
`stale_step_leak_ngrams` (5-граммы stale-шагов в скетче).

## После прогона

- Отчёт `docs/research/experience-llm-distill-2026-11-10.json` кладётся в PR
  вместе с bench/worker/fixture; затем обновляются строки очередей
  `docs/product/RUFLO_ADOPTION_SCOPE_RU.md` («Опыт выполнения») и
  `docs/product/GEMINI_NOVEMBER_ADOPTION_RU.md`.
- Нулевой forbidden carryover и отсутствие fabricated tokens — минимальные
  условия кандидата; любое деградирование документируется как результат и
  выносится владельцу, а не скрывается.
