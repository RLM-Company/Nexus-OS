"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ERROR_CODES, createKosworkWorkspaceService } = require("./index.cjs");

async function runWorkspaceDemo({ silent = false } = {}) {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-workspace-demo-"));
  const workspaceDir = path.join(tempBase, "owner-project");
  const userDataDir = path.join(tempBase, "profile-data");
  const outsideDir = path.join(tempBase, "outside-secret");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "secret.txt"), "top-secret-outside-workspace\n", "utf8");

  const steps = [];
  function record(step, summary, detail = {}) {
    steps.push({ step, summary, detail });
    if (!silent) {
      process.stdout.write(`[DEMO] ${step}: ${summary}\n`);
    }
  }

  try {
    const workspace = createKosworkWorkspaceService({
      userDataPath: userDataDir,
      requireOwnerScope: true,
      limits: {
        maxReadBytes: 64 * 1024,
        maxWriteBytes: 64 * 1024,
        maxListEntries: 25,
        maxSearchResults: 10
      },
      pickDirectory: async () => workspaceDir
    });

    // 1. Connect owner-selected folder
    const connected = await workspace.connectFolder({
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.equal(connected.connected, true);
    record("1. Подключение папки", `Подключена папка ${connected.rootName}`, {
      workspaceId: connected.workspaceId,
      rootName: connected.rootName
    });

    // 2. Create directories and initial files
    const dirResult = await workspace.createDirectory({
      relativePath: "docs/architecture",
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.equal(dirResult.created, true);

    const createdSpec = await workspace.createFile({
      relativePath: "docs/architecture/overview.md",
      content: "# Koswork Workspace\n\nInitial version v1 of architecture overview.\n",
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    const createdNotes = await workspace.createFile({
      relativePath: "notes/todo.txt",
      content: "- Проверить резервные копии\n- Проверить защиту от symlink\n",
      createParents: true,
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    record("2. Создание папок и файлов", "Созданы docs/architecture/overview.md и notes/todo.txt", {
      overviewVersion: createdSpec.version,
      notesVersion: createdNotes.version
    });

    // 3. Bounded file listing
    const listPage1 = await workspace.listFiles({
      maxEntries: 2,
      cursor: 0,
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.equal(listPage1.truncated, true);
    const listAll = await workspace.listFiles({
      maxEntries: 20,
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    record("3. Ограниченный список файлов", `Найдено элементов: ${listAll.count}`, {
      paths: listAll.items.map((item) => `${item.kind}:${item.path}`),
      page1Truncated: listPage1.truncated
    });

    // 4. Search by name and by text
    const nameHits = await workspace.searchByName({
      query: "overview",
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    const textHits = await workspace.searchByText({
      query: "резервные копии",
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.equal(nameHits.count, 1);
    assert.equal(textHits.count, 1);
    record("4. Поиск по имени и тексту", "Найдены совпадения по имени и содержимому", {
      nameMatch: nameHits.matches[0].path,
      textMatch: `${textHits.matches[0].path}:${textHits.matches[0].line}`
    });

    // 5. Read text file and update with version verification + backup
    const readV1 = await workspace.readTextFile({
      relativePath: "docs/architecture/overview.md",
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.equal(readV1.version, createdSpec.version);

    const updatedV2 = await workspace.updateFile({
      relativePath: "docs/architecture/overview.md",
      content: "# Koswork Workspace\n\nUpdated version v2 with optimistic concurrency check.\n",
      expectedVersion: readV1.version,
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.notEqual(updatedV2.version, readV1.version);
    assert.ok(updatedV2.backup?.backupId);
    record(
      "5. Обновление с проверкой версии и бэкапом",
      "Файл обновлён до v2, сохранена резервная копия",
      {
        previousVersion: updatedV2.previousVersion,
        newVersion: updatedV2.version,
        backupId: updatedV2.backup.backupId
      }
    );

    // 6. Reject stale version (optimistic concurrency protection)
    let conflictCode = null;
    try {
      await workspace.updateFile({
        relativePath: "docs/architecture/overview.md",
        content: "Stale overwrite attempt",
        expectedVersion: readV1.version,
        ownerId: "owner_demo_01",
        origin: "https://kosmora.example"
      });
    } catch (error) {
      conflictCode = error.code;
    }
    assert.equal(conflictCode, ERROR_CODES.WORKSPACE_VERSION_CONFLICT);
    record(
      "6. Защита от перезаписи устаревшей версией",
      `Конфликт версий отклонён (${conflictCode})`
    );

    // 7. Restore from backup
    const restored = await workspace.restoreBackup({
      backupId: updatedV2.backup.backupId,
      expectedVersion: updatedV2.version,
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    const readRestored = await workspace.readTextFile({
      relativePath: "docs/architecture/overview.md",
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example"
    });
    assert.equal(readRestored.version, readV1.version);
    record("7. Восстановление из резервной копии", "Восстановлена версия v1 из бэкапа", {
      restoredFromBackupId: restored.restoredFromBackupId,
      version: readRestored.version
    });

    // 8. Security boundary checks: path traversal, symlink/junction, remote webpage caller
    let traversalCode = null;
    try {
      await workspace.readTextFile({
        relativePath: "../outside-secret/secret.txt",
        ownerId: "owner_demo_01",
        origin: "https://kosmora.example"
      });
    } catch (error) {
      traversalCode = error.code;
    }
    assert.equal(traversalCode, ERROR_CODES.WORKSPACE_PATH_TRAVERSAL);

    let remoteCallerCode = null;
    try {
      await workspace.listFiles({
        ownerId: "owner_demo_01",
        origin: "https://kosmora.example",
        ipcEvent: { senderFrame: { url: "https://kosmora.example/chat" } }
      });
    } catch (error) {
      remoteCallerCode = error.code;
    }
    assert.equal(remoteCallerCode, ERROR_CODES.WORKSPACE_UNTRUSTED_CALLER);
    record(
      "8. Проверка границ безопасности",
      `Блокировка выхода за пределы папки (${traversalCode}) и удалённой веб-страницы (${remoteCallerCode})`
    );

    // 9. Cancellation and access revocation
    const abortCtrl = new AbortController();
    abortCtrl.abort("user_cancelled");
    let cancelCode = null;
    try {
      await workspace.searchByText({
        query: "Koswork",
        signal: abortCtrl.signal,
        ownerId: "owner_demo_01",
        origin: "https://kosmora.example"
      });
    } catch (error) {
      cancelCode = error.code;
    }
    assert.equal(cancelCode, ERROR_CODES.WORKSPACE_OPERATION_CANCELLED);

    const revoked = await workspace.revokeAccess({
      ownerId: "owner_demo_01",
      origin: "https://kosmora.example",
      purgeBackups: true
    });
    assert.equal(revoked.revoked, true);

    let afterRevokeCode = null;
    try {
      await workspace.listFiles({
        ownerId: "owner_demo_01",
        origin: "https://kosmora.example"
      });
    } catch (error) {
      afterRevokeCode = error.code;
    }
    assert.equal(afterRevokeCode, ERROR_CODES.WORKSPACE_NOT_CONNECTED);
    record(
      "9. Отмена и отзыв доступа",
      `Отмена (${cancelCode}) и отзыв доступа (${afterRevokeCode}) подтверждены`
    );

    return {
      ok: true,
      steps
    };
  } finally {
    assert.ok(path.resolve(tempBase).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runWorkspaceDemo()
    .then((result) => {
      process.stdout.write(`[DEMO] Успешно выполнено шагов: ${result.steps.length}\n`);
    })
    .catch((error) => {
      console.error("[DEMO] Ошибка демонстрации:", error);
      process.exitCode = 1;
    });
}

module.exports = { runWorkspaceDemo };
