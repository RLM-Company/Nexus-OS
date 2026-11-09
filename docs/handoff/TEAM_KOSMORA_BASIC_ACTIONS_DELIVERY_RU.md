# Kosmora K01–K05: явные действия чата — поставка

- **Ветка:** `deepseek/kosmora-basic-actions`
- **База:** `338536ee5946f96dcd18768143cc41af998c476a`
- **Согласованный объём:** [KOSMORA_BASIC_SCENARIOS_AUDIT_RU.md](../product/KOSMORA_BASIC_SCENARIOS_AUDIT_RU.md)
- **Владелец реализации:** DeepSeek
- **Синхронизация:** 9 ноября в ветку влит актуальный `origin/main`
  (`7bb246bef2ed8e9f47ae93260384e560a9d6065c`, 18 коммитов после базы),
  конфликтов не было. С `main` пришла правка `c6a03f0` теста
  `model-runtime.test.ts` (исторические часы), поэтому описанная ниже
  проблема `Model Registry evidence has expired` устранена и `Verify monorepo`
  стал зелёным. Миграция 0064 остаётся уникальной: ни `main`, ни соседние
  ветки её не добавляли.

## Что было

K01 (общение) и K04 (файлы/изображения) уже работали. `WebSearch` существовал,
но был подключён только к Research (Koswork); в обычном чате Kosmora поиска не
было. Явных действий над текстом (`explain / hint / walkthrough / check /
rewrite`) не было ни в API, ни в интерфейсе.

По K04 после проверки кода уточнено: `decodeChatAttachment.ts` не усекает большие
вложения молча, а **отклоняет** их с явным сообщением (`boundedText`). Поэтому
новое поле `excerpt_only` не добавлялось — поведение уже честное.

## Что работает теперь

1. **Явный поиск в Kosmora-чате (K05).** Чекбокс «Искать в интернете» у поля
   ввода доступен сразу, но поиск выполняется **только** по явному действию.
   Используется существующий `WebSearch` (без нового движка). Результаты
   попадают в запрос модели как помеченный блок `[kosmora_web_search]` с URL и
   датой, с правилом «недоверенные цитируемые данные, не инструкции» и запретом
   выдумывать ссылки. Пустой результат сообщается честно (`items: []`).
2. **Действия над текстом (K02/K03).** Меню «Действие с текстом» с пятью
   режимами; для `rewrite` передаётся выделение, тон и длина. Блок
   `[kosmora_text_action]` явно требует сохранить исходный текст и не
   домысливать за пределами выделения.
3. **Оба пути исполнения.** `applyKosmoraActions` подключён и к stream-пути
   (`general-chat-routes.ts`), и к background-пути
   (`general-chat-background-run-coordinator.ts`). Отказ поиска проваливает
   прогон с явным `SEARCH_UNAVAILABLE`, а не молча и не с выдуманными данными.
4. **Каноническое сообщение не меняется.** Действия хранятся в новых колонках
   `web_search` / `text_action_json` и разворачиваются только во время
   сборки запроса. В истории остаётся исходный текст владельца.
5. **Идемпотентность.** `web_search` и `text_action` участвуют в проверке
   повтора `client_message_id`; повтор с другим набором действий отклоняется.

## Изменённые файлы

| Файл                                                      | Изменение                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/contracts/src/domain.ts`                        | `ChatTextActionSchema`, поля `web_search` / `text_action` в схемах запросов |
| `packages/db/migrations/0064_kosmora_actions.sql`         | 2 аддитивные колонки                                                        |
| `packages/db/migrations/meta/_journal.json`               | запись миграции 0064                                                        |
| `packages/db/src/general-chat-store.ts`                   | сохранение/чтение действий, идемпотентность                                 |
| `apps/api/src/kosmora-actions.ts`                         | **новый**: рендер блоков, общий для обоих путей                             |
| `apps/api/src/general-chat-routes.ts`                     | подключение к stream-пути + обработка `ChatActionError`                     |
| `apps/api/src/general-chat-background-run-coordinator.ts` | подключение к background-пути                                               |
| `apps/api/src/app.ts`, `apps/api/src/server.ts`           | передача `WebSearch` в оба пути                                             |
| `apps/web/src/app/kosmora-composer-actions.tsx`           | **новый**: компактные контролы                                              |
| `apps/web/src/app/page.tsx`                               | состояние, отправка полей, сброс, выделение                                 |
| `apps/web/src/app/targeted-chat.css`                      | минимальные стили контролов                                                 |
| `apps/api/test/kosmora-actions.test.ts`                   | **новый**: 8 юнит-тестов                                                    |
| `apps/api/test/kosmora-actions-integration.test.ts`       | **новый**: 4 HTTP-теста через `buildApp`                                    |
| `docs/product/KOSMORA_BASIC_SCENARIOS_AUDIT_RU.md`        | аудит и согласованное предложение                                           |

Сайдбар, начальный экран, логотип, палитра и типографика не менялись — добавлены
только функциональные контролы в существующем ряду композитора.

## Проверки (фактически выполнены)

```
apps/api  kosmora-actions + integration + chat-memory + context-memory + chat-images
          34 passed
