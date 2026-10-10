# Kosmora Windows 0.11.2 — инкрементальный handoff (2026-10-09)

## Исходники и принцип наложения

Точная объединённая база: `76e44320f20ae4cdc70f5202ac9e77d30c34eef7` (`kosmora-source-76e4432.zip` внутри `kosmora-integration-handoff(2).zip`). Windows 0.11.0 уже входит в неё. В `packages/desktop.zip` содержится **вторая итерация поверх 0.11.0**, она не накладывается повторно в полном объёме. Готовый Windows 0.11.1 из предыдущей итерации сохранён отдельным неизменённым архивом. 0.11.2 включает 0.11.1 и перечисленные ниже исправления.

Применить **либо** полный `kosmora-windows-0.11.2-from-76e4432.patch`, **либо** `kosmora-windows-0.11.2-desktop-only.patch`, затем ровно один раз `kosmora-windows-0.11.2-shared-integration.patch`. ZIP содержит только реально изменённые/добавленные пути. Общий `apps/web/src/app/page.tsx` не заменять целиком: при наличии косметических изменений root применить shared patch вручную, сохранив Voice, English Relay, текущую композицию и стили. Патчи не трогают `globals`, `brand`, API, DB/migrations, документы, Canvas, Data, бюджеты, CI/main и VPS.

## Новое поверх 0.11.1

1. Owner определяется **реальным контрактом** `/api/v1/identity/sessions` (`packages/contracts/src/primitives.ts`: `EntityId`, 1–128 не-пробельных символов). Старый UUID-only фильтр неправомерно отвергал `local-owner`; клиент принимает идентификатор из строго единственной `current=true/status=active/actor_kind=owner` записи с будущим `expires_at`. Сеть, HTML, редирект, неожиданное происхождение, чрезмерный ответ или отсутствие подтверждения не дают права читать локальный черновик. Кэш офлайн-записи ограничен минимумом 12 часов и серверным `expires_at` и живёт только в текущем процессе.
2. `draft-session-gate.cjs`: область черновика должна быть **сначала загружена** через подтверждённого owner текущего документа Electron. `save`, `flush`, `clear` для неподтверждённой области, чужого owner/origin или устаревшего документа отклоняются. SPA-переходы между областями сохраняют привязку к owner; полная навигация, logout, смена origin сбрасывают её. Даже если cookie сменится на второго owner без reload, старая страница не сможет сохранить текст первого пользователя во второй файл. Для нормальной работы после такой смены нужно обновить страницу/войти вновь.
3. Явная first-party навигация `/logout` либо `/signout` удаляет локальные шифрованные текстовые черновики и сбрасывает привязку; при ошибке очистки обычная полная навигация блокируется с предупреждением. Нативная команда выхода дополнительно удаляет Chromium cookies/storage/cache. При пассивном истечении сессии данные не переносятся другому owner, но могут сохраниться до явного выхода/30-дневного срока.
4. `pagehide` теперь **синхронно** сохраняет шифрованный текст при ранее подтверждённом и ещё действительном owner/document/scope: уход со страницы не зависит от нового сетевого запроса и не теряет обычный debounce-черновик. При отсутствии прежней верификации запись запрещена. `pagehide` больше не переписывает принятый сервером черновик после его `clear` (если React ещё не перерисовал пустое поле). Неизвестный результат POST по-прежнему **не** инициирует повторную отправку; пользователь проверяет серверную историю до ручного retry. Нативный диалог offline требует ручного `Повторить`.
5. `ci/verify-unsigned-policy.cjs` — локальный fail-closed preflight appId/profile compatibility, packaged guard modules, отсутствие релизного ключа, updates OFF и отсутствие автоматической установки. `ci/build-unsigned.ps1` — только на Windows с Node 24+, явный `electron-builder@26.17.0`, `CSC_IDENTITY_AUTO_DISCOVERY=false`, отказ при найденных signing credentials, `--publish never`, фактический SHA-256 EXE в `dist/SHA256SUMS.txt`. Это воспроизводимый _рецепт/входные параметры_, а не обещание побайтно идентичного EXE при разной цепочке npm/NSIS и не свидетельство собранного установщика.

## Не изменено (контракты и безопасность)

- `update-policy.cjs`, `update-service.cjs`, `update-trust.json`, `ci/create-signed-update.cjs` — побайтно как в базе: Ed25519 signature, immutable manifest, hash/size/origin, rollback на только заново проверенном staged EXE. `publicKeyPem` остаётся `null`: проверка и загрузка новых релизов выключены, никаких auto-run/auto-install.
- `appId: com.cosmora.desktop`, `cosmora-windows-desktop` userData, `persist:cosmora` Chromium partition, NSIS per-user, `deleteAppDataOnUninstall: false`. Никакой утечки backend bearer из main/preload; window `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- Drag/drop файлов использует тот же обработчик/лимиты, что и текущая скрепка, без бинарного IPC и без восстановления attachment bytes. Download policy по полной цепочке URL: только active-origin HTTPS/loopback HTTP и blob активного origin; внешние redirect, file:, data: и небезопасные протоколы запрещены. Deep links только `kosmora://open?path=...` с whitelist маршрутов и owner verification до открытия частной страницы. Второе окно блокируется single-instance lock.

## Сборка и rollback

В Windows checkout той же точной базы и после применения patch:

```powershell
cd desktop/windows
npm run check
npm run verify:unsigned
powershell -NoProfile -File ci/build-unsigned.ps1
Get-Content dist/SHA256SUMS.txt
```

Если требуется CI NSIS install/upgrade/uninstall, действующий `ci/nsis-lifecycle.ps1` запускают **только на disposable GitHub-hosted Windows runner** (он защищён соответствующим guard). На реальной машине нельзя обходить guard, устанавливать в автоматическом тесте или запускать непроверенный EXE. Обновление вручную: сохранить реальный проверенный предыдущий installer и SHA-256 → проверить текущий EXE Windows/антивирусом → backup профиля → запустить новый установщик самостоятельно → проверить session/draft изоляцию. Rollback — только ручная переустановка реально имеющегося прежнего установщика после проверки его происхождения; старый пользовательский профиль и БД приложения не переводятся автоматически назад.

## Проверки

`cd desktop/windows && npm run check`: 32 PASS, 1 SKIP (native Windows lifecycle guard), 0 FAIL. `node ci/verify-unsigned-policy.cjs`: PASS (updates OFF). `tsc --noEmit ... desktop-draft-bridge.ts chat-drop-policy.ts`: PASS. `node --experimental-strip-types --test apps/web/src/app/test/desktop-bridge-synthetic.test.mjs`: 3 PASS. Криптографические модули сопоставлены с точной базой. Patch roundtrip и SHA-256 артефактов — в отдельном `SHA256SUMS` пакета.

На Linux **НЕ проверены**: реальная Electron-сессия с cookie gateway, DPAPI, GUI/reconnect, drag/drop в окне, download в браузере, NSIS x64 installer, install/upgrade/uninstall, PowerShell/Windows lifecycle, Authenticode, hosted update/CDN/rollback и платный POST. Полный Next.js/React typecheck/E2E без зависимостей не объявляется пройденным. **0.11.2 — применимый кандидат в исходниках, не подписанный и не выпущенный Windows installer.**
