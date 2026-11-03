# Руководство по дедуктивному движку Datalog, MinHash-LSH дедупликатору, W3C OpenTelemetry трейсеру и защите буфера обмена Kosmora / Nexus-OS (Волна 23)

**Дата:** 3 ноября 2026 г.  
**Ветка:** `feature/kosmora-self-healing-and-knowledge-graph-20261102`  
**Репозиторий:** `RLM-Company/Nexus-OS` (PR #411 .. #428 + Waves 16-23)  
**Статус верификации:** **22 из 22 тестовых сьютов PASS (100%)**.  
**Инварианты границ:** 0 изменений в файлах Codex (`apps/api/src/account-settings/**`, `packages/db/src/usage-store.ts`, `packages/contracts/src/usage.ts`). 0 утечек секретов.

---

## 1. Архитектурный контекст и цели Волны 23

Волна 23 дополняет архитектуру Kosmora / Koswork четырьмя высокоуровневыми подсистемами формального логического вывода, сублинейного поиска нечётких дубликатов, распределенной трассировки стандарта W3C и защиты десктопного периметра Windows:

1. **Дедуктивный движок правил Datalog и прямой логический вывод (`packages/core/src/datalog-inference-engine.ts`)**:
   - Вычисляет наименьшую неподвижную точку (`materializeFixedPoint`) над базой экстенсиональных фактов (EDB) и рекурсивных дизъюнктов Хорна (IDB) со стратифицированным отрицанием (`not pred(...)`).
   - Обеспечивает транзитивное замыкание графа зависимостей шагов DAG (`reachable(?X, ?Z) :- step_depends(?X, ?Y), reachable(?Y, ?Z)`) и формальную проверку политик доступа с учетом квиесцирования аккаунта (`can_mutate_drive(?U)`).

2. **Детектор нечётких дубликатов MinHash и Locality-Sensitive Hashing (LSH) (`packages/db/src/minhash-lsh-deduplicator.ts`)**:
   - Строит 64-элементные сигнатуры Бродера (`computeMinHashSignature`) по 4-символьным шинглам с универсальным хэшированием по модулю простого числа Мерсенна `2^31 - 1`.
   - Разбивает сигнатуру на 16 LSH-полос по 4 строки (`computeLshBandKeys`), обеспечивая сублинейный поиск почти идентичных текстов и документов (`findNearDuplicates`) с сохранением в таблицу SQLite `kosmora_minhash_signatures`.

3. **Распределенный трейсер W3C OpenTelemetry и анализатор критического пути (`packages/core/src/opentelemetry-trace-analyzer.ts`)**:
   - Генерирует и парсит стандартные заголовки `traceparent` (`00-<32-hex-traceId>-<16-hex-spanId>-01`).
   - Строит иерархическое дерево спанов между процессами (`kosmora-api`, `kosmora-db`, `model-gateway`), вычисляет собственное время каждого узла (`selfTimeMs`), реконструирует критический путь (`criticalPathSpanIds`) и автоматически находит главное узкое место задержки (`bottleneckSpan`).

4. **Защита от Pastejacking буфера обмена и фильтрация Drag-and-Drop (`desktop/windows/ci/clipboard-and-drop-guard.cjs`)**:
   - Перехватывает скрытые управляющие последовательности ANSI (`\x1b[201~`), внедрение фоновых команд PowerShell / `curl | sh` и автоматическое исполнение многострочных вставок в терминале (`inspectAndSanitizeClipboard`).
   - Блокирует перетаскивание и выгрузку опасных исполняемых расширений Windows (`.exe`, `.ps1`, `.bat`, `.lnk`, `.hta`, `.msi`), скрытых потоков NTFS Alternate Data Streams (`invoice.pdf:evil.exe`), сетевых путей UNC (`\\server\share`) и файлов за пределами разрешенной рабочей папки (`verifyDragAndDropFiles`).

---

## 2. Инструкция по верификации

1. **Запуск полной матрицы (22 сьюта):**
   ```bash
   node scripts/stage2-master-verification-matrix-runner.mjs
   ```
2. **Запуск изолированного смоук-теста Волны 23:**
   ```bash
   node scripts/integration-datalog-minhash-otel-and-clipboard-smoke.mjs
   ```
3. **Проверка секретов и границ параллельной разработки:**
   ```bash
   node scripts/check-secrets.mjs
   git diff --name-only apps/api/src/account-settings packages/db/src/usage-store.ts packages/contracts/src/usage.ts
   ```