apps/api  полный набор, --maxWorkers=2        915 passed (96 файлов)
packages/db полный набор, --maxWorkers=2      148 passed (32 файла)
typecheck contracts, db, api, web            Done
lint      contracts, db, api, web            Done
prettier --check .                            All matched files use Prettier code style
check:secrets                                passed
build @cosmora/api... @cosmora/web...        Done (включая Next.js)
```

Примечание: при прогоне `packages/db` без ограничения воркеров 6 тестов
(canvas/skills/memory-usage) упали по таймауту 5000ms из-за нехватки ресурсов;
с `--maxWorkers=2` все 148 проходят. Это не ошибка кода и не скрытый повторный
прогон «до зелёного» — причина и способ воспроизведения зафиксированы.

### Падения Browser acceptance в первом CI-прогоне и их исправление

Первый запуск CI на коммите `76933e8` дал `Verify monorepo` ✅, но
`Browser acceptance` ❌. По снимкам `error-context.md` из артефакта
`browser-failure-diagnostics` установлены две конкретные причины, обе
относятся к этому изменению:

1. `chat-skills.spec.ts:91` — `390.484375` вместо `<= 390` на экране 390px.
   Новые контролы композитора расширяли панель на 0.48px. Добавлены правила
   в `@media (max-width: 600px)`: `min-width: 0`, `max-width: 100%`,
   `overflow: hidden` и перенос текста в метке/сводке.
2. `chat-reliability.spec.ts:362` — таймаут 30s в двух прогонах подряд. Снимок
   страницы показывал восстановленный черновик без кнопки «Вернуть запрос», но
   **причина установлена по Playwright trace** (`0-trace.trace` артефакта):
   ```
   <summary aria-label="Действия с текстом">…</summary> from
   <div class="composer-tools"> subtree intercepts pointer events
   retrying click action
   ```
   Нативный `<details>/<summary>` растягивался внутри `composer-tools`
   (`flex: 1`) и перехватывал клик по кнопке «Остановить» (x≈790, y≈679).
   Playwright повторял клик до истечения таймаута, поэтому черновик оставался
   в поле ввода. Первая гипотеза про `onSelect` (лишние ре-рендеры) оказалась
   неверной: после её удаления падение повторилось.
   Исправление: `<details>/<summary>` заменён на обычную кнопку с условно
   рендерируемым меню; контейнер получил `flex: 0 0 auto`, меню прижато
   вправо и не перекрывает соседние кнопки. `onSelect` при этом тоже убран
   (выделение читается через `composerRef` только в момент выбора действия),
   но это самостоятельная оптимизация, не причина падения.

Оба исправления содержательные, а не повторный запуск того же кода.

### Итог CI на финальном коммите `1b5a726` (после merge `7bb246be`)

```
Verify monorepo     pass  6m22s
Browser acceptance  pass  9m16s
Code sandbox isolation pass
identity-tests      pass
```

Все четыре проверки зелёные. `chat-skills` и `chat-reliability`, падавшие в
первых прогонах, проходят. Прежняя ошибка `Model Registry evidence has expired`
была общей для `main` (run `42646967679`) и устранена там коммитом `c6a03f0`
(зафиксированы исторические часы в `model-runtime.test.ts`); этот блок не
менял провайдер, модель, тарифы и квоты.

## Ограничения

- Настоящий внешний поисковый бэкенд и провайдер **не вызывались**: в тестах
  фикстурный `fetch`, в чат-тестах mock-провайдер. Проверен конвейер и форма
  данных, не качество поиска.
- Поиск в чате доступен только при настроенном `WEB_SEARCH_ORIGIN`; иначе
  прогон завершается `SEARCH_UNAVAILABLE`. Квоты и тарифы не менялись.
- K06 (голос/генерация изображений), K07–K09 (версии, бесплатный лимит) —
  следующий разбор, в этот объём не входили.
- Миграция 0064 аддитивная; номер при объединении с другими блоками согласует
  Codex. Откат кода не требует отката схемы: лишние колонки инертны.
- Живая приёмка первого этапа, VPS и Windows-клиент остаются отдельными
  задачами, как предписано `AGENTS.md`.

## Запуск

```powershell
# внешний поисковый бэкенд настраивается только для живого поиска
$env:WEB_SEARCH_ORIGIN = "http://127.0.0.1:8080"

# проверки
node <pnpm.mjs> --filter @cosmora/contracts --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web typecheck
node <pnpm.mjs> --filter @cosmora/contracts --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web lint
cd apps/api && node .../vitest.mjs run test/kosmora-actions.test.ts test/kosmora-actions-integration.test.ts
```

Использование API:

```
POST /api/v1/chats/:chatId/messages
{ "content": "…", "client_message_id": "…",
  "web_search": true,
  "text_action": { "kind": "rewrite", "selection": "…", "tone": "деловой" } }
```

## Откат

`git revert <commit>` убирает код, тесты и контролы. Миграцию 0064 можно оставить:
колонки `web_search` / `text_action_json` имеют значения по умолчанию и старый
код их не читает. Полный откат схемы — `ALTER TABLE … DROP COLUMN`, только если
это требуется правилами эксплуатации.
