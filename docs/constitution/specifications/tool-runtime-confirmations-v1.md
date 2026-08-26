# Tool Runtime и подтверждения v1

**Статус:** IMPLEMENTED / OWNER-APPROVED ARCHITECTURE  
**Дата:** 2026-08-24

## Граница исполнения

Внешний инструмент может быть вызван только через `@cosmora/tool-runtime`. Runtime сам формирует
`PolicyIntent` из зарегистрированных возможностей инструмента; вызывающий агент не может объявить
себе более узкий набор capability ID.

Последовательность исполнения:

1. загрузить Capability Profile проекта и действующие Permission Contract;
2. получить verdict Policy Engine;
3. при `NEEDS_CONFIRMATION` создать карточку подтверждения и не вызывать инструмент;
4. при `ALLOW_WITH_LIMITS` потребовать от зарегистрированного инструмента явную проверку verdict и
   его ограничений; одного декларативного флага недостаточно;
5. при `ALLOW` или проверенном `ALLOW_WITH_LIMITS` атомарно зарезервировать операцию;
6. вызвать обработчик с исходным idempotency key и полным verdict;
7. записать результат как `SUCCEEDED` либо неопределённый сбой как `FAILED`/`RESERVED`;
8. никогда не повторять `RESERVED` автоматически без сверки с внешним провайдером.

## Подтверждение

Карточка привязана к проекту, operation ID, actor ID, capability ID, object ID, сроку и случайному
challenge nonce. Одобрение создаёт одноразовый Permission Contract только для возможностей,
которые имели режим `CONFIRM`. После атомарного резервирования операции разрешение и карточка
переходят в состояние `CONSUMED`.

Критические возможности — финансы, кредит, юридические условия, контракт, раскрытие данных,
постоянный промпт и изменение стратегии — требуют step-up verification. A6 и FULL overrides также
невозможно включить без step-up verification. Пока отдельный провайдер усиленной аутентификации не
подключён, сервер безопасно отклоняет такие запросы.

## SQLite

Хранятся:

- канонический профиль автономности проекта с compare-and-swap версией;
- Permission Contract и атомарный счётчик использований;
- запросы подтверждения и их решения;
- операции инструментов и idempotency key;
- неизменяемый журнал всех verdict Policy Engine.

Профиль нового проекта создаётся как A0. API принимает только `base_level`, overrides и ожидаемую
версию; 19 grants всегда строятся из канонической матрицы и не принимаются от клиента.

## API

- `GET /api/v1/projects/:projectId/autonomy-profile`
- `PUT /api/v1/projects/:projectId/autonomy-profile`
- `GET /api/v1/projects/:projectId/confirmations`
- `POST /api/v1/confirmations/:confirmationId/approve`
- `POST /api/v1/confirmations/:confirmationId/reject`

API не хранит step-up token и не включает небезопасный тестовый fallback.
