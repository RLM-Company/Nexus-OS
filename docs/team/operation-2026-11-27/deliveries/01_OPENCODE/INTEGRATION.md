# INTEGRATION — 01_OPENCODE

В этом срезе **общие файлы не менялись**: app.ts/server.ts, корневые exports,
lockfile, contracts, миграции и IPC-регистрация не тронуты. Изменения только
в своей зоне `desktop/windows/browser/` и тестах + документации своей поставки.
Отдельный integration commit не требуется.

## Точки подключения для других исполнителей

- Harness 1 (executor target / device events): читает
  `engine.state().deviceLease` (`native`, `waiting`, `dom`, `generation`,
  `stopped`) и коды ошибок из `device-lease.cjs`. Бизнес-логику туда не
  копируется.
- Grok (voice stop/takeover): вызывает `engine.takeControl()` — это вытесняет
  native lease и отменяет ожидающие агенты. Голосовой модуль остаётся его
  владением.
- OpenCode 2 (export / editor launch): получает те же коды и состояние lease;
  не должен обходить `assertNative` для нативных действий.

## Что нужно интегратору позже

- Если общий executor target будет требовать единый тип в `packages/contracts`,
  добавить минимальный theme file + export отдельным integration commit.
- Итоговые номера/порядок миграций согласовываются интегратором; в этом срезе
  миграций нет.

## Откат

revert коммита среза: удалить `device-lease.cjs`, вернуть `engine.cjs` и тесты.
Существующие пользовательские данные и Profiles не затрагиваются.
