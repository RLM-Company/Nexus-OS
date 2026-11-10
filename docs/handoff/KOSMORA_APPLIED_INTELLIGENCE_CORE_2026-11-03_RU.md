# KOSMORA / KOSWORK — ОТДЕЛЬНЫЙ ПАКЕТ ПРИКЛАДНОГО ИНТЕЛЛЕКТА И АДАПТИВНОЙ ПЕРСОНЫ ИИ (`kosmora-intelligence-core-pack.zip`, 2026-11-03)

## 1. Назначение пакета

Этот пакет собран **отдельно** от предыдущего трёхдневного архива и включает все модули, созданные для усиления прикладного интеллекта, самокоррекции (Test-Time Compute) и кастомизации характера/стиля общения ИИ:

1. **Адаптивный композитор персоны, стиля общения и кастомного системного промпта (`packages/core/src/adaptive-persona-and-prompt-composer.ts`)**:
   - **Кастомный системный промпт из настроек (`customSystemPrompt`)**: пользователь может задать любой собственный характер, роль или правила поведения в настройках, и они получают приоритет в блоке `[OWNER_CUSTOM_SYSTEM_PROMPT]`.
   - **Автоматическая подстройка под собеседника на лету (`inferUserCommunicationStyle`)**: если включён режим `autoAdaptStyle` (по умолчанию `true`), ИИ по последним репликам определяет язык (`ru` / `en` / `mixed`), регистр общения (`casual_peer` — «на ты», `polite_formal` — «на Вы», `technical_direct`), желаемую краткость (`concise` / `balanced` / `detailed`) и нетерпимость к «воде» (`prefersNoFluff`), подстраивая тон ответа без потери точности.
   - **Несгораемый замок ограничений (`mandatoryConstraints`)**: закрепляет жёсткие правила пользователя в конце системного промпта с гарантией `0% constraint loss`.

