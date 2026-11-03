# Сводная матрица верификации Stage-2 и операторский сценарий живой приёмки Kosmora / Koswork

Дата: `2026-11-02`
Ветка: `feature/kosmora-stage2-master-verification-20261102`
Полный охват стека: `PR #411` — `PR #428`
Результат матричного прогона: **11 из 11 тестовых наборов пройдены успешно (100% PASS, время выполнения: 138.66 с)**

---

## 1. Обзор архитектуры и реализованных блоков

Завершён полный комплекс задач второго этапа Kosmora и Koswork, объединяющий локальный контур ПК (Windows Electron), облачное хранилище (Google Drive), память диалогов и проектов, языковые модели (CheapVibeCode Sol 1.05M и TokenShop Fable 5) и повторяемые сценарии:

| № | Блок архитектуры | PR стека | Ключевые модули | Подтверждённые гарантии |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Google Drive OAuth & Restore** | `#425` | `google-drive.ts`, `google-drive-grant-cipher.ts`, `google-drive-store.ts`, `google-drive-authorization.ts`, `google-drive-archive-builder.ts`, `google-drive-backups.ts`, `google-drive-restore.ts` | PKCE S256, AES-256-GCM шифрование токенов, канонический multipart ZIP, транзакционное восстановление в новые ID, остановка фонового спулинга при смене эпохи приватности (`quiesce`). |
| **2** | **Локальный разбор документов Сейфа и сверка памяти** | `#420`, `#424` | `desktop/windows/vault-document-extractor.cjs`, `apps/api/src/memory-snapshot-reconciler.ts` | Автономный разбор `.docx`, `.xlsx`, `.pptx`, `.pdf` без внешних бинарников; защита от ZIP-бомб (`<= 32 MiB`) и обхода путей; адресная нарезка фрагментов `<= 12 000` символов; разрешение конфликтов памяти (`keep_server`, `replace_with_client`, `fork_as_new_record`). |
| **3** | **Гибридный поиск памяти и верификатор скачиваний** | `#417`, `#421` | `packages/db/src/context-memory-hybrid-search.ts`, `packages/db/src/context-memory-notes-migrator.ts`, `desktop/windows/browser/download-verifier.cjs` | RRF (`k=60`) ранжирование (лексический + 3-граммы + сущности); стемминг RU/EN; миграция `project_memory` с проверкой подлинности цитат; временный режим чата; стабилизация скачивания `result.txt` в Electron. |
| **4** | **Сжатие по темам, кандидаты профиля и перенос на VPS** | `#418`, `#419`, `#423` | `packages/db/src/history-compaction-topic-analyzer.ts`, `packages/db/src/profile-candidate-reconciler.ts`, `packages/db/src/vps-chat-history-migrator.ts`, `scripts/vps-chat-recovery-and-tls-probe.mjs` | Отслеживание цепочек изменений параметров (`28K -> 1.05M`); блокировка при потерях обязательных условий; детекция противоречий и продвижение в профиль; потоковый экспорт/импорт батчами для 1 GB RAM VPS; оценка внешней сетевой связности. |
| **5** | **Неизменяемый спулер Drive, Shadow DOM и отчёты Word** | `#414`, `#416`, `#425` | `apps/api/src/cloud-storage/google-drive-immutable-spooler.ts`, `desktop/windows/browser/shadow-and-frame-piercer.cjs`, `desktop/windows/workspace/word-report-builder.cjs` | Content-addressed запись `.spool` на диск до сетевой отправки; экспоненциальный retry backoff; обход Shadow DOM и same-origin `<iframe>`; генерация валидных `.docx` отчётов с гиперссылками и цитатами внутри рабочей папки. |
| **6** | **Реконструкция каталога Drive, BPE-аудитор и защита ПК** | `#411`, `#412`, `#422`, `#425` | `apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.ts`, `packages/core/src/bpe-context-estimator-and-audit.ts`, `desktop/windows/ci/computer-hazard-and-focus-guard.cjs` | Пересборка каталога при утрате БД из ZIP STORE (`manifest.json` + `snapshot.part*` по 2 МиБ); импорт внешних ZIP с отменой прерванных сообщений; субсловный расчёт токенов кириллицы/кода/тайлов; классификатор опасных действий ПК и остановка при потере фокуса окна. |
| **7** | **Виртуальный мост `.kosmora-vault` и аварийный дамп аккаунта** | `#415`, `#421`, `#425` | `desktop/windows/vault-virtual-bridge.cjs`, `desktop/windows/browser/search-pagination-and-bookmarks.cjs`, `apps/api/src/cloud-storage/full-account-emergency-snapshot.ts` | Суррогатно-безопасная нарезка UTF-16 (без разрыва пар эмодзи); чтение `.docx` через `.kosmora-vault/<SHA256>/<offset>`; пагинация выдачи DuckDuckGo без утечки запроса в URL; лимит 3 вкладок `WebContentsView`; полный аварийный ZIP STORE дамп всех таблиц аккаунта. |
| **8** | **Отказоустойчивый Fable SSE и расписания сценариев** | `#426`, `#427`, `#428` | `apps/api/src/fable-sse-resilient-stream.ts`, `packages/db/src/context-memory-prefix-byte-cache.ts`, `packages/db/src/workflow-schedule-and-subworkflow-runner.ts` | Потоковая сборка SSE `claude-fable-5` с однократной развёрткой `<escape>JSON</escape>`; перевод статуса в `uncertain` при обрыве соединения до `message_stop`; изолированный по владельцам O(N) байтовый кэш памяти; инлайнинг подсценариев с защитой от циклов; запуск расписаний по `schedule:<id>:<slot>`. |
| **9** | **Переносимость сценариев и контроль срока discovery Fable** | `#426`, `#428` | `packages/db/src/workflow-portability-and-zip-exporter.ts`, `apps/api/src/fable-discovery-and-registry-validator.ts` | Санитизация переносимых пакетов с отсечением приватных полей; отказ `WORKFLOW_TOOL_UNAVAILABLE` до построения плана; однопроходная подстановка параметров без рекурсивной инъекции; план с 0 токенов по умолчанию; контроль истечения discovery (`2026-11-09`). |
| **10** | **3 шаблона Koswork, Critic-валидатор и 500 квитанций памяти** | `#416`, `#424`, `#428` | `packages/db/src/workflow-dag-templates-and-critic.ts`, `packages/db/src/context-memory-receipts-store.ts`, `desktop/windows/ci/unified-task-coordinator.cjs` | Стартовые шаблоны (отчёт по документу, текст в материалы, анализ источника с запиской); топологический DAG; проверка Критиком; триггер `WORKFLOW_VERSION_IMMUTABLE`; журнал квитанций памяти с FIFO-ограничением 500 записей; единый координатор Браузер + Файлы + Приложения. |
| **11** | **Консолидированная миграция `0063`, триггеры и IPC-мост** | Интеграция | `packages/db/migrations/0063_unified_stage2_extensions.sql`, `apps/api/src/stage2-privacy-adapter.ts`, `desktop/windows/ci/stage2-desktop-ipc-bridge.cjs` | Аддитивная миграция 12 таблиц; триггеры `OWNER_DATA_FENCED` на вставку и обновление; адаптер приватности Stage-2 (`quiesce`/`export`/`delete`/`resume`); единый IPC-роутер нативного десктопа с проверкой источника `file://` и блокировкой внешних страниц. |

