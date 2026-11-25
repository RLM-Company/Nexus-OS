# DELIVERY — BIZ-040 field register

- **Ветка:** `feature/koswork-pdf-field-register` от актуального main `8ed117f8`.
- **Статус:** готово к интеграции; общий каталог и интерфейс Koswork не трогал (подключает Codex).

## Что реализовано

- `packages/core/src/biz040-field-register.ts` — чистая логика реестра полей:
  - вход: уже извлечённые страницы (`file_name`, `page`, `text`, `source: pdf_text|ocr|image`, `image_verified`) и схема полей (`key`, `label`, `patterns`, `critical`);
  - выход: `FieldRow[]` + `fieldRegisterCsv()` — скачиваемый CSV (BOM, CRLF, RFC-экранирование) с колонками `field_key, field, value, file_name, page, source, verification_status, critical, note`.
- Статусы проверки: `text_verified`, `image_verified`, `ocr_uncertain`, `contradiction`, `missing`, `critical_unverified`.
  - пропуск → пустые значение/файл/страница и явный `missing`;
  - разные значения в файлах/страницах → `contradiction` со списком найденных значений;
  - сомнительные OCR-глифы → `ocr_uncertain`;
  - критичное поле без сверки с изображением → `critical_unverified` (даже если значение из встроенного текста PDF);
  - после явной сверки с изображением → `image_verified`.
- `apps/web/src/app/biz040-field-register-export.ts` — `createFieldRegisterCsvBlob()` для будущей кнопки скачивания (Codex подключает UI).

Переиспользованы существующие разбор PDF и OCR: BIZ-040 не запускает свой парсер, а принимает `pages`, полученные `studio-files-library-client.extractLibraryPages()` и `library-scan-ocr.createLibraryOcr()`.

## Синтетический пакет

`docs/team/operation-2026-11-25/biz040-field-register/field-register-example-input.json` — обычный `contract.pdf` (встроенный текст), скан `scan.png.pdf` (OCR, `image_verified: true`) и `invoice.pdf`, в котором искомого поля нет. Схема из 5 полей, три критичных.

`field-register-example.csv` — фактический вывод. В нём:

- `contract` → `critical_unverified` (анализ PDF-текста не заменяет сверку с изображением);
- `amount` → `contradiction` (`19700` в PDF, `197` в OCR-скане);
- `date` → `text_verified`;
- `counterparty` → `image_verified` (сканированная страница сверена);
- `penalty` → `missing` (отсутствующее поле не выдумано).

## Проверки

```
packages/core test/biz040-field-register.test.ts  4 passed
 typecheck/lint core+web · prettier --check . · check-secrets — green
```

Целевые тесты покрывают синтетический пакет и все шесть статусов. Общий каталог/интерфейс Koswork, тарифы, VPS и живые провайдеры не трогались.