2. **Конвейер глубокого мышления и многопроходной самопроверки (`packages/core/src/test-time-compute-self-refine.ts`)**:
   - **Маршрутизатор `System 1` vs `System 2` (`assessQueryComplexity`)**: простые вопросы идут по быстрому однопроходному пути (`fast_single_pass`, 0 лишней задержки), а сложные архитектурные, кодовые и многокритериальные задачи автоматически переводятся в режим глубокого мышления (`deep_self_refine`) с выделением `4 096`–`32 768` токенов `thinking_budget`.
   - **Цикл `Draft -> Critique -> Self-Refine` (`evaluateAndBuildRefinement`)**: проверяет черновик ответа на:
     - пропущенные требования или нарушенные запреты пользователя (`missed_constraint`);
     - ленивые заглушки (`// TODO`, `[Insert ...]`, `placeholder_stub_detected`);
     - незакрытые блоки кода ` ``` ` (`unbalanced_code_or_json`);
     - зацикливания фраз (`repetition_loop`).
     При обнаружении любого дефекта автоматически формирует корректирующий промпт `[SELF_REFINE_CRITIQUE_PASS]` и снижает `temperature` для точного исправления до показа ответа пользователю.

3. **Хранилище настроек интеллекта и выученного профиля стиля в SQLite (`packages/db/src/ai-intelligence-settings-store.ts`)**:
   - Таблица `kosmora_ai_intelligence_settings` (не затрагивает зарезервированный каталог `apps/api/src/account-settings/**`).
   - Хранит для каждого `owner_id`: `custom_system_prompt`, `auto_adapt_style`, `default_reasoning_mode` (`auto` | `fast` | `deep_self_refine`), ручные оверрайды `custom_temperature` / `custom_top_p` / `custom_thinking_budget` и `learned_style_profile_json` (чтобы ИИ помнила привычный стиль пользователя между сессиями).

4. **Адаптивный контроллер гиперпараметров декодирования (`packages/core/src/adaptive-ai-parameter-controller.ts`)**:
   - Управляет `temperature`, `top_p`, `top_k`, `min_p`, `presence_penalty`, `frequency_penalty`, `repetition_penalty` и `thinkingBudgetTokens` под профили задач и протоколы моделей (`Sol 1.05M`, `Fable 5 1.0M`).

## 2. Вторая фаза пакета: Единый когнитивный цикл, Шлюз неопределённости, Рабочая тетрадь и API настроек

5. **Шлюз эпистемической неопределённости и умных уточнений (`packages/core/src/uncertainty-and-clarification-gate.ts`)**:
   - Отличает задачи, которые можно выполнить сразу (`proceed_autonomously`), от частично заблокированных (`execute_unblocked_then_ask` — сначала выполняет все независимые шаги, а в конце задаёт 1 точный вопрос с конкретными вариантами) и опасных/неоднозначных мутаций (`halt_and_clarify`).
   - Разрешает конфликты версий фактов: более новая запись автоматически перекрывает старую только при явном флаге `explicitlySuperseded: true`, иначе обе версии выносятся на выбор пользователя.

6. **Структурированная рабочая тетрадь памяти на время задачи (`packages/core/src/working-memory-scratchpad.ts`)**:
   - Удерживает проверенные факты с привязкой к источникам (`[WORKING_MEMORY_VERIFIED_FACTS]`), проверяемые гипотезы (`testing` / `confirmed` / `refuted`) и чек-лист подцелей (`[x]`, `[/]`, `[ ]`), чтобы модель не теряла нить рассуждений на длинных цепочках вызовов инструментов.

7. **Единый когнитивный оркестратор хода (`packages/core/src/cognitive-turn-orchestrator.ts`)**:
   - Связывает в один вызов `prepareTurn(...)`: оценку сложности `System 1 / System 2`, проверку неопределённости, сборку кастомного системного промпта + живую подстройку стиля + рабочую тетрадь и расчёт гиперпараметров `temperature` / `thinkingBudgetTokens`.

8. **API-контроллер настроек интеллекта ИИ (`apps/api/src/ai-intelligence-routes.ts`)**:
   - Изолированный по `owner_id` контроллер (`handleGetSettings`, `handleUpdateSettings`, `handlePrepareCognitiveTurn`, `Cache-Control: no-store`), позволяющий читать и сохранять `customSystemPrompt`, переключатель `autoAdaptStyle`, режим мышления и автоматически обновлять выученный профиль стиля общения пользователя в SQLite.

## 3. Третья фаза пакета: In-Context Few-Shot (MMR), Дерево мыслей (Tree-of-Thoughts), U-образная раскладка контекста и Обучение на обратной связи

9. **Динамический селектор Few-Shot эталонов с MMR-диверсификацией (`packages/core/src/dynamic-few-shot-selector.ts`)**:
   - Выбирает в пределах токен-бюджета (`maxTokensBudget`) наиболее релевантные и взаимно непохожие эталонные примеры «Запрос $\to$ Идеальный ответ» по формуле **Maximal Marginal Relevance (`MMR`, $\lambda = 0.7$)**, резко повышая точность генерации SQL-миграций, TypeScript-кода и аналитических таблиц без переобучения весов.

10. **Дерево мыслей и лучевой поиск гипотез (`packages/core/src/tree-of-thoughts-beam-search.ts`)**:
    - Вместо одной линейной цепочки рассуждений параллельно оценивает $B$ альтернативных ветвей мысли по 4 критериям (удовлетворение ограничений `40%`, подтверждённость фактами `30%`, техническая реализуемость `25%`, штраф за стоимость `-5%`), отсекает тупиковые ветви (`score < pruneThreshold`) и выбирает глобально оптимальный маршрут решения.

11. **U-образный переранжировщик контекста против эффекта «Потери в середине» (`packages/core/src/lost-in-the-middle-context-reranker.ts`)**:
    - Решает известную проблему деградации внимания LLM в середине длинного контекста (*Lost-in-the-Middle*): размещает самые важные факты и обязательные ограничения пользователя на пиках внимания — в самом начале (**Primacy**, ранги `#1, #3, #5`) и в самом конце перед вопросом (**Recency**, ранги `#2, #4, #6`), смещая второстепенный фон в середину.

12. **Долговременное обучение предпочтениям по неявной обратной связи (`packages/db/src/implicit-feedback-preference-learner.ts`)**:
    - Извлекает правила из естественных реплик пользователя в диалоге («без воды», «сравни в таблице», «собери в отдельный пакет», «без заглушек») и сохраняет их в таблицу SQLite `kosmora_user_implicit_preferences`.
    - При положительном подкреплении («отлично», «хорошо работаем», «давай дальше») автоматически повышает уверенность (`confidence`) активных правил по экспоненциальному скользящему среднему (`EMA`).

## 4. Четвёртая фаза пакета: Нейро-символьный решатель ограничений (CSP/SMT), Многошаговый декомпозитор запросов, Статический верификатор кода/SQL и Компилятор LaTeX2e (`.tex`)

13. **Нейро-символьный решатель задач удовлетворения ограничений и оптимизации (`packages/core/src/neuro-symbolic-constraint-solver.ts`)**:
    - Реализует конечный дискретный CSP/SMT-Lite решатель с эвристикой **Minimum Remaining Values (`MRV`)** и отсечением **Forward-Checking**.
    - Поддерживает ограничения `all_different`, `precedence` ($t_{\text{after}} - t_{\text{before}} \ge \Delta$), линейные бюджетные неравенства ($\sum w_i x_i \le B$ и $\ge L$), а также оптимизацию целевой функции (`minimize` / `maximize`).

14. **Семантический многошаговый декомпозитор запросов (`packages/core/src/multi-hop-query-decomposer.ts`)**:
    - Разбивает составные запросы пользователя на направленный ациклический граф (`DAG`) атомарных подвопросов (`vault_document`, `sql_database`, `context_memory`, `web_search`, `analytical_comparison`, `code_synthesis`) и группирует независимые поисковые шаги в параллельную **Волну 0 (`Wave 0`)**, а финальное сравнение и синтез кода — в **Волну 1 (`Wave 1`)**.

15. **Статический Pre-Flight верификатор генерируемого кода и SQL-миграций (`packages/core/src/code-and-sql-preflight-verifier.ts`)**:
    - До выполнения или отправки кода пользователю проверяет SQL-миграции на идемпотентность (`CREATE TABLE IF NOT EXISTS`, `CREATE TRIGGER IF NOT EXISTS`), блокирует деструктивные `DROP TABLE` и `DELETE FROM` без `WHERE`, проверяет баланс скобок `{}[]()` вне строк и комментариев, а также защищает зарезервированные файлы параллельной разработки Codex.

16. **Десктопный компилятор технических спецификаций и научных статей LaTeX2e (`desktop/windows/workspace/latex-technical-spec-builder.cjs`)**:
    - Генерирует готовые к вёрстке `.tex` документы (`\documentclass[11pt,a4paper]{article}`) с поддержкой кириллицы (`T2A`, `babel`), окружений `\begin{theorem}`, математических формул `\begin{equation}`, таблиц `booktabs` (`\toprule`, `\midrule`, `\bottomrule`), библиографии `\bibitem` и криптографической подписи происхождения `% KOSWORK_PROVENANCE_SHA256`.

## 5. Пятая фаза пакета: Консолидация памяти по кривой Эббингауза, Байесовская калибровка уверенности, Синтезатор цепочек инструментов и Компилятор архитектурных диаграмм SVG/Mermaid/DOT

17. **Консолидатор эпизодической памяти в семантическую по кривой забывания Эббингауза (`packages/db/src/ebbinghaus-memory-consolidator.ts`)**:
    - Таблица `kosmora_memory_retention_traces` (миграция `0063`).
    - Рассчитывает экспоненциальное удержание памяти $R(t) = e^{-\Delta t / S}$, увеличивает стабильность следа $S$ при каждом повторном обращении (принцип интервального повторения SuperMemo SM-2), автоматически переводит часто востребованные факты (`recallCount >= 3`) в постоянную семантическую память (`semantic_consolidated`), а забытые разовые реплики (`R(t) < 0.20`) отправляет в холодный архив (`archived_cold`).

18. **Байесовский калибратор эпистемической уверенности и аудитор Brier Score / ECE (`packages/core/src/bayesian-confidence-calibrator.ts`)**:
    - Устраняет типичную для LLM самоуверенность: вычисляет ошибку калибровки по 10 корзинам вероятностей (`Expected Calibration Error`, `ECE`) и оценку Брайера (`Brier Score`), автоматически подбирая оптимальный температурный делитель логитов $p_{\text{cal}} = \sigma(\text{logit}(p_{\text{raw}}) / T_{\text{opt}})$.

19. **Семантический синтезатор цепочек инструментов и графа потоков данных (`packages/core/src/semantic-tool-chain-synthesizer.ts`)**:
    - Отбирает под конкретный запрос только релевантные инструменты, экономя 60–80% токенов на JSON-схемах, и топологически выстраивает цепочку `Producer -> Consumer` (проверяя, что выход первого инструмента `vaultFileId` подаётся на вход следующего `vault_extract_pdf`).

20. **Десктопный компилятор послойных архитектурных схем в SVG, Mermaid и Graphviz DOT (`desktop/windows/workspace/architecture-diagram-svg-builder.cjs`)**:
    - Без внешних зависимостей раскладывает вершины графа по иерархическим слоям (`layer 0, 1, 2...`), рассчитывает координаты $(x, y)$ и одновременно генерирует векторную диаграмму `.svg` со стрелками `<marker id="arrow">`, исходник `.mmd` (`flowchart TD`) и `.dot` (`digraph KosmoraArchitecture`).

## 6. Шестая фаза пакета: Personalized PageRank (GraphRAG), Генератор контрпримеров Red-Team, Парный судья ответов (A/B Judge) и Генератор контрактов OpenAPI 3.1

21. **Персонализированный PageRank и экстрактор связных подграфов для GraphRAG (`packages/core/src/personalized-pagerank-subgraph-extractor.ts`)**:
    - Вычисляет стационарное распределение случайного блуждания с возвратом (**Random Walk with Restart**, $\alpha = 0.15$) от стартовых сущностей запроса (`seedNodeIds`) методом степенных итераций.
    - Находит промежуточные «узлы-мосты» (`bridgePathsFound`) и индуцированный подграф между сущностями, которые не связаны напрямую в одном документе.

22. **Генератор состязательных контрпримеров и краевых тестов Red-Team (`packages/core/src/adversarial-counterexample-generator.ts`)**:
    - Автоматически синтезирует проверочные векторы для любого компонента: переполнение `MAX_SAFE_INTEGER` и `-0`, разрыв суррогатных пар UTF-16 на границах чанков, обход пути `../` с нулевым байтом `\0`, гонки дублирующихся `clientRequestId` и обратный скачок системных часов NTP (`clock skew`).

23. **Семантический парный судья ответов и детектор регрессий (`packages/core/src/semantic-ab-response-judge.ts`)**:
    - Объективно сравнивает два варианта ответа ИИ (`Candidate A` vs `Candidate B`) по 5 взвешенным рубрикам: соблюдение ограничений пользователя (`35%`), плотность верифицированных ссылок `[Источник](https://...)` (`25%`), структурная чистота таблиц/кода (`15%`), отсутствие заглушек `TODO` (`15%`) и отсутствие шаблонной «воды» (`10%`).

24. **Десктопный генератор спецификаций OpenAPI 3.1.0 и TypeScript-контрактов (`desktop/windows/workspace/openapi-contract-bundle-builder.cjs`)**:
    - Без внешних библиотек компилирует описания эндпоинтов в валидный файл `.openapi.json` (стандарт OpenAPI `3.1.0`) и строго типизированные интерфейсы `.contracts.d.ts` в рабочей папке пользователя с криптографическим слепком `SHA-256`.

## 7. Седьмая фаза пакета: Вывод по аналогии (Structure-Mapping CBR), Пробинг по приросту информации Шеннона, Потоковые скетчи HyperLogLog + Count-Min Sketch и Серверный мост MCP (JSON-RPC 2.0)

25. **Абстрактный вывод по аналогии и структурному изоморфизму (`packages/core/src/analogical-case-based-reasoner.ts`)**:
    - Реализует теорию структурного отображения Гентнер (*Structure-Mapping Theory*): сопоставляет новую инженерную задачу с проверенными архитектурными решениями из других предметных областей по графу отношений (`buffers`, `guards`, `transforms`, `verifies`), автоматически подставляя новые роли в доказанный скелет решения.

26. **Активный пробинг гипотез по максимуму прироста информации Шеннона (`packages/core/src/information-gain-active-prober.ts`)**:
    - При наличии $K$ конкурирующих гипотез сбоя вычисляет энтропию Шеннона $H(P) = -\sum P(H_i) \log_2 P(H_i)$ и выбирает единственный диагностический тест или вопрос, максимизирующий взаимную информацию $\text{IG}(H; Q) = H(H) - \mathbb{E}[H(H \mid Q)]$.

27. **Сублинейные потоковые скетчи HyperLogLog (`256 B`) и Count-Min Sketch (`packages/db/src/hyperloglog-and-count-min-sketch.ts`)**:
    - Таблица `kosmora_stream_sketch_snapshots` (миграция `0063`).
    - Оценивает количество уникальных сущностей/токенов в потоке за $O(1)$ памяти (256 регистров HyperLogLog с поправкой LinearCounting на малых выборках) и частоту самых частых элементов (`heavy hitters`) через 4-строчную матрицу Count-Min Sketch.

28. **Десктопный серверный мост протокола Model Context Protocol (`MCP` / JSON-RPC 2.0) (`desktop/windows/ci/mcp-tool-server-bridge.cjs`)**:
    - Полная локальная реализация JSON-RPC 2.0 / MCP (`2025-06-18`) для методов `initialize`, `tools/list` и `tools/call` с валидацией аргументов по JSON Schema и блокировкой модифицирующих вызовов без явного флага согласия пользователя (`MCP_CONSENT_REQUIRED`).

## 8. Восьмая фаза пакета: Диалектический синтез (Тезис–Антитезис–Синтез), Символьный математический и размерностный верификатор (PAL), Суффиксный массив (Suffix Array + LCP) и Десктопный билдер SARIF 2.1.0 + Атомарный патчер Unified Diff

29. **Диалектический синтезатор и «Адвокат дьявола» (`packages/core/src/dialectical-debate-synthesizer.ts`)**:
    - Устраняет склонность LLM к поддакиванию (*sycophancy*) и предвзятости подтверждения: подвергает каждый архитектурный план (**Тезис**) автоматической атаке со стороны «Адвоката дьявола» (**Антитезис** — проверка на OOM при 1 ГБ RAM, нарушение офлайн-режима, гонки параллельной записи, инъекции и непроверенные допущения) и формирует защищённый **Синтез** с оценкой устойчивости (`dialecticalRobustnessScore`).

30. **Символьный математический и размерностный верификатор (`packages/core/src/pal-symbolic-math-verifier.ts`)**:
    - Контролирует физические и вычислительные размерности (`bytes`, `KiB`/`MiB`/`GiB` vs `KB`/`MB`/`GB`, `milliseconds`, `tokens`, `usd`), блокируя некорректное сложение разнородных величин (`DIMENSIONAL_MISMATCH`).
    - Точно считает композитную надёжность SLA для последовательных и резервированных контуров, а также проверяет встроенные арифметические равенства в тексте черновика (`auditInlineEquations`).

31. **Суффиксный массив и массив наибольших общих префиксов Касаи (`packages/db/src/suffix-array-substring-index.ts`)**:
    - Таблица `kosmora_suffix_array_snapshots` (миграция `0063`).
    - Находит любые точные подстроки внутри кода и логов (включая части имён функций и скобочные конструкции вроде `prepare(query).all()`) за $O(P \log N)$ бинарным поиском по суффиксному массиву и мгновенно обнаруживает самые длинные дублирующиеся куски кода (`findLongestRepeatedClone`) за $O(N)$ по массиву `LCP`.

32. **Десктопный генератор отчётов статического анализа SARIF 2.1.0 и атомарный применитель Unified Diff патчей (`desktop/windows/workspace/sarif-and-patch-bundle-builder.cjs`)**:
    - Формирует совместимые с GitHub / VS Code отчёты безопасности в стандарте OASIS **SARIF 2.1.0** (`.sarif.json`).
    - Атомарно применяет многоблочные патчи `@@ -l,s +l,s @@` с побайтовой проверкой контекстных и удаляемых строк, гарантируя полный откат (`HUNK_CONTEXT_MISMATCH` / `HUNK_DELETE_MISMATCH`) при малейшем расхождении исходника.

## 9. Монументальный блок: Автономное микроядро Kosmora OS, Саги с транзакционным Outbox, HTN/STRIPS планировщик, Парето-оптимизатор NSGA-II, BPE-тренер, BM25F+CrossEncoder, Macaroon-токены и Сообщества GraphRAG (Модули 33–44)

33. **Микроядро акторов с приоритетными почтовыми ящиками и супервизией Erlang/Akka (`packages/core/src/actor-mailbox-microkernel.ts`)**:
    - Изолированное состояние каждого актора, очереди сообщений `high -> normal -> background`, стратегии самовосстановления супервизора (`restart`, `resume`, `stop`, `escalate`) и очередь недоставленных писем (`Dead-Letter Queue`).

34. **Координатор распределённых саг с транзакционным Outbox и LIFO-компенсацией (`packages/db/src/saga-and-transactional-outbox.ts`)**:
    - Таблицы `kosmora_saga_executions` и `kosmora_transactional_outbox` (миграция `0063`).
    - Выполняет цепочку прямых шагов $T_1 \dots T_n$, а при сбое на шаге $T_k$ автоматически запускает компенсирующие транзакции $C_{k-1} \dots C_1$ в строго обратном порядке (`LIFO`).

35. **Символьный планировщик иерархических сетей задач (`HTN`) и классический A* STRIPS/PDDL (`packages/core/src/htn-symbolic-goal-planner.ts`)**:
    - Декомпозирует составные задачи (`CompoundTaskMethod`) в примитивные операторы с проверкой предусловий (`preconditions`, `negatedPreconditions`) и эффектов (`addEffects`, `deleteEffects`), а также строит кратчайшие планы достижения целей алгоритмом `A*`.

36. **Многокритериальный оптимизатор границы Парето `NSGA-II` (`packages/core/src/pareto-frontier-optimizer.ts`)**:
    - Вычисляет недоминируемые фронты Парето ($F_1, F_2 \dots$) и дистанцию скученности (`crowdingDistance`) одновременно по 4 осям: Качество (`max`), Задержка (`min`), Стоимость (`min`) и Приватность (`max`).

37. **Тренер словаря Byte-Pair Encoding (`BPE`) и субсловный токенизатор (`packages/core/src/bpe-vocabulary-trainer.ts`)**:
    - Обучает таблицу слияний пар байтов (`BpeMergeRule`) на корпусе предметной области, сжимает UTF-8 строки в субсловные токены (`encode`) и восстанавливает исходный текст без потерь (`decode`).

38. **Многополевой лексический ранжировщик `BM25F` + парный `Cross-Encoder` (`packages/core/src/bm25f-and-cross-encoder-reranker.ts`)**:
    - Взвешивает поля документа (`title` $\times 3.0$, `tags` $\times 2.5$, `body` $\times 1.0$) по формуле Робертсона `BM25F` и переранжирует кандидатов с учётом точных фразовых совпадений и смежности биграмм запроса.

39. **Детектор дрейфа цели в длинных диалогах (`packages/core/src/conversation-goal-drift-tracker.ts`)**:
    - Отслеживает отклонение промежуточных шагов от исходной макро-цели пользователя и автоматически формирует директиву возврата к цели (`[GOAL_DRIFT_REANCHORING_DIRECTIVE]`).

40. **Криптографические капабилити-токены `Macaroons` с цепочкой ограничений HMAC (`packages/core/src/macaroon-capability-tokens.ts`)**:
    - Позволяют субагентам автономно сужать права токена офлайн (`owner_id`, `allowed_tool`, `read_only=true`, `expires_before_ms`, `max_budget_usd`) через вложенную цепочку `HMAC-SHA256`.

41. **Детектор сообществ графа знаний (`Label Propagation + Modularity Q`) (`packages/db/src/graph-community-summarizer.ts`)**:
    - Таблица `kosmora_graph_communities` (миграция `0063`). Разбивает граф знаний на плотные кластеры, вычисляет модулярность Ньюмана — Гирвана $Q$, находит центральные хабы (`hubNodeId`) и сохраняет сводки сообществ для глобальных запросов GraphRAG.

42. **Единый контроллер рантайма автономного ядра ОС (`apps/api/src/autonomous-os-kernel-runtime.ts`)**:
    - Связывает верификацию Macaroon-токенов, поиск `BM25F + Cross-Encoder`, планирование `HTN`, выбор маршрута Парето, контроль дрейфа цели, `CognitiveTurnOrchestrator` и транзакционную сагу в единый конвейер миссии (`executeAutonomousKernelMission`).

43. **Десктопный трёхформатный компилятор документов `RTF 1.9.1` + `Markdown` + `Plain Text` (`desktop/windows/workspace/rtf-and-markdown-bundle-builder.cjs`)**:
    - Генерирует документы `.rtf` с поддержкой кириллицы и Unicode (`\uN?`), открывающиеся в WordPad, MS Word и LibreOffice без внешних библиотек, одновременно с `.md` и `.txt`.

44. **Бенчмарк-стенд SLA для всех 44 модулей (`scripts/benchmark-kosmora-intelligence-and-os-kernel.mjs`)**:
    - Проверяет скорость работы решателя ограничений, PageRank, верификатора Macaroons (`> 5 000 ops/sec`), суффиксного массива Касаи и BPE-кодека.


## Фаза 10: Распределённый консенсус, формальная LTL-верификация, метаэвристики и корпоративные движки хранения (Модули 45–60)
45. `packages/core/src/raft-consensus-state-machine.ts` — `RaftConsensusNode`: детерминированный конечный автомат распределённого консенсуса Raft (`RequestVote`, `AppendEntries`, гарантии Election Safety, Log Matching и кворумная фиксация `commitIndex`).
46. `packages/core/src/ltl-temporal-model-checker.ts` — `LtlTemporalModelChecker`: формальная проверка темпоральной логики (LTL) на трассах выполнения (`always_globally`, `eventually`, `until`, `response_leads_to`, `mutual_exclusion`) с выдачей минимального контрпримера.
47. `packages/core/src/simulated-annealing-tabu-optimizer.ts` — `SimulatedAnnealingTabuOptimizer`: гибридная комбинаторная метаэвристика имитации отжига (принятие Больцмана $\exp(-\Delta E / T)$) и краткосрочной памяти Tabu Search с критерием аспирации.
48. `packages/db/src/lsm-tree-sstable-engine.ts` — `LsmTreeSstableEngine`: движок хранения на базе Log-Structured Merge-Tree с сортированной MemTable, надгробиями (`tombstones`), граничными указателями (`minKey`/`maxKey`) и компактизацией SSTable в SQLite (`kosmora_lsm_sstables`).
49. `packages/core/src/linucb-contextual-bandit.ts` — `LinUcbContextualBandit`: контекстуальный бандит с гребневой регрессией $\mathbf{A}_a = \mathbf{I}_d + \sum \mathbf{x}\mathbf{x}^\top$, обращением матриц методом Гаусса — Жордана и доверительным эллипсоидом $\alpha \sqrt{\mathbf{x}^\top \mathbf{A}_a^{-1} \mathbf{x}}$.
50. `packages/core/src/viterbi-intent-decoder.ts` — `ViterbiIntentDecoder`: декодер скрытых марковских моделей (HMM) по алгоритму Витерби в логарифмическом пространстве ($\log P$) для восстановления скрытой траектории фаз сессии пользователя.
51. `packages/core/src/dempster-shafer-evidence-fusion.ts` — `DempsterShaferEvidenceFusion`: теория свидетельств Демпстера — Шефера с явным учётом эпистемического незнания ($\Theta = \text{"*"}$), правилом комбинирования Демпстера и интервалами $[\text{Belief}, \text{Plausibility}]$.
52. `packages/core/src/aho-corasick-scanner.ts` — `AhoCorasickAutomaton`: конечный автомат Ахо — Корасик с суффиксными ссылками неудач (BFS failure links) для однопроходного линейного поиска $O(N + M + Z)$ тысяч шаблонов и сигнатур безопасности.
53. `packages/core/src/myers-diff-engine.ts` — `MyersDiffEngine`: вычисление минимального редакционного предписания (SES / LCS) и генерация патчей в формате Unified Diff.
54. `packages/core/src/speculative-decoding-verifier.ts` — `SpeculativeDecodingVerifier`: верификатор спекулятивного декодирования (Leviathan/Chen) с критерием принятия $\min(1, p(x)/q(x))$ и бонусным токеном без потери точности целевого распределения.
55. `packages/core/src/ring-buffer-backpressure-controller.ts` — `CircularRingBuffer`: предвыделенный кольцевой буфер без аллокаций сборщика мусора с гистерезисом водяных знаков (`PAUSE_PRODUCER` / `RESUME_PRODUCER`).
56. `packages/core/src/rbac-abac-policy-engine.ts` — `RbacAbacPolicyEngine`: движок авторизации RBAC + ABAC (Policy Decision Point) с иерархическим наследованием ролей, мандатными уровнями допуска и алгоритмами комбинирования XACML (`deny-overrides`, `permit-overrides`, `first-applicable`).
57. `packages/db/src/timeseries-delta-compressor.ts` — `TimeSeriesDeltaCompressor`: сжатие временных рядов телеметрии в стиле Facebook Gorilla (Delta-of-Delta для меток времени + дельты значений) с хранением блоков в SQLite (`kosmora_timeseries_blocks`).
58. `packages/core/src/drf-fair-share-scheduler.ts` — `DominantResourceFairnessScheduler`: многоресурсный планировщик Dominant Resource Fairness (DRF) по CPU, RAM и токенам с гарантией Парето-эффективности и защиты от зависти (envy-freeness).
59. `desktop/windows/workspace/ical-and-vcard-bundle-builder.cjs` — генератор расписаний RFC 5545 iCalendar (`.ics`) с напоминаниями `VALARM` и карточек контактов RFC 6350 vCard 4.0 (`.vcf`) с защитой от обхода директорий (`PATH_TRAVERSAL_BLOCKED`).
60. `apps/api/test/distributed-formal-and-storage-frontier.test.ts` и `desktop/windows/test/ical-and-vcard-bundle-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 10.


## Фаза 11: Вероятностные графовые модели, многослойный HNSW-индекс, колоночное RLE-хранилище, парсер Эрли и самовосстанавливающаяся ячеистая сеть (Модули 61–76)
61. `packages/core/src/factor-graph-belief-propagation.ts` — `FactorGraphBeliefPropagation`: итеративное распространение доверия (Loopy Sum-Product Belief Propagation) на двудольных фактор-графах с демпфированием сообщений для многосигнальной диагностики первопричин сбоев и вычисления апостериорного максимума (MAP).
62. `packages/core/src/hnsw-vector-index.ts` — `HnswHierarchicalVectorIndex`: многослойный иерархический граф малого мира (HNSW) для сублинейного $O(\log N)$ поиска ближайших семантических векторов (`efConstruction`, `efSearch`, эвристическое усечение связей).
63. `packages/db/src/columnar-rle-bitpacking-store.ts` — `ColumnarRleBitPackingStore`: аналитическое колоночное хранилище в стиле Apache Parquet / DuckDB (`kosmora_columnar_stripes`) со словарным кодированием, RLE-сжатием серий, расчётом битовой ширины и отсечением страйпов по Zone-Map (`min`/`max` predicate pushdown) без декодирования.
64. `packages/core/src/earley-chart-parser.ts` — `EarleyChartParser`: универсальный табличный парсер контекстно-свободных грамматик по алгоритму Эрли (`Predictor`, `Scanner`, `Completer`) с поддержкой леворекурсивных правил и генерацией допустимых синтаксических продолжений.
65. `packages/core/src/auction-hungarian-task-assigner.ts` — `HungarianKuhnMunkresAssigner`: точный венгерский алгоритм Куна — Манкреса $O(N^3)$ с двойственными потенциалами $(u, v)$ для глобально оптимального назначения задач специализированным ИИ-агентам.
66. `packages/core/src/swims-phi-accrual-failure-detector.ts` — `PhiAccrualFailureDetector`: непрерывный детектор отказов Хayaшибары ($\Phi$-Accrual) + конечный автомат членства SWIM (`ALIVE`, `SUSPECT`, `DEAD`) с опровержением ложных подозрений через инкремент номера инкарнации (`refuteSuspicion`).
67. `packages/core/src/t-digest-streaming-quantiles.ts` — `TDigestStreamingQuantiles`: потоковый алгоритм Даннинга $t$-Digest с масштабирующей функцией $\arcsin$ для высокоточной оценки хвостовых квантилей задержки (`p50`, `p95`, `p99`, `p99.9`) в ограниченной памяти.
68. `packages/core/src/minhash-lsh-deduplicator.ts` — `MinHashLshNearDuplicateIndex`: сигнатуры Бродера $k$-Shingle MinHash и полосовое локально-чувствительное хеширование (Banded LSH) для мгновенного поиска нечётких дубликатов документов и промптов.
69. `packages/core/src/wrr-edf-realtime-scheduler.ts` — `EdfAndWeightedRoundRobinScheduler`: планировщик жёсткого реального времени Earliest Deadline First (EDF) с проверкой критерия выполнимости Лю — Лейленда $\sum \frac{C_i}{T_i} \le 1$ и плавной взвешенной каруселью Nginx Smooth Weighted Round-Robin (SWRR).
70. `packages/core/src/page-replacement-arc-cache.ts` — `AdaptiveReplacementCacheArc`: самонастраивающийся кэш замещения страниц Мегиддо — Модхи **ARC** с четырьмя списками ($T_1, T_2, B_1, B_2$) и онлайн-адаптацией параметра $p \in [0, c]$ против загрязнения сканированием.
71. `packages/core/src/consistent-hash-bounded-load.ts` — `ConsistentHashBoundedLoadRing`: кольцо консистентного хеширования с виртуальными узлами и строгим ограничением перегрузки $(1 + \epsilon)$ (Mirrokni Bounded-Load Consistent Hashing).
72. `packages/core/src/boolean-dpll-cdcl-sat-solver.ts` — `DpllCdclSatSolver`: решатель булевой выполнимости (SAT) на базе DPLL с единичным распространением (Unit Propagation), исключением чистых литералов и эвристикой ветвления MOMS.
73. `packages/db/src/event-sourcing-cqrs-projector.ts` — `EventSourcingCqrsProjector`: неизменяемый журнал событий Event Sourcing и проектор материализованных представлений CQRS (`kosmora_event_store_stream`, `kosmora_event_store_snapshots`) с оптимистичной блокировкой версий (`EXPECTED_VERSION_CONFLICT`), автоматическими снапшотами и историческим воспроизведением состояния (`upToVersion`).
74. `packages/core/src/haar-wavelet-multiresolution-analyzer.ts` — `HaarWaveletMultiResolutionAnalyzer`: многомасштабное дискретное вейвлет-преобразование Хаара (DWT), мягкая пороговая фильтрация шума Донохо VisuShrink ($\lambda = \sigma \sqrt{2 \ln N}$) и детекция импульсных всплесков нагрузки.
75. `desktop/windows/workspace/junit-and-tap-report-builder.cjs` — генератор отчётов верификации **JUnit XML (`.junit.xml`)** и **TAP v14 (`.tap`)** с экранированием XML-сущностей и защитой от обхода путей.
76. `apps/api/test/probabilistic-vector-columnar-and-mesh-frontier.test.ts` и `desktop/windows/test/junit-and-tap-report-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 11.


## Фаза 12: Помехоустойчивое кодирование Рида — Соломона, византийский кворум PBFT, B+Tree MVCC, изолирующий лес и минимизация автоматов (Модули 77–92)
77. `packages/core/src/reed-solomon-erasure-coder.ts` — `ReedSolomonGaloisErasureCoder`: помехоустойчивое кодирование Рида — Соломона над полем Галуа $\text{GF}(2^8)$ (неприводимый полином $x^8 + x^4 + x^3 + x + 1$) с матрицей Коши — Вандермонда и точным восстановлением потерянных шардов методом Гаусса — Жордана.
78. `packages/core/src/pbft-byzantine-quorum-verifier.ts` — `PbftByzantineQuorumEngine`: трёхфазный византийский консенсус **PBFT** Кастро — Лисков (`PRE-PREPARE`, `PREPARE`, `COMMIT`) с допуском до $f$ произвольных/галлюцинирующих реплик при $N \ge 3f + 1$ и кворумом $2f + 1$.
79. `packages/db/src/bplus-tree-mvcc-index.ts` — `BPlusTreeMvccIndexEngine`: многоверсионный индекс диапазонов **MVCC B+Tree** (`kosmora_mvcc_bptree_records`) с интервалами видимости `[xmin_tx, xmax_tx)`, изоляцией снапшотов без блокировки читателей и сборкой мусора `vacuumObsoleteVersions`.
80. `packages/core/src/isolation-forest-anomaly-detector.ts` — `IsolationForestAnomalyDetector`: ансамбль изолирующих деревьев **Isolation Forest (iForest)** с нормализацией длины пути через гармоническое число Эйлера $c(n) = 2H(n-1) - \frac{2(n-1)}{n}$ для неконтролируемой детекции многомерных аномалий.
81. `packages/core/src/raptorq-fountain-luby-transform.ts` — `LubyTransformFountainCodec`: безразмерный фонтанный кодек преобразования Люби (**LT Fountain Code**) с каскадным декодером распространения доверия (*Belief-Propagation Ripple Peeling Decoder*).
82. `packages/core/src/dinic-max-flow-min-cut.ts` — `DinicMaxFlowMinCutEngine`: алгоритм Диница $O(V^2 E)$ на слоистых сетях и блокирующих потоках для расчёта максимальной пропускной способности пайплайна агентов и точного минимального разреза (**Min-Cut**).
83. `packages/core/src/tarjan-scc-and-2sat-solver.ts` — `TarjanSccAndTwoSatEngine`: линейный алгоритм Тарьяна $O(V + E)$ выделения компонент сильной связности (**SCC**) и линейный решатель **2-SAT** на графе импликаций.
84. `packages/core/src/thompson-contextual-gaussian-process.ts` — `GaussianProcessBayesianOptimizer`: регрессия гауссовских процессов (**Gaussian Process**) с RBF-ядром и функциями приобретения **GP-UCB** и **Expected Improvement (EI)** для байесовской оптимизации гиперпараметров.
85. `packages/core/src/token-bucket-hierarchical-htb-shaper.ts` — `HierarchicalTokenBucketShaper`: иерархический шейпер трафика и квот токенов **HTB (Hierarchical Token Bucket)** с гарантированной скоростью (`CIR`), потолком (`PIR`) и заимствованием полосы у родительского бакета.
86. `packages/core/src/smith-waterman-local-aligner.ts` — `SmithWatermanLocalAligner`: алгоритм локального выравнивания последовательностей **Смита — Ватермана** для поиска консервативных фрагментов кода, трасс стека и промптов.
87. `packages/core/src/savitzky-golay-kalman-smoother.ts` — `SavitzkyGolayAndRtsSmoother`: полиномиальный фильтр **Савицкого — Голея** (с аналитической оценкой первой производной скорости) и двухпроходный сглаживатель Калмана **Рауха — Танга — Штрибеля (RTS)**.
88. `packages/core/src/bloom-cuckoo-xor-filter.ts` — `XorFilterStaticMembershipIndex`: 16-битный фильтр **Xor Filter** Графа — Лемира ($\approx 1{,}23\times$ слотов) с построением через 3-гиперграфовое очищение (peeling) и проверкой принадлежности за 3 операции XOR без ложноотрицательных срабатываний.
89. `packages/db/src/distributed-lock-fencing-lease-manager.ts` — `FencingTokenLeaseManager`: менеджер распределённых арендных блокировок с монотонными ограждающими токенами (**Kleppmann Fencing Tokens**, `kosmora_fencing_leases`) для защиты хранилища от «зомби»-воркеров (`STALE_FENCING_TOKEN_REJECTED`).
90. `packages/core/src/hopcroft-dfa-minimizer.ts` — `RegexNfaToMinDfaCompiler`: минимизация детерминированных конечных автоматов по алгоритму **Хопкрофта** с гарантированным линейным временем исполнения $O(N)$ без возвратов (защита от ReDoS).
91. `desktop/windows/workspace/sbom-cyclonedx-and-spdx-builder.cjs` — генератор паспортов безопасности цепочки поставок ПО (**CycloneDX 1.5 `.cdx.json`** и **SPDX 2.3 `.spdx.json`**) с идентификаторами `purl` и контрольными суммами SHA-256.
92. `apps/api/test/erasure-pbft-mvcc-and-automata-frontier.test.ts` и `desktop/windows/test/sbom-cyclonedx-and-spdx-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 12.


## Фаза 13: Коллаборативные последовательности RGA-CRDT, вероятностный SkipList, спектральное разбиение Фидлера, срез Чанди — Лампорта, аукцион VCG и пространственный R-Tree индекс (Модули 93–108)
93. `packages/core/src/rga-woot-sequence-crdt.ts` — `RgaSequenceTextCrdt`: коммутативный текстовый и списочный CRDT **Replicated Growable Array (RGA)** с логическими часами Лампорта, привязкой к левому предку и гарантией сильной конечной согласованности (SEC).
94. `packages/core/src/skip-list-concurrent-index.ts` — `ProbabilisticSkipListIndex`: многоуровневый вероятностный список с пропусками (**Skip List** Пью) для поиска, вставки, удаления и сканирования диапазонов `[startKey, endKey]` за $O(\log N)$.
95. `packages/core/src/spectral-fiedler-graph-partitioner.ts` — `SpectralFiedlerGraphPartitioner`: спектральная кластеризация графа через матрицу Лапласа $\mathbf{L} = \mathbf{D} - \mathbf{A}$ и вычисление **вектора Фидлера** ($\mathbf{v}_2$, алгебраическая связность $\lambda_2$) методом степенных итераций со сдвигом и ортогональной дефляцией.
96. `packages/core/src/chandy-lamport-distributed-snapshot.ts` — `ChandyLamportSnapshotCoordinator`: алгоритм распределённого глобального снимка состояния **Чанди — Лампорта** на маркерных сообщениях с фиксацией транзитных сообщений в каналах без остановки узлов.
97. `packages/core/src/nelder-mead-simplex-optimizer.ts` — `NelderMeadSimplexOptimizer`: безградиентный симплекс-метод **Нелдера — Мида** в $\mathbb{R}^d$ (отражение, растяжение, сжатие, редукция) для оптимизации недифференцируемых целевых функций.
98. `packages/core/src/pid-autoscaler-controller.ts` — `PidAntiWindupController`: промышленный замкнутый **ПИД-регулятор** автоскейлинга с защитой от интегрального насыщения (*Integral Anti-Windup*) и НЧ-фильтрацией производной.
99. `packages/core/src/burrows-wheeler-fm-index.ts` — `BurrowsWheelerTransformCodec`: обратимое блочное преобразование **Барроуза — Уилера (BWT)** + кодирование **Move-To-Front (MTF)** + точное обратное восстановление через $LF$-отображение.
100. `packages/core/src/wagner-fischer-damerau-levenshtein.ts` — `DamerauLevenshteinFuzzyAutomaton`: метрика **Дамерау — Левенштейна** (с учётом транспозиции соседних символов) + метрическое дерево **BK-Tree** (отсечение по неравенству треугольника) для нечёткого исправления опечаток.
101. `packages/core/src/vickrey-clarke-groves-mechanism.ts` — `VcgTruthfulMechanismAuction`: стратегически честный комбинаторный аукцион **Викри — Кларка — Гровса (VCG)** с расчётом налога экстерналии Кларка (*Clarke Pivot Tax*).
102. `packages/core/src/kahan-compensated-online-moments.ts` — `WelfordHigherOrderMomentsTracker`: компенсированное суммирование **Кахана — Бабушки** и однопроходный расчёт среднего, дисперсии, асимметрии ($\gamma_1$) и эксцесса ($\gamma_2$) по формулам Пебая — Уэлфорда.
103. `packages/db/src/merkle-bplus-audit-ledger.ts` — `TamperEvidentAuditLedger`: криптографический журнал аудита (`kosmora_tamper_evident_ledger`) с хеш-цепочкой и корнем дерева Меркла для обнаружения любых подмен исторических записей.
104. `packages/db/src/spatial-rtree-bounding-index.ts` — `SpatialRTreeBoundingBoxIndex`: двумерный пространственный индекс ограничивающих прямоугольников **R-Tree (MBR)** (`kosmora_spatial_rtree_items`) с поиском пересечений и $k$ ближайших соседей по метрике *MINDIST*.
105. `packages/core/src/cbor-varint-wire-codec.ts` — `DeterministicBinaryWireCodec`: компактная бинарная сериализация **LEB128 / ZigZag Varint + канонический TLV-протокол** для межпроцессного обмена без накладных расходов JSON.
106. `packages/core/src/knuth-morris-pratt-rabin-karp.ts` — `KmpAndRabinKarpChunker`: линейный поиск подстрок **Кнута — Морриса — Пратта (KMP)** по префикс-функции и контентно-зависимое разбиение на чанки (**CDC Rabin-Karp Rolling Hash**).
107. `desktop/windows/workspace/har-and-curl-replay-builder.cjs` — генератор сетевых дампов **W3C HAR v1.2 (`.har`)** и воспроизводимых сценариев **POSIX `curl` (`.replay.sh`)** с автоматическим редактированием секретных заголовков (`Authorization`, `Cookie`, `X-Api-Key`).
108. `apps/api/test/crdt-spectral-vcg-and-spatial-frontier.test.ts` и `desktop/windows/test/har-and-curl-replay-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 13.


## Фаза 14: SSA-анализатор потока управления, вывод типов Хиндли — Милнера, двухфазный коммит (2PC) с графом взаимных блокировок, Patricia Radix-дерево, симплекс-решатель ЛП и продукционная сеть Rete (Модули 109–124)
109. `packages/core/src/lengauer-tarjan-dominator-ssa.ts` — `ControlFlowDominatorAndSsaAnalyzer`: расчёт непосредственных доминаторов (`idom`) по алгоритму Купера — Харви — Кеннеди, границ доминирования ($DF$), расстановка $\phi$-узлов **Static Single Assignment (SSA)** по алгоритму Цитрона и обратный анализ живучести переменных (`LiveIn` / `LiveOut`).
110. `packages/core/src/hindley-milner-type-inference.ts` — `HindleyMilnerAlgorithmWTypeEngine`: полиморфный вывод главных типов **Дамаса — Хиндли — Милнера (Algorithm W)** и унификация Робинсона с `let`-генерализацией $\forall \alpha.\,\tau$ и проверкой вхождения (*occurs check*).
111. `packages/db/src/two-phase-commit-and-deadlock-detector.ts` — `TwoPhaseCommitAndWaitForDeadlockEngine`: координатор атомарного двухфазного коммита (**2PC**, `kosmora_2pc_transactions`) и детектор циклов в графе ожидания (**Wait-For Graph Deadlock Detector**) с выбором самой молодой транзакции в качестве жертвы отката.
112. `packages/core/src/radix-patricia-compact-trie.ts` — `RadixPatriciaCompactTrie`: сжатое префиксное дерево Моррисона (**Patricia / Radix Trie**) со склейкой одиночных ветвей и поиском самого длинного совпадающего префикса (`findLongestPrefixMatch`).
113. `packages/core/src/gale-shapley-stable-matching.ts` — `GaleShapleyStableMatchingEngine`: алгоритм отложенного принятия **Гейла — Шепли** для устойчивого паросочетания с формальным верификатором отсутствия блокирующих пар.
114. `packages/core/src/floyd-warshall-johnson-apsp.ts` — `AllPairsShortestPathAndMinMeanCycleEngine`: алгоритм **Флойда — Уоршелла** поиска кратчайших путей между всеми парами вершин (APSP), детекции циклов отрицательного веса, расчёта диаметра, радиуса и центра графа.
115. `packages/core/src/interval-tree-augmented-avl.ts` — `AugmentedIntervalOverlapIndex`: дополненное интервальное дерево (CLRS) для поиска пересекающихся временных интервалов за $O(\log N + K)$ и расчёта пиковой конкурентности методом сканирующей прямой.
116. `packages/core/src/simplex-linear-programming-solver.ts` — `DantzigSimplexLinearProgramSolver`: табличный симплекс-метод **Данцига** для задач линейного программирования $\max \mathbf{c}^\top \mathbf{x}$ при $\mathbf{A}\mathbf{x} \le \mathbf{b}, \mathbf{x} \ge \mathbf{0}$ с извлечением прямых переменных и двойственных теневых цен.
117. `packages/core/src/huffman-canonical-ans-entropy-coder.ts` — `CanonicalHuffmanEntropyCodec`: префиксный энтропийный кодек **Хаффмана** с расчётом информационной энтропии Шеннона $H(X) = -\sum p_i \log_2 p_i$.
118. `packages/core/src/boyer-moore-horspool-sunday-matcher.ts` — `BoyerMooreHorspoolMatcher`: сублинейный поиск подстрок **Бойера — Мура — Хорспула** с таблицей сдвигов плохого символа $O(N / M)$.
119. `packages/core/src/page-hinkley-adwin-drift-detector.ts` — `PageHinkleyConceptDriftDetector`: последовательный критерий **Пейджа — Хинкли (PHT)** для онлайн-обнаружения концептуального дрейфа математического ожидания.
120. `packages/core/src/fenwick-segment-tree-range-aggregator.ts` — `LazySegmentAndFenwickTreeEngine`: дерево отрезков с отложенным проталкиванием (**Lazy Propagation Segment Tree**) для групповых прибавлений на отрезке и запросов суммы и максимума за $O(\log N)$.
121. `packages/db/src/hierarchical-timing-wheel-scheduler.ts` — `HierarchicalTimingWheelStore`: иерархическое колесо таймеров Варгезе — Лаука (**Timing Wheel**, `kosmora_timing_wheel_timers`) со сложностью постановки в очередь $O(1)$.
122. `packages/core/src/retinal-rete-forward-chaining-engine.ts` — `ForgyReteRuleEngine`: продукционный движок прямого логического вывода **Rete** Форги с $\alpha$-памятью, $\beta$-соединениями переменных, приоритетами *salience* и защитой от повторного срабатывания (*refraction*).
123. `desktop/windows/workspace/prometheus-and-otlp-bundle-builder.cjs` — экспортер телеметрии в текстовом формате **Prometheus OpenMetrics (`.prom`)** и **OpenTelemetry OTLP/JSON v1 (`.otlp.json`)**.
124. `apps/api/test/ssa-typeinference-2pc-and-lp-frontier.test.ts` и `desktop/windows/test/prometheus-and-otlp-bundle-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 14.


## Фаза 15: Канонические диаграммы решений ROBDD, поток минимальной стоимости MCMF, суффиксный автомат SAM, рейтинг Glicko-2, сжатие LZW, транспорт Синкхорна и точное покрытие Кнута DLX (Модули 125–140)
125. `packages/core/src/robdd-binary-decision-diagram.ts` — `ReducedOrderedBinaryDecisionDiagram`: канонические сокращённые упорядоченные бинарные диаграммы решений (**ROBDD** Брайанта) с разложением Шеннона, хеш-консингом (Unique Table) и точным подсчётом числа выполняющих наборов (`#SAT`) за $O(|G|)$.
126. `packages/core/src/min-cost-max-flow-spfa.ts` — `SuccessiveShortestPathMinCostMaxFlow`: поток минимальной стоимости и максимальной величины (**Min-Cost Max-Flow**) методом последовательных кратчайших увеличивающих путей (SPFA / Беллман — Форд).
127. `packages/core/src/suffix-automaton-sam-dawg.ts` — `SuffixAutomatonDirectedWordGraph`: линейный **суффиксный автомат (SAM / DAWG)** за $O(N)$ для подсчёта числа различных подстрок $\sum (\text{len}(u) - \text{len}(\text{link}(u)))$ и поиска наибольшей общей подстроки (LCS) за $O(|S_1| + |S_2|)$.
128. `packages/core/src/glicko2-bradley-terry-rating.ts` — `Glicko2AndBradleyTerrySkillEngine`: байесовская рейтинговая система **Glicko-2** Гликмана с отслеживанием рейтинга ($R$), эпистемического отклонения ($RD$) и волатильности ($\sigma$).
129. `packages/core/src/lzw-lz77-dictionary-compressor.ts` — `LempelZivWelchDictionaryCodec`: адаптивный словарный кодек без потерь **Лемпеля — Зива — Велча (LZW)**.
130. `packages/core/src/disjoint-set-kruskal-mst.ts` — `DisjointSetAndSteinerMstEngine`: система непересекающихся множеств **Тарьяна (Union-Find)** со сжатием путей и ранговой эвристикой $\alpha(N)$ + алгоритм **Краскала** построения минимального остовного леса (MST).
131. `packages/core/src/cubic-spline-hermite-interpolator.ts` — `NaturalCubicSplineAndPchipInterpolator`: гладкая $C^2$-интерполяция **натуральными кубическими сплайнами** через трёхдиагональную прогонку Томаса (TDMA) за $O(N)$.
132. `packages/core/src/mann-kendall-theil-sen-trend.ts` — `TheilSenAndMannKendallTrendAnalyzer`: непараметрический критерий монотонного тренда **Манна — Кендалла** и робастная медианная оценка наклона **Тейла — Сена** (устойчивая к $29{,}3\%$ выбросов).
133. `packages/core/src/sinkhorn-knopp-earth-mover-ot.ts` — `EntropicOptimalTransportSinkhorn`: энтропийно-регуляризованный оптимальный транспорт (**расстояние Вассерштейна / Earth Mover's Distance**) через матричное масштабирование **Синкхорна — Кноппа**.
134. `packages/core/src/dancing-links-exact-cover-dlx.ts` — `KnuthAlgorithmXExactCoverSolver`: алгоритм Кнута **Algorithm X / Dancing Links (DLX)** с эвристикой минимального ветвления (S-heuristic) для задачи о точном покрытии.
135. `packages/db/src/fractional-indexing-lexorank-store.ts` — `LexoRankFractionalOrderStore`: дробная лексикографическая индексация в системе Base-62 (**LexoRank**, `kosmora_lexorank_ordered_items`) для переупорядочивания списков за $O(1)$ записей в БД.
136. `packages/db/src/sliding-window-rate-governor-store.ts` — `SlidingWindowLogAndCounterGovernor`: гибридный лимитер запросов со скользящим окном (**Sliding-Window Counter**, `kosmora_sliding_window_counters`) со взвешенной интерполяцией соседних окон без пограничных всплесков $2\times$.
137. `packages/core/src/petri-karp-miller-coverability.ts` — `KarpMillerPetriNetReachabilityAnalyzer`: анализатор графа достижимости **сетей Петри**, тупиковых маркировок и проверки закона сохранения токенов (S-инвариантов).
138. `packages/core/src/shunting-yard-pratt-expression-evaluator.ts` — `DijkstraShuntingYardAndAstEvaluator`: алгоритм сортировочной станции **Дейкстры (Shunting-Yard)** и безопасный вычислитель выражений в обратной польской записи без `eval()`.
139. `desktop/windows/workspace/prov-lineage-and-citation-builder.cjs` — генератор графов происхождения данных **W3C PROV-JSON (`.prov.json`)** и библиографических баз **BibTeX (`.bib`)**.
140. `apps/api/test/robdd-mcmf-sam-glicko-and-dlx-frontier.test.ts` и `desktop/windows/test/prov-lineage-and-citation-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 15.


## Фаза 16: Матрицы разностных ограничений временных автоматов (DBM), двудольное паросочетание Хопкрофта — Карпа, БПФ Кули — Тьюки, журнал восстановления ARIES и вероятностный парсер CYK PCFG (Модули 141–156)
141. `packages/core/src/dbm-timed-automata-verifier.ts` — `DifferenceBoundMatrixTimedVerifier`: верификатор часовых зон временных автоматов реального времени (**Difference-Bound Matrix, DBM** Алура — Дилла) с канонизацией через замыкание Флойда — Уоршелла и проверкой совместности временных ограничений.
142. `packages/core/src/hopcroft-karp-bipartite-matching.ts` — `HopcroftKarpMaximumMatchingEngine`: алгоритм **Хопкрофта — Карпа** $O(E\sqrt{V})$ поиска наибольшего двудольного паросочетания и извлечения минимального вершинного покрытия по теореме Кёнига.
143. `packages/core/src/cooley-tukey-fft-periodogram.ts` — `CooleyTukeyFftAndWelchPeriodogram`: быстрое преобразование Фурье по основанию 2 (**Cooley-Tukey FFT / IFFT**) за $O(N \log N)$ и периодограмма спектральной плотности мощности для поиска скрытых циклов нагрузки.
144. `packages/core/src/adaboost-decision-stump-ensemble.ts` — `FreundSchapireAdaBoostClassifier`: бустинговый ансамбль **Discrete AdaBoost** Фройнда — Шапире над взвешенными решающими пнями.
145. `packages/core/src/levinson-durbin-burg-autoregression.ts` — `LevinsonDurbinArForecastEngine`: рекурсия **Левинсона — Дурбина** $O(p^2)$ решения тёплицевых систем Юла — Уокера и многошагового авторегрессионного прогнозирования $\text{AR}(p)$.
146. `packages/core/src/push-relabel-goldberg-tarjan.ts` — `GoldbergTarjanPushRelabelMaxFlow`: алгоритм проталкивания предпотока и подъёма высоты **Голдберга — Тарьяна (Push-Relabel)** для расчёта максимального потока.
147. `packages/core/src/suurballe-edge-disjoint-paths.ts` — `EdgeDisjointFaultTolerantRouter`: отказоустойчивая маршрутизация по $K$ рёберно-непересекающимся путям минимальной суммарной задержки.
148. `packages/core/src/bron-kerbosch-maximal-cliques.ts` — `BronKerboschPivotCliqueEnumerator`: алгоритм **Брона — Кербоша** с выбором опорной вершины Томиты для перечисления максимальных клик ($\omega(G)$) и $k$-ядерная декомпозиция Матулы — Бека.
149. `packages/core/src/arithmetic-range-ans-coder.ts` — `IntegerRangeEntropyCodec`: интервальный **арифметический / ранговый энтропийный кодек** с суббитовым сжатием на границе энтропии Шеннона.
150. `packages/core/src/walrasian-tatonnement-market-clearing.ts` — `WalrasianMarketClearingEquilibrium`: рыночный аукцион нащупывания равновесных цен **Вальраса (Walrasian Tâtonnement)** в модели рынка Фишера с функциями полезности Кобба — Дугласа.
151. `packages/db/src/persistent-treap-order-statistic-store.ts` — `OrderStatisticTreapStore`: декартово дерево порядковых статистик (**Order-Statistic Treap**, `kosmora_treap_order_nodes`) с операциями `split`/`merge`, выборкой $k$-й порядковой статистики `selectByRank` и ранга ключа за $O(\log N)$.
152. `packages/db/src/write-ahead-redo-undo-aries-recovery.ts` — `AriesWriteAheadRedoUndoRecoveryEngine`: трёхфазный движок восстановления после сбоев по журналу предзаписи **ARIES** Мохана (`Analysis` $\to$ `Redo` $\to$ `Undo` с компенсационными записями `CLR`, `kosmora_aries_wal_records`).
153. `packages/core/src/earley-cyk-probabilistic-pcfg.ts` — `ProbabilisticCykGrammarParser`: вероятностный табличный парсер **Кока — Янгера — Касами (CYK PCFG)** для построения дерева разбора максимального правдоподобия.
154. `packages/core/src/hilbert-space-filling-curve-index.ts` — `HilbertCurveSpatialIndexer`: двумерная заполняющая пространство **кривая Гильберта** (`xyToHilbertDistance` / `hilbertDistanceToXy`) с сохранением пространственной локальности.
155. `desktop/windows/workspace/stix-taxii-threat-intel-builder.cjs` — генератор пакетов киберразведки угроз **OASIS STIX 2.1 (`.stix.json`)** и сигнатурных правил **YARA (`.yar`)**.
156. `apps/api/test/dbm-hopcroft-fft-aries-and-pcfg-frontier.test.ts` и `desktop/windows/test/stix-taxii-threat-intel-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 16.


## Фаза 17: Насыщение равенств на E-графах, абстрактная интерпретация Кузо, сериализуемая изоляция снапшотов Кэхилла (SSI), парсер Пратта (TDOP), цветок Эдмондса и сопряжённые градиенты Крылова (Модули 157–172)
157. `packages/core/src/egraph-equality-saturation-optimizer.ts` — `EGraphEqualitySaturationEngine`: алгебраический оптимизатор насыщения равенств на **E-графах** с извлечением синтаксического дерева минимальной стоимости (`extractLowestCostAst`).
158. `packages/core/src/abstract-interpretation-interval-domain.ts` — `CousotIntervalAbstractInterpreter`: статический анализатор **абстрактной интерпретации Кузо** над решёткой интервалов $[l, u]$ с операторами объединения ($\sqcup$), пересечения ($\sqcap$), **расширения ($\nabla$, widening)** и **сужения ($\Delta$, narrowing)**, а также проверкой безопасности деления на ноль и границ массивов.
159. `packages/db/src/ssi-serializable-snapshot-isolation.ts` — `CahillSerializableSnapshotIsolationManager`: менеджер **сериализуемой изоляции снапшотов (SSI)** Кэхилла — Фекете (`kosmora_ssi_rw_antidependencies`) с отслеживанием предикатных блокировок `SIREAD`, рёбер `rw`-антизависимости и предотвращением аномалии *Write Skew* (`SQLSTATE_40001_SERIALIZATION_FAILURE`).
160. `packages/core/src/pratt-tdop-parser-compiler.ts` — `PrattTopDownOperatorPrecedenceParser`: нисходящий парсер операторного предшествования **Вогана Пратта (TDOP)** с функциями `nud`/`led`, силой связывания и поддержкой тернарного оператора `? :`.
161. `packages/core/src/baum-welch-forward-backward-hmm.ts` — `ForwardBackwardPosteriorHmmEngine`: прямо-обратный алгоритм **Рабинера ($\alpha$-$\beta$ Forward-Backward)** и оценка апостериорных маргиналов скрытых состояний $\gamma_t(i) = P(S_t = i \mid O_{1:T})$.
162. `packages/core/src/karmarkar-karp-multiprocessor-binpacking.ts` — `KarmarkarKarpAndBinPackingScheduler`: метод наибольших разностей **Кармаркара — Карпа (LDM)** для сбалансированного разбиения и упаковка в контейнеры **Best-Fit Decreasing (BFD)**.
163. `packages/core/src/edmonds-blossom-general-matching.ts` — `GeneralGraphMaximumMatchingEngine`: алгоритм сжатия нечётных циклов («цветков») **Эдмондса (Blossom Algorithm)** для поиска наибольшего паросочетания в произвольных недвудольных графах.
164. `packages/core/src/conjugate-gradient-krylov-solver.ts` — `ConjugateGradientKrylovLinearSolver`: предобусловленный метод **сопряжённых градиентов (PCG)** Хестенеса — Штифеля в подпространствах Крылова для симметричных положительно определённых систем $\mathbf{A}\mathbf{x} = \mathbf{b}$.
165. `packages/core/src/chaitin-linear-scan-register-allocator.ts` — `LinearScanAndGraphColoringAllocator`: аллокатор регистров и слотов исполнения методом линейного сканирования **Полетто — Саркара (Linear-Scan Register Allocation)** с вытеснением (*spilling*) интервала с самым дальним концом.
166. `packages/core/src/tukey-iqr-hampel-outlier-filter.ts` — `HampelIdentifierAndTukeyFenceFilter`: нелинейный скользящий фильтр выбросов **Хампеля** ($\text{Median} \pm 3 \times 1{,}4826 \cdot \text{MAD}$) и межквартильные барьеры **Тьюки (IQR Fences)**.
167. `packages/core/src/knuth-shuffle-alias-method-sampler.ts` — `VoseAliasMethodO1DiscreteSampler`: метод таблиц псевдонимов **Воза (Alias Method)** для точной выборки из дискретного распределения за строго константное время $O(1)$ + потоковая резервуарная выборка **Виттера (Algorithm R)**.
168. `packages/core/src/exponential-histogram-dgim-counter.ts` — `DgimSlidingWindowBitCounter`: логарифмический счётчик битов в скользящем окне **DGIM** (Датар — Гионис — Индик — Мотвани) с памятью $O(\log^2 N)$ и каскадным слиянием степеней двойки.
169. `packages/db/src/out-of-order-watermark-window-aggregator.ts` — `DataflowWatermarkWindowAggregator`: оконный агрегатор событийного времени по водяным знакам (**MillWheel / Flink Low-Watermark**, `kosmora_event_time_windows`) с маршрутизацией опоздавших событий в боковой выход (*Late Side Output*).
170. `packages/core/src/jaccard-sorensen-dice-ngram-profiler.ts` — `UkkonenApproximateStringAndNGramProfiler`: коэффициент биграммного сходства **Сёренсена — Дайса** и ленточное динамическое программирование **Укконена** $O(k \cdot N)$ с ранним отсечением по порогу $k$.
171. `desktop/windows/workspace/asyncapi-and-cloudevents-bundle-builder.cjs` — генератор спецификаций событийно-ориентированной архитектуры **AsyncAPI 2.6.0 (`.asyncapi.json`)** и пакетов конвертов **CNCF CloudEvents 1.0 (`.cloudevents.json`)**.
172. `apps/api/test/egraph-abstractinterp-ssi-and-pcg-frontier.test.ts` и `desktop/windows/test/asyncapi-and-cloudevents-bundle-builder.test.cjs` — сквозной набор верификационных тестов для всех модулей Фазы 17.

## Фаза 18 (Модули 173–188): Секретное разделение Шамира в GF(2^61−1), криптографическое дерево состояний Меркла–Патриции, маршрутизация Кристофидеса + 2-Opt, разложение Биркгофа–фон Неймана, теория игр Спрага–Гранди, дробное каскадирование, APSP Джонсона и GraphQL SDL / JSON-LD 1.1

- **Модуль 173 (`packages/core/src/shamir-lagrange-secret-sharing.ts`)**: `ShamirLagrangeSecretSharingEngine` — пороговое $(k, n)$-разделение секрета Ади Шамира над простым полем Мерсенна $\mathbb{F}_{2^{61}-1}$ с интерполяцией Лагранжа в точке $x=0$, SHA-256 обязательствами долей и проактивным обновлением долей без изменения секрета.
- **Модуль 174 (`packages/core/src/wagner-fischer-zhang-shasha-tree-diff.ts`)**: `OrderedTreeEditDistanceDiffer` — вычисление упорядоченного расстояния редактирования деревьев AST/DOM и генерация минимального структурного скрипта правок (`insert`, `delete`, `relabel`, `match`).
- **Модуль 175 (`packages/db/src/merkle-patricia-state-trie-store.ts`)**: `MerklePatriciaStateTrieStore` — шестнадцатеричное криптографическое дерево состояний Меркла–Патриции в SQLite (`kosmora_merkle_patricia_nodes`) с генерацией и проверкой доказательств включения/невключения.
- **Модуль 176 (`packages/core/src/christofides-two-opt-tsp-router.ts`)**: `MetricTspChristofidesTwoOptRouter` — метрический маршрутизатор коммивояжёра (остовное дерево Прима + паросочетание на вершинах нечётной степени + эйлеров обход Хирхольцера + локальная оптимизация 2-Opt).
- **Модуль 177 (`packages/core/src/sprague-grundy-impartial-game-solver.ts`)**: `SpragueGrundyNimberGameEngine` — вычисление нимберов Спрага–Гранди $\text{mex}(\cdot)$, XOR-суммы Бутона для дизъюнктивных сумм беспристрастных игр и синтез выигрышного хода.
- **Модуль 178 (`packages/core/src/birkhoff-von-neumann-bistochastic-decomposer.ts`)**: `BirkhoffVonNeumannDecompositionEngine` — балансировка Синкхорна–Кноппа и разложение дважды стохастической матрицы распределения ресурсов в выпуклую комбинацию матриц перестановок $\sum \theta_k P_k$.
- **Модуль 179 (`packages/core/src/charikar-count-sketch-ams-moments.ts`)**: `CountSketchAndAmsMomentEstimator` — несмещённое оценивание частот Count-Sketch со знаковыми хешами Радемахера $\pm 1$ и оценка второго частотного момента $F_2$ Алона–Матиаса–Сегеди (AMS).
- **Модуль 180 (`packages/core/src/ukkonen-online-suffix-tree.ts`)**: `GeneralizedSuffixTreeIndex` — обобщённое сжатое суффиксное дерево для поиска подстрок и наибольшей общей подстроки (LCS) по множеству документов.
- **Модуль 181 (`packages/core/src/capacitated-b-matching-assigner.ts`)**: `CapacitatedManyToManyBMatchingEngine` — двудольное $b$-паросочетание «многие-ко-многим» с квотами репликации задач и ёмкостями агентов.
- **Модуль 182 (`packages/core/src/lamport-bakery-mutex-fairness-verifier.ts`)**: `LamportBakeryTicketArbitrator` — алгоритм «Пекарня» Лесли Лэмпорта с лексикографическим порядком `(ticket, nodeId)` и аудитом индекса справедливости Раджа Джейна $\mathcal{J}(x)$.
- **Модуль 183 (`packages/core/src/fractional-cascading-multi-catalog-search.ts`)**: `FractionalCascadingCatalogIndex` — дробное каскадирование Шазелла–Гибаса по $k$ отсортированным каталогам за $O(\log N + k)$.
- **Модуль 184 (`packages/core/src/cubic-bezier-catmull-rom-trajectory-planner.ts`)**: `CatmullRomAndCubicBezierSplinePlanner` — планировщик траекторий на базе алгоритма де Кастельжо для кубических кривых Безье и сплайнов Катмулла–Рома с контролем кривизны $\kappa(t)$.
- **Модуль 185 (`packages/db/src/outbox-idempotency-dedup-ledger.ts`)**: `TransactionalIdempotencyKeyLedger` — транзакционный реестр ключей идемпотентности (`Idempotency-Key`) в SQLite (`kosmora_idempotency_key_ledger`) с детекцией расхождения SHA-256 отпечатка (`422`), блокировкой конкурентных запросов (`409`) и детерминированным повтором ответа (`200`).
- **Модуль 186 (`packages/core/src/johnsons-all-pairs-reweighted-shortest-path.ts`)**: `JohnsonReweightedSparseAllPairsRouter` — алгоритм Дональда Джонсона $O(V E + V^2 \log V)$ для поиска кратчайших путей между всеми парами вершин в разреженных графах с отрицательными весами рёбер через потенциалы Беллмана–Форда.
- **Модуль 187 (`desktop/windows/workspace/graphql-sdl-and-jsonld-bundle-builder.cjs` + `.test.cjs`)**: `GraphqlSdlAndJsonLdBundleBuilder` — генератор схем GraphQL SDL (`.graphql`) и онтологических контекстов W3C JSON-LD 1.1 (`.jsonld`) с криптографическим отпечатком SHA-256.
- **Модуль 188 (`apps/api/test/shamir-patricia-christofides-and-bvn-frontier.test.ts`)**: комплексный набор интеграционных тестов для всех модулей Фазы 18.

## Фаза 19 (Модули 189–204): Доказательства с нулевым разглашением Шнорра и гомоморфные обязательства Педерсена, глобальный минимальный разрез Штёр–Вагнера, маршрутизация ALT Landmark A*, тяжёлые элементы Мисры–Гриса, метод Якоби и PCA, мосты и точки сочленения Тарьяна, вёрстка Кнута–Пласса, фильтр Калмана UKF, дерево разрезов Гомори–Ху, рынки Гейла TTC, OR-Set CRDT и Protobuf v3 / gRPC

- **Модуль 189 (`packages/core/src/schnorr-pedersen-zkp-commitment.ts`)**: `SchnorrZkpAndPedersenCommitmentEngine` — неинтерактивное доказательство знания дискретного логарифма Шнорра (эвристика Фиата–Шамира над $\mathbb{F}_{2^{61}-1}$) и аддитивно-гомоморфные обязательства Педерсена $C(v,r)=g^v h^r \bmod p$.
- **Модуль 190 (`packages/core/src/stoer-wagner-global-min-cut.ts`)**: `StoerWagnerGlobalMinCutEngine` — детерминированный алгоритм Штёр–Вагнера $O(V^3)$ для поиска глобального минимального разреза неориентированного взвешенного графа через поиск максимальной смежности (MAS).
- **Модуль 191 (`packages/core/src/astar-landmark-alt-router.ts`)**: `AStarLandmarkTriangleInequalityRouter` — маршрутизатор кратчайших путей Голдберга–Харрелсона ALT ($A^*$ + ориентиры Landmarks + неравенство треугольника).
- **Модуль 192 (`packages/core/src/misra-gries-space-saving-heavy-hitters.ts`)**: `MisraGriesAndSpaceSavingFrequentItems` — детерминированный поиск частых элементов Мисры–Гриса и алгоритм Space-Saving Метвалли с гарантированной границей погрешности.
- **Модуль 193 (`packages/core/src/jacobi-eigenvalue-pca-reducer.ts`)**: `JacobiSymmetricEigenvaluePcaEngine` — метод вращений Якоби (вращения Гивенса) для точного вычисления собственных значений/векторов симметричных матриц и проекции метода главных компонент (PCA).
- **Модуль 194 (`packages/core/src/tarjan-bridge-articulation-biconnected.ts`)**: `TarjanBiconnectedArticulationAnalyzer` — линейный алгоритм Тарьяна $O(V+E)$ для обнаружения всех точек сочленения (cut vertices) и мостов (isthmuses) в топологии сети.
- **Модуль 195 (`packages/core/src/knuth-plass-paragraph-line-breaker.ts`)**: `KnuthPlassOptimalLineBreaker` — динамическое программирование Кнута–Пласса $O(N^2)$ для оптимального разбиения абзацев на строки с минимизацией кубической «плохости» разреженности.
- **Модуль 196 (`packages/core/src/unscented-kalman-sigma-point-filter.ts`)**: `UnscentedKalmanSigmaPointFilter` — нелинейный сигма-точечный фильтр Калмана (UKF Джулиера–Ульмана) без вычисления матриц Якоби.
- **Модуль 197 (`packages/core/src/floyd-steinberg-scalar-lloyd-max-quantizer.ts`)**: `LloydMaxAndErrorDiffusionQuantizer` — оптимальный неравномерный скалярный квантователь Ллойда–Макса (минимизация MSE) и 1D диффузия ошибки Флойда–Штейнберга.
- **Модуль 198 (`packages/core/src/edmonds-karp-gomory-hu-cut-tree.ts`)**: `GomoryHuAllPairsMinCutTreeEngine` — построение дерева эквивалентных потоков Гомори–Ху (алгоритм Гасфилда за $N-1$ вызовов максимального потока), кодирующего минимальные $s$-$t$ разрезы для всех $\binom{N}{2}$ пар вершин.
- **Модуль 199 (`packages/core/src/gale-top-trading-cycles-housing-market.ts`)**: `ShapleyScarfTopTradingCyclesEngine` — механизм ведущих торговых циклов Дэвида Гейла (Top Trading Cycles, TTC) для Парето-оптимального и защищённого от манипуляций перераспределения неделимых ресурсов.
- **Модуль 200 (`packages/core/src/jaro-winkler-phonetic-double-metaphone.ts`)**: `JaroWinklerAndPhoneticCodeProfiler` — метрика сходства строк Джаро–Винклера с префиксным усилением и фонетическое кодирование American Soundex.
- **Модуль 201 (`packages/db/src/or-set-observed-remove-crdt-store.ts`)**: `ObservedRemoveSetDeltaCrdtStore` — бесконфликтное множество с наблюдаемым удалением (OR-Set / Add-Wins CRDT) в SQLite (`kosmora_orset_elements`, `kosmora_orset_tombstones`).
- **Модуль 202 (`packages/db/src/hierarchical-quota-cost-attribution-ledger.ts`)**: `HierarchicalCostAttributionLedger` — иерархический FinOps-реестр атрибуции стоимости и токенов (`org -> team -> project -> workflow`) в SQLite (`kosmora_cost_attribution_entries`) с жёсткими бюджетными лимитами.
- **Модуль 203 (`desktop/windows/workspace/protobuf-v3-and-grpc-bundle-builder.cjs` + `.test.cjs`)**: `ProtobufV3AndGrpcBundleBuilder` — генератор контрактов Protocol Buffers `proto3` (`.proto`) и дескрипторов сервисов gRPC (`.grpc.json`) с SHA-256 отпечатком.
- **Модуль 204 (`apps/api/test/zkp-stoerwagner-alt-gomoryhu-and-ttc-frontier.test.ts`)**: комплексный набор интеграционных тестов для всех модулей Фазы 19.

## Фаза 20 (Модули 205–220): Ориентированное остовное дерево Чу–Лю / Эдмондса, триангуляция Делоне и диаграмма Вороного Бойера–Уотсона, LCA за O(1) через эйлеров обход, упрощение траекторий Рамера–Дугласа–Пекера / Висвалингама–Уайатта, HITS Клейнберга, аукцион Бертсекаса, алгоритм Манахера и Z-функция, синтез РСЛОС Берлекэмпа–Мэсси, алгоритмы Брента и Полларда, FastCDC, MRF-разрезы, BM25+, битемпоральное хранилище SQL:2011, каузальная рассылка BSS и OPA Rego / Cedar

- **Модуль 205 (`packages/core/src/chu-liu-edmonds-directed-arborescence.ts`)**: `ChuLiuEdmondsDirectedMstEngine` — алгоритм Чу–Лю / Джека Эдмондса $O(V E)$ для построения ориентированного каркаса минимального веса (Optimum Branching) со сжатием ориентированных циклов.
- **Модуль 206 (`packages/core/src/bowyer-watson-delaunay-voronoi-mesh.ts`)**: `BowyerWatsonDelaunayVoronoiEngine` — инкрементальная триангуляция Делоне Бойера–Уотсона с проверкой свойства пустой описанной окружности и построением двойственного графа ячеек Вороного.
- **Модуль 207 (`packages/core/src/euler-tour-rmq-sparse-table-lca.ts`)**: `EulerTourSparseTableLcaEngine` — сведение задачи наименьшего общего предка (LCA) и расстояний в дереве к запросу минимума на отрезке (RMQ) по эйлерову обходу за строгое время $O(1)$ через разреженную таблицу (Sparse Table).
- **Модуль 208 (`packages/core/src/ramer-douglas-peucker-visvalingam-simplifier.ts`)**: `PolylineTrajectorySimplifier` — геометрическое сжатие ломаных и телеметрических траекторий методами Рамера–Дугласа–Пекера и Висвалингама–Уайатта.
- **Модуль 209 (`packages/core/src/kleinberg-hits-hubs-authorities.ts`)**: `KleinbergHitsHubsAndAuthoritiesEngine` — алгоритм HITS Джона Клейнберга для расчёта взаимоусиливающихся оценок концентраторов (Hubs) и авторитетных узлов (Authorities) с $L_2$-нормализацией.
- **Модуль 210 (`packages/core/src/bertsekas-epsilon-auction-assigner.ts`)**: `BertsekasEpsilonScalingAuctionEngine` — аукционный алгоритм Димитриса Бертсекаса с $\epsilon$-масштабированием для задачи о назначениях максимальной выгоды.
- **Модуль 211 (`packages/core/src/manacher-z-algorithm-string-kernel.ts`)**: `ManacherAndZAlgorithmStringKernel` — линейный алгоритм Манахера $O(N)$ поиска наибольшей палиндромной подстроки и Z-алгоритм Гасфилда $O(N)$.
- **Модуль 212 (`packages/core/src/berlekamp-massey-lfsr-synthesizer.ts`)**: `BerlekampMasseyLfsrSynthesizer` — алгоритм Берлекэмпа–Мэсси синтеза кратчайшего регистра сдвига с линейной обратной связью (LFSR) над $\mathbb{F}_p$ и прогнозирования рекуррентных последовательностей.
- **Модуль 213 (`packages/core/src/brent-cycle-pollard-rho-factorizer.ts`)**: `BrentCycleAndPollardRhoEngine` — телепортирующий детектор циклов Ричарда Брента $(\mu, \lambda)$ и $\rho$-алгоритм факторизации составных чисел Джона Полларда.
- **Модуль 214 (`packages/core/src/fastcdc-gear-content-defined-chunker.ts`)**: `GearFastContentDefinedChunker` — контентно-зависимое разбиение потоков данных FastCDC на базе скользящего Gear-хеша с двухуровневой нормализацией масок.
- **Модуль 215 (`packages/core/src/mrf-binary-submodular-graph-cut.ts`)**: `SubmodularMarkovRandomFieldGraphCut` — точная минимизация субмодулярной энергии бинарного марковского случайного поля (MRF) через минимальный $s$-$t$ разрез графа.
- **Модуль 216 (`packages/core/src/soft-tfidf-bm25-plus-proximity-scorer.ts`)**: `Bm25PlusAndSpanProximityRanker` — ранжирование документов BM25+ (Lv & Zhai) с нижней границей нормализации частоты термов $+\delta$ и усилением за минимальный интервал близости слов запроса.
- **Модуль 217 (`packages/db/src/bitemporal-valid-transaction-time-store.ts`)**: `BitemporalValidAndTransactionTimeStore` — битемпоральное хранилище фактов Ричарда Снодграсса (SQL:2011) в SQLite (`kosmora_bitemporal_facts`) с независимыми осями действительного времени (`valid_time`) и транзакционного времени (`transaction_time`).
- **Модуль 218 (`packages/db/src/birman-schiper-stephenson-causal-broadcast.ts`)**: `CausalBroadcastVectorClockBuffer` — буфер каузально-упорядоченной рассылки Бирмана–Шипера–Стивенсона (BSS) на векторных часах в SQLite (`kosmora_causal_broadcast_queue`).
- **Модуль 219 (`desktop/windows/workspace/opa-rego-and-cedar-policy-builder.cjs` + `.test.cjs`)**: `OpaRegoAndCedarPolicyBuilder` — генератор политик авторизации CNCF Open Policy Agent Rego v1 (`.rego`) и Cedar Policy Language (`.cedar`) с SHA-256 отпечатком.
- **Модуль 220 (`apps/api/test/arborescence-delaunay-lca-bitemporal-and-causal-frontier.test.ts`)**: комплексный набор интеграционных тестов для всех модулей Фазы 20.

## Фаза 21 (Модули 221–236): Аддитивно-гомоморфная криптосистема Пэйе, K кратчайших простых путей Йена, Heavy-Light декомпозиция дерева, выпуклая оболочка и вращающиеся калиперы, QR-разложение Хаусхолдера, нечёткий поиск Bitap Shift-Or, слова Линдона Дюваля, взвешенный резервуар Эфраимидиса–Спиракиса, CORDIC, декомпозиция Далмейджа–Мендельсона, проводимость Чигера, минимаксные назначения, DLQ-планировщик и Time-Travel инспектор в SQLite, WebAssembly WAT / WIT

- **Модуль 221 (`packages/core/src/paillier-additive-homomorphic-crypto.ts`)**: `PaillierHomomorphicEncryptionEngine` — вероятностная криптосистема с открытым ключом Паскаля Пэйе над $\mathbb{Z}_{n^2}^*$ с аддитивным гомоморфизмом $D(E(m_1)\cdot E(m_2)\bmod n^2)=(m_1+m_2)\bmod n$ и умножением шифртекста на скаляр.
- **Модуль 222 (`packages/core/src/yens-k-shortest-loopless-paths.ts`)**: `YenKShortestLooplessPathsRouter` — алгоритм Цзинь Йена для нахождения $K$ кратчайших путей без циклов через систематическое ветвление от узлов отклонения (spur nodes).
- **Модуль 223 (`packages/core/src/heavy-light-decomposition-tree-path.ts`)**: `HeavyLightDecompositionTreeEngine` — Heavy-Light декомпозиция (HLD) Слитора–Тарьяна с деревом отрезков для выполнения агрегатных запросов (`sum`, `max`) и точечных обновлений на путях в дереве за $O(\log^2 N)$.
- **Модуль 224 (`packages/core/src/monotone-chain-convex-hull-calipers.ts`)**: `ConvexHullAndRotatingCalipersEngine` — построение выпуклой оболочки методом монотонной цепи Эндрю $O(N \log N)$, расчёт площади по формуле Гаусса и поиск точного диаметра множества точек методом вращающихся калиперов Шамоса–Туссена.
- **Модуль 225 (`packages/core/src/householder-qr-least-squares-solver.ts`)**: `HouseholderQrLeastSquaresSolver` — ортогональное QR-разложение методом отражений Хаусхолдера $A = Q R$ и решение переопределённых задач линейных наименьших квадратов $\min_x \|Ax - b\|_2$.
- **Модуль 226 (`packages/core/src/bitap-shift-or-fuzzy-matcher.ts`)**: `BitapShiftOrApproximateMatcher` — битово-параллельный алгоритм приближённого поиска подстрок Bitap (Бaeса-Йейтс — Гоннет / Ву — Манбер) с расстоянием Левенштейна $\le k$.
- **Модуль 227 (`packages/core/src/duval-lyndon-word-factorization.ts`)**: `DuvalLyndonFactorizationEngine` — линейный алгоритм Жана-Пьера Дюваля $O(N)$ факторизации строк на невозрастающие простые слова Линдона и канонизация лексикографически минимального циклического сдвига.
- **Модуль 228 (`packages/core/src/efraimidis-spirakis-weighted-reservoir.ts`)**: `EfraimidisSpirakisWeightedReservoir` — однопроходная взвешенная резервуарная выборка без возвращения Эфраимидиса–Спиракиса (алгоритм A-Res с ключами $u_i^{1/w_i}$).
- **Модуль 229 (`packages/core/src/cordic-hyperbolic-trig-evaluator.ts`)**: `VolderCordicVectorRotationEngine` — итерационный сдвигово-аддитивный вычислитель Джека Волдера CORDIC для расчёта $\sin\theta$, $\cos\theta$, $\text{atan2}(y,x)$ и евклидовой нормы без аппаратных умножителей.
- **Модуль 230 (`packages/core/src/dulmage-mendelsohn-structural-decomposer.ts`)**: `DulmageMendelsohnCanonicalDecomposer` — каноническая структурная декомпозиция Далмейджа–Мендельсона двудольных систем ограничений на недоопределённую ($D_U$), точно определённую ($D_W$) и переопределённую ($D_O$) подсистемы.
- **Модуль 231 (`packages/core/src/cheeger-conductance-expander-auditor.ts`)**: `CheegerConductanceAndSweepCutAuditor` — аудит проводимости графа (Cheeger Conductance $\Phi(S)$) и двусторонних спектральных оценок неравенства Чигера $\Phi^2/2 \le \lambda_2 \le 2\Phi$.
- **Модуль 232 (`packages/core/src/bottleneck-minmax-linear-assigner.ts`)**: `LinearBottleneckAssignmentSolver` — решение минимаксной задачи о назначениях (Linear Bottleneck Assignment Problem, $\min_\pi \max_i C_{i,\pi(i)}$) через бинарный поиск по порогу и проверку совершенного паросочетания.
- **Модуль 233 (`packages/db/src/exponential-backoff-dlq-retry-store.ts`)**: `DecorrelatedJitterDlqRetryStore` — планировщик повторных попыток с декоррелированным джиттером (Decorrelated Jitter Exponential Backoff) и карантином проблемных задач в очереди недоставленных сообщений (DLQ) в SQLite (`kosmora_dlq_retry_tasks`).
- **Модуль 234 (`packages/db/src/mvcc-time-travel-snapshot-differ.ts`)**: `TimeTravelSnapshotDiffInspector` — инспектор сравнения исторических ревизий состояния (`added`, `modified`, `deleted`) в SQLite (`kosmora_snapshot_revisions`).
- **Модуль 235 (`desktop/windows/workspace/wasm-wat-and-wit-component-builder.cjs` + `.test.cjs`)**: `WasmWatAndWitComponentBuilder` — генератор S-выражений модулей W3C WebAssembly Text (`.wat`) и интерфейсов компонентной модели WIT (`.wit`) с SHA-256 отпечатком.
- **Модуль 236 (`apps/api/test/paillier-yen-hld-hull-and-qr-frontier.test.ts`)**: комплексный набор интеграционных тестов для всех модулей Фазы 21.

## Фаза 22 (Модули 237–252): Мультипликативно-гомоморфная криптосистема Эль-Гамаля и доказательство Чаума–Педерсена DLEQ, самобалансирующееся Splay-дерево Слитора–Тарьяна, k-d дерево и пара ближайших точек, усечённое SVD и псевдообратная матрица Мура–Пенроуза, алгоритм отпечатков Winnowing, вейвлет-дерево Гросси–Виттера, расстояние Махаланобиса, KKT QP, алгоритм Габова SCC, Alpha-Expansion Бойкова–Векслера, последовательности де Брёйна, сумма Неймайера, барьеры Чанди–Лэмпорта и Token-Ring в SQLite, RFC 7517 JWKS / OIDC Discovery

- **Модуль 237 (`packages/core/src/elgamal-chaum-pedersen-dleq-verifier.ts`)**: `ElGamalAndChaumPedersenDleqEngine` — мультипликативно-гомоморфная криптосистема Тахера Эль-Гамаля над $\mathbb{F}_{2^{61}-1}^*$ и неинтерактивное доказательство равенства дискретных логарифмов Чаума–Педерсена $\text{DLEQ}(G,Y_1,H,Y_2)$.
- **Модуль 238 (`packages/core/src/sleator-tarjan-splay-tree-sequence.ts`)**: `SleatorTarjanSelfAdjustingSplayTree` — самонастраивающееся бинарное дерево поиска Слитора–Тарьяна (вращения Zig, Zig-Zig, Zig-Zag) с поддержкой агрегатов поддеревьев за амортизированное время $O(\log N)$.
- **Модуль 239 (`packages/core/src/kd-tree-closest-pair-spatial-index.ts`)**: `KdTreeAndSweepLineClosestPairEngine` — пространственное $k$-d дерево Джона Бентли для поиска ближайшего соседа с отсечением ветвей и алгоритм сканирующей прямой Шамоса–Хои $O(N \log N)$ для поиска пары ближайших точек.
- **Модуль 240 (`packages/core/src/golub-kahan-truncated-svd-low-rank.ts`)**: `TruncatedSvdAndPseudoinverseEngine` — сингулярное разложение матриц $A = U \Sigma V^T$, оптимальная низкоранговая аппроксимация Эккарта–Янга–Мирского ранга $k$ и псевдообратная матрица Мура–Пенроуза $A^+$.
- **Модуль 241 (`packages/core/src/schleimer-winnowing-document-fingerprint.ts`)**: `SchleimerWinnowingPlagiarismFingerprinter` — алгоритм локальных цифровых отпечатков документов Winnowing (Шлеймер — Уилкерсон — Эйкен) с гарантией обнаружения общих подстрок длины $\ge w + k - 1$.
- **Модуль 242 (`packages/core/src/grossi-vitter-wavelet-tree-rank-select.ts`)**: `WaveletTreeRankSelectQuantileIndex` — сжатое вейвлет-дерево Гросси–Гупты–Виттера для выполнения запросов `rank(v, i)` и поиска $k$-й порядковой статистики на произвольном подотрезке `rangeQuantileKthSmallest(L, R, k)` за $O(\log \sigma)$.
- **Модуль 243 (`packages/core/src/mahalanobis-ewma-covariance-detector.ts`)**: `MahalanobisMultivariateAnomalyDetector` — многомерный детектор аномалий на основе обращения ковариационной матрицы $\Sigma^{-1}$ и квадратичного расстояния Махаланобиса $D_M^2(x) = (x-\mu)^T \Sigma^{-1} (x-\mu)$.
- **Модуль 244 (`packages/core/src/active-set-quadratic-programming-kkt.ts`)**: `ActiveSetQuadraticProgramSolver` — решение выпуклых задач квадратичного программирования (QP) с линейными ограничениями-равенствами через седловую систему условий Каруша–Куна–Таккера (KKT).
- **Модуль 245 (`packages/core/src/gabow-path-based-scc-condensation.ts`)**: `GabowPathBasedSccAndDagCondenser` — двухстековый путевой алгоритм Гарольда Габова $O(V+E)$ для выделения компонент сильной связности (SCC) и построения ориентированного ациклического графа конденсации.
- **Модуль 246 (`packages/core/src/alpha-expansion-multilabel-graph-cut.ts`)**: `BoykovVekslerAlphaExpansionOptimizer` — итерационный алгоритм $\alpha$-расширения Бойкова–Векслера–Забиха для многометочной минимизации энергии марковских случайных полей (Potts MRF).
- **Модуль 247 (`packages/core/src/de-bruijn-eulerian-sequence-assembler.ts`)**: `DeBruijnEulerianSequenceAssembler` — генератор циклических последовательностей де Брёйна $B(k, n)$ и эйлеров сборщик контигов по графу $k$-меров.
- **Модуль 248 (`packages/core/src/kahan-babuska-neumaier-compensated-sum.ts`)**: `NeumaierAndPairwiseCompensatedArithmetic` — компенсированное суммирование Арнольда Неймайера (Kahan–Babuška–Neumaier) и высокоточное скалярное произведение без потери точности на знакопеременных рядах разных порядков.
- **Модуль 249 (`packages/db/src/dag-workflow-checkpoint-barrier-store.ts`)**: `ChandyLamportDagBarrierCheckpointStore` — координатор барьерного выравнивания контрольных точек потокового DAG (Asynchronous Barrier Snapshotting) в SQLite (`kosmora_dag_checkpoint_barriers`, `kosmora_dag_committed_checkpoints`).
- **Модуль 250 (`packages/db/src/token-ring-quorum-barrier-coordinator.ts`)**: `DistributedBarrierAndTokenRingStore` — координатор распределённого маркерного кольца (Token-Ring) и многофазных барьеров синхронизации воркеров в SQLite (`kosmora_token_ring_holders`, `kosmora_barrier_phases`).
- **Модуль 251 (`desktop/windows/workspace/jwks-and-oidc-discovery-bundle-builder.cjs` + `.test.cjs`)**: `JwksAndOidcDiscoveryBundleBuilder` — генератор наборов криптографических ключей IETF RFC 7517 JWKS (`.jwks.json` с отпечатками RFC 7638 `x5tS256`) и метаданных OpenID Connect 1.0 Discovery (`.openid-configuration.json`).
- **Модуль 252 (`apps/api/test/elgamal-splay-kdtree-svd-and-wavelet-frontier.test.ts`)**: комплексный набор интеграционных тестов для всех модулей Фазы 22.
