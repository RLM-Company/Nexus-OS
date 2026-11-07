# Поставка блока: надёжный Windows-клиент Kosmora/Koswork

Дата: 2026-11-07 · Ветка: `desc/win-client-reliability` · База реализации:
`338536ee5946f96dcd18768143cc41af998c476a` (main после PR №463). PR:
https://github.com/RLM-Company/Nexus-OS/pull/465 (merge/deploy не выполнялись).
Multi-Agent, Jarvis и облачный компьютер не затрагивались; browser/**,
work-cycle/computer-session и Office-реализация не менялись, кроме вынесенных
точечных дополнений к уже существующей консоли.

## Что было

- Подключение: проверка адреса через `createLatestAttemptGate`, сохранение
  origin только после успешной загрузки. Отсутствовали: отмена запоздалой
  проверки на стороне UI, гарантированный финальный сброс индикатора
  «Подключение…» (поздний ответ мог оставить кнопки заблокированными).
- Запуск: жёсткий профиль `%APPDATA%\cosmora-windows-desktop`; при отказе ОС
  или упакованной среды (MSIX LocalCache, инцидент 7 ноября) процесс падал до
  создания окна — пользователь не видел никакого окна и причины.
- Локальный исполнитель: консоль с подтверждениями и стоп-страховкой; но до
  первого подтверждения не было предсказуемого «снимка доступности» (вход,
  рабочая папка, нативный helper, занятость).
- Установщик: NSIS через electron-builder уже настроен; изменение appId/профиля
  при обновлении не было зафиксировано тестом.

## Что работает теперь

1. **Цикл подключения (потребительский путь)** — на странице напечатать адрес →
   «Открыть Kosmora» → при недоступности сервера «Отмена» побеждает поздний
   ответ; busy снимается синхронно после завершения проверки; адрес остаётся
   сохранённым до успешного нового подключения; при отказе отмены (стадия
   смены сервера) пользователь видит явное сообщение и результат смены.
2. **Запуск или восстановление** — окно приложения открывается всегда:
   новый `profile-environment.cjs` проверяет каталог профиля, пишет понятную
   причину (недоступен/не записывается/перенаправлен MSIX-средой). Локальное
   хранилище при отказе профиля деградирует к обычной рабочей папке с явным
   сообщением; ничего не мигрирует и не отключает path guard.
3. **Диагностика** — меню «Kosmora → Состояние локального профиля…» и
   «Справка → Начало работы…» (инструкция на один экран: установить → открыть →
   адрес сервера → обычный вход → включить локальный инструмент).
4. **Предсказуемая доступность исполнителя** — `koswork:computer-availability`
   (пассивный снимок: вход подтверждён, занятость, рабочая папка, нативный
   helper, причина недоступности) в строке состояния окна управления до
   первого подтверждения. Снимок не запускает действия и не
   запрашивает разрешений.

Не реализовано/зафиксировано отдельно (согласно объёму): изменение
подключённого провайдера HY4 и модель прав не затронуты; пароли как и раньше
не хранятся в оболочке; веб-авторизация выполняется владельцем в окне
приложения (Basic Auth не подменялся).

## Изменённые файлы

- `desktop/windows/connection-policy.cjs` — `cancelPending()` на попытке.
- `desktop/windows/main.cjs` — стадии попытки (probe/load/commit),
  `cosmora:cancel-connect`, финальная публикация состояния после попытки,
  устойчивый запуск профиля, замена падения `createLocalVault` на явный отказ,
  меню (состояние профиля, инструкция), стартовое сообщение при деградации.
- `desktop/windows/connection.{html,js}`, `preload.cjs` — кнопка «Отмена»,
  предсказуемый busy, рендер авторитетного состояния.
- `desktop/windows/profile-environment.cjs` (новый) — проверка профиля.
- `desktop/windows/computer-console.cjs`, `computer-preload.cjs`,
  `computer.{html,js}` — обработчик и строка доступности.
- `desktop/windows/package.json` — build/check-скрипты включают новый модуль.
- Тесты: `test/connection-policy.test.cjs`,
  `test/connection-renderer.test.cjs`, `test/profile-environment.test.cjs`
  (новый), `test/computer-console.test.cjs`,
  `test/computer-renderer.test.cjs`, `test/package-policy.test.cjs`.

## Команды и результаты

```
cd desktop/windows
node --test test/*.test.cjs   # 347/348 пройдено
node -e "...scripts.check..." # все node --check — ок
node scripts/check-secrets.mjs # Secret scan passed (корень репозитория)
```

Прогон выполнен на этой машине, Node v26.13.0 (локальный checkout без
node_modules; `check-secrets` прогнан от корня). Единственное локальное падение
(`lifecycle-guard.test.cjs`) — **средовое и pre-existing**: тест вызывает
`pwsh` (PowerShell 7), которого здесь нет; существо теста — отказ
`ci/nsis-lifecycle.ps1` работать на машине разработчика, оно не задето этими
изменениями. Фиксировалось ещё до коммитов (332/333 → тот же единственный fail).

Отметка про собственно модель: **настоящий model-run в этом блоке не
запускался** — все сценарии используют fixtures/mock runner. Никаких
лог-файлов владельца, .env или личных файлов как данных не задействовано.

### CI на GitHub (HEAD `c11ce94e`, 2026-11-07)

| Проверка                                                        | Результат                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Verify monorepo                                                 | pass (5m58s) — `pnpm check:core` (prettier pinned 3.9.6, secrets, lint, typecheck, тесты, build, privacy/profile) прошёл |
| Browser acceptance                                              | pass (8m54s)                                                                                                             |
| Code sandbox isolation                                          | pass (33s)                                                                                                               |
| Test, build and lifecycle-test NSIS installer (Windows desktop) | pass (5m34s) — сборка NSIS + lifecycle-сценарий на disposable runner                                                     |

Пункты 3 и 5 отдельных новых дубликатов не получили: их покрытие уже
существующими тестами (`work-result`, `work-retry-guard`,
`computer-control`, `draft-store`, `connection-policy`/`desktop-state`),
проверено прогоном `node --test` выше — дублирование хранилищ/исполнителей
не создавалось.

## Коммиты

- `d3c4b2fc` fix(connection): cancel wins over late probe answers and busy
  never outlives a completed check
- `632f6975` feat(launch): open the window on refused or MSIX-redirected
  profiles with explicit recovery
- `72ca76dc` feat(koswork): show passive availability of the local executor
  before first consent
- `e3df14a9` docs(handoff): deliver Windows client reliability block report
- `a5fb6896` style(desktop): apply prettier to the Windows client reliability
  changes
- `c11ce94e` style(desktop): reformat main.cjs with the pinned prettier version

Замечание для интегратора: первые два коммита содержат взаимно-связанные
изменения в `main.cjs`; отдельный `d3c4b2fc` в одиночку не собирается, потому
что ссылается на `profile-environment.cjs`, который фактически добавлен во
втором коммите. Шероховатость истории не влияет на checked-out HEAD; всю ветку
следует проверять по HEAD `c11ce94e` (зелёный CI).

## Ограничения и границы

- NSIS-сценарий «установить/обновить/удалить» прогоняется через
  `ci/nsis-lifecycle.ps1` на disposable GitHub-hosted runner (требование
  теста) — прошёл в CI; на машине владельца межпрофильная приёмка
  (установка в отдельном Windows-профиле, ярлык, реконнект, синтетическое
  задание, MSIX-вариант) не выполнялась и остаётся за владельцем/интегратором.
- Прогон проекта (pagenode rebuild) и staging-интеграция не выполнялись:
  изменения не трогают сервер/интерфейс чата, что зафиксировано через
  отрисовку UI на существующие собранные страницы.
- Установочный пакет собирается в CI (`pack:win` в Windows desktop job);
  локально в этой среде не собирался (нет electron/electron-builder).
- Локально недоступные части quality gate (`test:deploy`, `test:privacy`,
  `test:profile`) требуют собранного `packages/db/dist` (pnpm + turbo build);
  они выполняются только в CI и там прошли.

## Интеграция и откат

- PR №465 из ветки `desc/win-client-reliability`; merge и deploy не
  выполнялись — слияние за владельцем/интегратором (Codex).
- Откат: `git revert c11ce94e a5fb6896 e3df14a9 72ca76dc 632f6975 d3c4b2fc`
  или возврат ветки к базе
  `338536ee5946f96dcd18768143cc41af998c476a`.
- Пользовательские данные (профиль, vault, черновики) при откате
  не меняются: ни один файл владельца в блоке не удалялся и не переименовывался.
