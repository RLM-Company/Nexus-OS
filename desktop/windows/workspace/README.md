# Рабочая папка Koswork (`desktop/windows/workspace/`)

Изолированный локальный модуль управления рабочей папкой владельца для десктопного клиента Windows (`desktop/windows/workspace/`). Модуль предоставляет строго ограниченный файловый контур поверх папки, явно выбранной владельцем в нативном диалоге ОС, без произвольного shell-доступа и без прямого доступа к файловой системе из удалённой веб-страницы.

## Состав модуля

- `index.cjs` — публичная точка входа модуля.
- `workspace-service.cjs` — сервис `createKosworkWorkspaceService`: подключение выбранной владельцем папки, статус, ограниченный список файлов, поиск по имени и тексту, чтение текстовых файлов, создание папок, безопасное создание и обновление файлов с проверкой `expectedVersion` (`sha256:<hex>`), автоматическое сохранение и восстановление резервных копий, отмена операций и отзыв доступа.
- `path-guard.cjs` — проверка корневого каталога (запрет корня диска, системных папок ОС, перекрытия `userData`), нормализация и валидация относительных путей, блокировка `..`, абсолютных/UNC путей, потоков NTFS ADS (`:`), зарезервированных имён устройств Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`), символических ссылок, Windows junction и reparse points на каждом сегменте пути, а также защита `.git`, `.koswork-backups` и файлов ключей/секретов (`.env*`, `*.pem`, `*.key`, `id_rsa` и др.).
- `version-backup.cjs` — вычисление версий содержимого (`sha256:<hex>`), строгое декодирование UTF-8 с отклонением бинарных файлов, потоковое чтение с контролем верхнего предела байт и `ino`/`mtimeMs`, а также хранилище резервных копий с проверкой SHA-256 перед заменой файла и квотированием (`maxBackups`, `maxTotalBackupBytes`).
- `errors.cjs` — типизированные ошибки `KosworkWorkspaceError` со стабильными кодами `ERROR_CODES` и единая проверка отмены (`AbortSignal`).
- `demo.cjs` — воспроизводимая локальная демонстрация полного жизненного цикла на временной папке ОС (`os.tmpdir()`).
- `workspace.test.cjs` (и `../test/koswork-workspace.test.cjs`) — модульные и интеграционные тесты (`node:test`).

## Инструкция подключения

### 1. Создание экземпляра в главном процессе Electron (`desktop/windows/`)

Модуль инициализируется исключительно в главном процессе Electron (или локальном Node-процессе оператора). В конструктор передаётся каталог профиля `app.getPath("userData")` и функция выбора папки через нативный диалог ОС `dialog.showOpenDialog`:

```js
"use strict";

const { app, dialog } = require("electron");
const { createKosworkWorkspaceService } = require("./workspace/index.cjs");

const kosworkWorkspace = createKosworkWorkspaceService({
  userDataPath: app.getPath("userData"),
  requireOwnerScope: true,
  pickDirectory: async () => {
    const result = await dialog.showOpenDialog({
      title: "Выберите рабочую папку Koswork",
      properties: ["openDirectory", "dontAddToRecent"]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  }
});
```

### 2. Использование основных операций

```js
// 1. Подключение выбранной владельцем папки (привязано к подтверждённому ownerId и origin)
const connection = await kosworkWorkspace.connectFolder({
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 2. Ограниченный список файлов (с лимитом глубины, количества и курсором пагинации)
const listing = await kosworkWorkspace.listFiles({
  relativePath: "",
  maxDepth: 4,
  maxEntries: 100,
  cursor: 0,
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 3. Поиск по имени файла и по текстовому содержимому
const byName = await kosworkWorkspace.searchByName({
  query: "config",
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});
const byText = await kosworkWorkspace.searchByText({
  query: "TODO",
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 4. Чтение текстового файла с получением версии sha256:<hex>
const file = await kosworkWorkspace.readTextFile({
  relativePath: "docs/plan.md",
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 5. Создание папки и нового текстового файла (без перезаписи существующих)
await kosworkWorkspace.createDirectory({
  relativePath: "docs/reports",
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});
const created = await kosworkWorkspace.createFile({
  relativePath: "docs/reports/summary.md",
  content: "# Отчёт\n",
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 6. Безопасное обновление файла с проверкой expectedVersion и автоматическим бэкапом
const updated = await kosworkWorkspace.updateFile({
  relativePath: "docs/plan.md",
  content: file.content + "\nОбновлённый раздел.\n",
  expectedVersion: file.version, // обязательная проверка хеша перед заменой
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 7. Восстановление из резервной копии при необходимости
await kosworkWorkspace.restoreBackup({
  backupId: updated.backup.backupId,
  expectedVersion: updated.version,
  ownerId: verifiedOwner.owner,
  origin: currentOrigin
});

// 8. Отмена активных операций и полный отзыв доступа к папке
kosworkWorkspace.cancelAllOperations("user_cancelled");
await kosworkWorkspace.revokeAccess({
  ownerId: verifiedOwner.owner,
  origin: currentOrigin,
  purgeBackups: false
});
```

### 3. Граница безопасности с удалённой веб-страницей

- Модуль **не экспортируется** в `window` для удалённых `https:`/`http:` страниц через `preload.cjs`.
- Если в метод передан `ipcEvent`, функция `assertNotRemoteWebCaller(ipcEvent)` проверяет `senderFrame.url` и немедленно отклоняет любой вызов не с локального протокола `file:` (`WORKSPACE_UNTRUSTED_CALLER`).
- Модуль не использует `child_process`, `exec`, `spawn` или `shell.openPath` и не допускает выполнения произвольных команд.

## Локальная демонстрация и тесты

Запуск демонстрации на временной папке ОС:

```bash
node desktop/windows/workspace/demo.cjs
```

Запуск модульных и интеграционных тестов:

```bash
node --test desktop/windows/test/koswork-workspace.test.cjs
```
