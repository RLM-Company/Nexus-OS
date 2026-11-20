# Совместимый HTTP API / MCP-коннектор — 15 ноября 2026

Пункт «Интеграции» [инструкции третьего этапа](../product/Инструкция%203%20этапа.md):
«для остальных сервисов предусмотреть подключение совместимого HTTP API или
MCP». Решение владельца «все по порядку» продолжает первый срез, согласованный
в [карточке раздела](../product/INTEGRATIONS_STAGE3_SECTION_CARD_DRAFT_2026-11-15_RU.md)
и реализованный в PR #603 (`ConnectorRegistry` поверх `GuardedToolRuntime`).

**Ветка:** `stage3/scheduling-clean`, база `ed3c111e`. **PR/deploy нет.**

## Что уже было (PR #603)

- `packages/contracts/src/integrations.ts` — валидируемый манифест `Connector`
  без credentials.
- `packages/tool-runtime/src/connector-registry.ts` — реестр с
  `bindTransport()`; без привязки операция fail-closed (`PAUSED`).
- `packages/tool-runtime/src/connector-catalog.ts` — дескрипторы
  GitHub / Drive / Office без транспорта.
- `GET /api/v1/integrations/status` — честный `not_connected`.

Открытым оставалось именно «предусмотреть подключение совместимого HTTP API или
MCP»: адаптер, который можно привязать к реестру, не изобретая второй политики
и не делая внешних вызовов до разрешения владельца.

## Что добавлено

`packages/tool-runtime/src/http-connector.ts` (+ экспорт из `index.ts`):

- `createHttpConnectorTransport(options)` возвращает `ConnectorTransport` с
  **инъекцией `fetchImpl`**. Реальный сетевой клиент не создаётся: тесты и
  локальная приёмка подставляют фикстуру, а рабочее подключение должно
  внедрить проверенный владельцем транспорт.
- Allowlist: `baseUrl` только http/https, путь должен начинаться с `/`,
  совпадать с origin и разрешённым префиксом; методы `GET/POST/PUT/DELETE`;
  лимит ответа; `authorization` и `x-api-key` из недоверенного входа
  удаляются (секреты живут в проверенном транспорте, а не в payload модели).
- `mcpToolCall(tool, args)` — соглашение MCP-совместимого вызова
  (`/tools/<name>/call`) поверх того же HTTP-транспорта, без второго runtime.
- Никаких токенов, URL провайдеров и грантов в дескрипторах.

Вызов по-прежнему идёт через `ConnectorRegistry.invoke()` →
`GuardedToolRuntime`: policy verdict, подтверждения, идемпотентность с replay,
owner/project scope, `RECOVERY_REQUIRED`.

## Проверки

`packages/tool-runtime/test/http-connector.test.ts` (4 теста):

| Сценарий                                                                                     | Результат |
| -------------------------------------------------------------------------------------------- | --------- |
| валидация base URL, allowlist пути, метода, удаление credential-заголовков                   | passed    |
| именованный MCP-вызов и ограничение размера ответа                                           | passed    |
| реестр без привязанного транспорта → `PAUSED`, `transport_wired:false`                       | passed    |
| привязанный дескриптор → `EXECUTED` через политику, повтор не делает второго внешнего вызова | passed    |

Дополнительно: полный набор `packages/tool-runtime`, typecheck, lint,
prettier, check-secrets. Внешних/платных вызовов нет.

## Границы и следующий шаг

Адаптер **предусматривает** подключение, но не привязывает реальный транспорт
к GitHub/Drive/Office и не вводит MCP-сервер: это внешние действия и возможные
платные вызовы, для которых по правилам этапа и по явной оговорке владельца
нужно отдельное подтверждение в момент подхода (пункт 6 «живые провайдеры»).
До него `/api/v1/integrations/status` честно сообщает `not_connected`.
Новых прав, OAuth, UI и деплоя нет.
