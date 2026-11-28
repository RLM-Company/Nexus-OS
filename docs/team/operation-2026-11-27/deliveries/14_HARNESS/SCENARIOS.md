# Сценарии

```bash
pnpm --filter @cosmora/api exec vitest run test/document-answer-service.test.ts test/document-answer-http.test.ts test/studio-fixture-deep-analysis.test.ts test/document-answer-checkpoints.test.ts
pnpm --filter @cosmora/db exec vitest run test/document-answer-retry-link.test.ts test/document-library-store.test.ts test/project-intake-upgrade.test.ts test/document-answer-batch-upgrade.test.ts
pnpm --filter @cosmora/web exec vitest run src/app/studio-files-report.test.ts src/app/library-archive-import.test.ts src/app/library-upload-queue.test.ts
KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test e2e/document-library.spec.ts e2e/document-answer-retry.spec.ts
```

HTTP-тест создаёт четыре PDF, CSV и TXT. На диске у шести исходников 676 029 байт. В индекс переданы 512 текстовых PDF-страниц, обработано 514 фрагментов в 42 партиях. Транспорт модели возвращает исходные цитаты и одну намеренно ложную ссылку. После повторного открытия базы повтор отправляет в модель одну партию для чтения. Синтез выполняется повторно. Проверяются граница в три параллельных вызова, стабильный ID повтора, сохранение прежней попытки, страницы, целые числа, ведущие нули и выгрузка реестра. Тексты страниц переданы из генератора фикстуры; этот тест не измеряет OCR.

Архивная проверка подтверждает, что подготовка пакета читает каталог ZIP и не раскрывает обычные записи. Повреждённая контрольная сумма выявляется перед загрузкой одного участника; следующий файл проходит через ту же очередь. Подключение каждого документа к индексу остаётся последовательным.