---

## 2. Итоги матричного прогона тестов

Все 11 наборов тестов запускаются и валидируются командой:
```bash
node scripts/stage2-master-verification-matrix-runner.mjs
```

Сводка прогона:
```
┌─────────┬─────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────┬────────┬───────────┐
│ (index) │                   PR                    │                                Module                                │ Status │ Duration  │
├─────────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────┼───────────┤
│    0    │                'PR #425'                │             'Google Drive OAuth, Grant Cipher & Restore'             │ 'PASS' │ '39050ms' │
│    1    │           'PR #420 / PR #424'           │        'Local Vault PDF/Office Extractor & Memory Reconciler'        │ 'PASS' │ '10369ms' │
│    2    │           'PR #417 / PR #421'           │    'Hybrid Memory Search, Entity Extraction & Download Verifier'     │ 'PASS' │ '11687ms' │
│    3    │      'PR #418 / PR #419 / PR #423'      │      'Topic Compaction, Profile Candidates & 1GB VPS Migrator'       │ 'PASS' │ '12193ms' │
│    4    │      'PR #414 / PR #416 / PR #425'      │  'Drive Immutable Spooler, Shadow DOM Piercer & Word .docx Builder'  │ 'PASS' │ '8788ms'  │
│    5    │ 'PR #411 / PR #412 / PR #422 / PR #425' │    'Drive Journal Recovery, Computer Hazard Guard & BPE Auditor'     │ 'PASS' │ '5967ms'  │
│    6    │      'PR #415 / PR #421 / PR #425'      │   'Virtual Vault Bridge, Browser Pagination & Emergency Snapshot'    │ 'PASS' │ '7602ms'  │
│    7    │      'PR #426 / PR #427 / PR #428'      │  'Fable SSE Resilient Stream, Prefix Cache & Workflow Subworkflows'  │ 'PASS' │ '7335ms'  │
│    8    │           'PR #426 / PR #428'           │  'Workflow Portability, Anti-Injection Binder & Fable Expiry Guard'  │ 'PASS' │ '5654ms'  │
│    9    │      'PR #416 / PR #424 / PR #428'      │ '3 Scenario Templates, Topological DAG, Critic & 500-Receipt Store'  │ 'PASS' │ '9593ms'  │
│   10    │       'PR #411..#428 Integration'       │ 'Consolidated Migration 0063, Privacy Fencing & Electron IPC Bridge' │ 'PASS' │ '15017ms' │
└─────────┴─────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────┴────────┴───────────┘
```

