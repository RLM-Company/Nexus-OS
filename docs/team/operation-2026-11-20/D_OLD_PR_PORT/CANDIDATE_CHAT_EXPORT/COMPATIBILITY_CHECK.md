# Проверка совместимости патча — 20 ноября 2026

**BASE_SHA:** `51ce52a9`. Патч проверен без применения к рабочему дереву.

## 1. Применение

```
git apply --check --whitespace=nowarn docs/team/operation-2026-11-20/D_OLD_PR_PORT/CANDIDATE_CHAT_EXPORT/0001-chat-export-text-html.patch
APPLY_CHECK_EXIT=0
```

Контекст совпал со всеми четырьмя файлами на зафиксированной версии.

## 2. Анализ вызывающих

| Вызывающий                                            | Использование                              | Влияние                                                       |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `apps/web/src/app/chat-archive-export.ts:34-35`       | `createChatExport(..., "markdown"/"json")` | Нет: signatures совместима, значения не изменились            |
| `apps/web/src/app/chat-export-controls.tsx:14,34,67`  | `ChatExportFormat \| "zip"`, `select`      | Добавлены два `<option>`; состояние по умолчанию — `markdown` |
| `apps/web/src/app/chat-item-menu.tsx:171,178,270-271` | `exportChat(format)`                       | Добавлены два пункта, тип `ChatExportFormat` расширен         |
| `apps/web/src/app/chat-export.test.ts`                | Прямые вызовы                              | Добавлены два теста; прежние не изменены                      |
| API/DB/native/contracts                               | Не используются                            | Изменений нет                                                 |

Типизация: расширение union — добавочное изменение; старые вызовы компилируются без правок.
Новые ветки `format === "text"/"html"` не задевают `"json"` и `"markdown"`.

## 3. Фактическая проверка поведения

Патч применён к копиям четырёх файлов во временном каталоге. Изменённый
`chat-export.ts` был транспилирован через `typescript.transpileModule` и
запущен на синтетическом сообщении с `<script>`,`<img>` и скрытым текстом
вложения. Результат в [BEHAVIOUR_CHECK.log](BEHAVIOUR_CHECK.log):

```
PASS markdown ... .md   text/markdown;charset=utf-8
PASS json      ... .json application/json;charset=utf-8
PASS text      ... .txt  text/plain;charset=utf-8
PASS html      ... .html text/html;charset=utf-8
PASS html escaping and metadata-only attachments
BEHAVIOUR_CHECK PASS
```

Проверено: расширения и MIME, дословное сохранение текста и Unicode,
отсутствие содержимого вложений и system_event во всех четырёх форматах,
экранирование разметки в HTML.

## 4. Реальные проверки после применения патча (20.11.2026)

Патч применён к рабочему дереву и прогнан tooling'ом репозитория:

| Проверка             | Команда                                  | Результат    |
| -------------------- | ---------------------------------------- | ------------ |
| vitest `chat-export` | `vitest run src/app/chat-export.test.ts` | **6/6 PASS** |
| TypeScript           | `tsc --noEmit -p tsconfig.json`          | **exit 0**   |
| ESLint               | `eslint src`                             | **exit 0**   |

До установки отсутствующих зависимостей `tsc` падал только на `library-scan-ocr.ts`
(отсутствующий `tesseract.js`) — до этого патча и не связан с экспортом.
После установки точных версий из `apps/web/package.json` (без правки манифеста
и lockfile) все проверки зелёные. Лог поведения — [BEHAVIOUR_CHECK.log](BEHAVIOUR_CHECK.log).

## 5. Ограничения проверки

- Полный E2E/браузерные клики не запускались: патч меняет только клиентский
  экспорт, API/DB не затронуты.
- Новые пункты меню добавляются в уже существующий список без изменения
  размеров, иконок, сайдбара, начального экрана и стилей:
  [UI_RULES.md](../../../../../apps/web/UI_RULES.md) соблюдены.

## Итог

Совместимость подтверждена на уровне применения патча, сигнатур, вызывающих,
поведения функции и реальных vitest/typecheck/lint. Статус — **готово к ревью**,
не к слиянию.
