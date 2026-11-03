# KOSMORA / KOSWORK — WAVE 25: CUCKOO & BLOOM FILTER INDEX, SHAMIR (K, N) SECRET SHARING OVER GF(256), CAUSAL COUNTERFACTUAL ATTRIBUTION & INTERACTIVE HTML5/SVG REPORT BUILDER (2026-11-03)

## 1. Обзор реализованных систем (Wave 25)

1. **Partitioned Bloom Filter & Dynamic Cuckoo Filter Index (`packages/db/src/cuckoo-and-bloom-filter-index.ts`)**:
   - **Dynamic Cuckoo Filter (`CuckooFilterIndex`)**: 4-слотовые корзины с 16-битными отпечатками (fingerprints), partial-key cuckoo-хеширование ($i_2 = i_1 \oplus \text{hash}(\text{fp})$), детерминированное вытеснение (`maxKicks = 128`) и поддержка **удаления элементов за $O(1)$ (`delete(item)`)** без ложноотрицательных срабатываний, с сохранением снапшотов в таблицу SQLite `kosmora_probabilistic_filter_snapshots` (миграция `0063`).
   - **Partitioned Bloom Filter (`PartitionedBloomFilter`)**: оптимальное вычисление числа бит $m = -\frac{n \ln p}{(\ln 2)^2}$ и числа хеш-функций $k = \text{round}(\frac{m}{n} \ln 2)$ по схеме двойного хеширования Кирша — Митценмахера.

2. **Shamir's $(k, n)$ Threshold Secret Sharing & Proactive Share Refresh over $\text{GF}(256)$ (`packages/core/src/shamir-secret-sharing-escrow.ts`)**:
   - Пороговое разделение мастер-ключей Vault и аварийных ключей Google Drive на $n$ криптографических долей (`splitSecret`) в конечном поле Галуа $\text{GF}(2^8)$ с неприводимым полиномом AES ($x^8 + x^4 + x^3 + x + 1 = \text{0x11B}$).
   - Точное побайтовое восстановление секрета из любых $\ge k$ долей методом полиномиальной интерполяции Лагранжа в точке $x = 0$ (`reconstructSecret`) с проверкой целостности каждой доли по SHA-256.
   - **Проактивное обновление долей без сборки секрета (`refreshSharesWithoutReconstructing`)**: прибавление случайного полинома степени $k-1$ с нулевым свободным членом ($\Delta(0) = 0$), что мгновенно обесценивает утёкшие старые доли при сохранении исходного секрета.

3. **Structural Causal Model (SCM) Do-Calculus & Counterfactual Root-Cause Attribution (`packages/core/src/causal-counterfactual-attribution.ts`)**:
   - Формальный граф структурных причинно-следственных уравнений с поддержкой **интервенционного оператора Джуды Перла `do(X = x)`** (`evaluateForward({ doInterventions })`), отсекающего входящие рёбра к модифицируемой вершине.
   - **Трёхшаговая контрфактическая атрибуция первопричин аномалий (`attributeOutcomeAnomaly`)**:
     1. *Abduction*: восстановление латентных экзогенных возмущений $U$ из наблюдаемых метрик.
     2. *Action*: контрфактическая замена возмущения проверяемого узла на базовую норму.
     3. *Prediction*: расчёт чистого причинного вклада каждого узла в итоговое отклонение SLA.

4. **Desktop Interactive HTML5/SVG/LaTeX Report Bundle Builder (`desktop/windows/workspace/interactive-report-bundle-builder.cjs`)**:
   - Компилятор автономных однофайловых `.html` отчётов с встроенными векторными SVG-диаграммами (`renderInlineSvgChart`), математическими блоками LaTeX, строгой политикой `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'`), защитой от XSS и встроенным JSON-LD манифестом происхождения с SHA-256 слепком.