Дополнительные автоматические проверки:
- **Проверка неизменности защищённых файлов Codex:** `git diff apps/api/src/account-settings packages/db/src/usage-store.ts packages/contracts/src/usage.ts` возвращает `0` расхождений.
- **Статический аудит отсутствия секретов (`scripts/check-secrets.mjs`):** `Secret scan passed.`

---

## 3. Операторский сценарий живой приёмки владельцем

Для будущей живой приёмки владельцем (после настройки домена, проброса боевых ключей и готовности боевого VPS) подготовлен пошаговый план с защитой от непредвиденных списаний:

### Шаг 1. Проверка окружения и явный opt-in
1. Все платные вызовы по умолчанию выключены:
   - `MODEL_FALLBACK_TO_MOCK=false`
   - `MODEL_MAX_ATTEMPTS_PER_ROUTE=1` (запрет скрытых ретраев)
   - `KOSWORK_IMMEDIATE_EXECUTION=false` (сценарии создают только план без расхода токенов)
2. При боевом тестировании передаётся явный флаг запуска:
   ```bash
   export KOSMORA_LIVE_ACCEPTANCE=true
   export MODEL_API_KEY="<приватный_ключ_в_переменной_окружения>"
   ```

### Шаг 2. Запуск локального API и Web
1. Запуск изолированного API:
   ```bash
   pnpm --filter @cosmora/api start
   ```
2. Запуск локального Web-интерфейса:
   ```bash
   pnpm --filter @cosmora/web start
   ```

### Шаг 3. Контрольная последовательность проверки функций
1. **Google Drive:** вход в «Личные настройки» -> подключение аккаунта через OAuth -> тестовое резервное копирование чата -> скачивание архива -> предпросмотр восстановления -> восстановление в изолированный новый чат.
2. **Рабочая папка Koswork:** выбор тестовой папки -> проверка создания/чтения/поиска файлов -> попытка создания симлинка/выхода за пределы папки (должен быть отказ `WORKSPACE_PATH_TRAVERSAL`).
3. **Локальный Сейф `.kosmora-vault`:** помещение в папку тестового `.docx` и `.pdf` -> вызов агента Koswork -> проверка извлечения текста по ссылке `.kosmora-vault/<SHA256>/0` без ошибок кодировки.
4. **Сценарии Koswork:** открытие проекта -> выбор шаблона «Отчёт по документу» -> нажатие «Создать план» (проверка, что баланс токенов не изменился) -> включение флажка выполнения -> завершение задачи с проверкой Критика -> скачивание ZIP-архива готовых результатов.
5. **Приватность:** запуск тестового экспорта данных через Privacy Coordinator -> сверка наличия секции `stage2-memory-drive-workflows` со всеми созданными записями.
