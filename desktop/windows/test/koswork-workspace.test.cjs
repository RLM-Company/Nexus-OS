"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ERROR_CODES,
  KosworkWorkspaceError,
  createKosworkWorkspaceService
} = require("../workspace/index.cjs");
const { runWorkspaceDemo } = require("../workspace/demo.cjs");

function fileOrDirectoryLink(target, file, type) {
  if (process.platform === "win32" && type !== "junction" && type !== "dir")
    return fs.linkSync(target, file);
  return fs.symlinkSync(target, file, type);
}

function withTempWorkspace(fn) {
  return async () => {
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-ws-test-"));
    const workspaceRoot = path.join(tempBase, "project");
    const userDataPath = path.join(tempBase, "user-data");
    const outsideDir = path.join(tempBase, "outside");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    try {
      await fn({ tempBase, workspaceRoot, userDataPath, outsideDir });
    } finally {
      assert.ok(path.resolve(tempBase).startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  };
}

test(
  "connects owner-selected folder without persisting its grant and enforces owner/origin isolation",
  withTempWorkspace(async ({ workspaceRoot, userDataPath }) => {
    const service = createKosworkWorkspaceService({
      userDataPath,
      requireOwnerScope: true,
      pickDirectory: async () => workspaceRoot
    });

    const connected = await service.connectFolder({
      ownerId: "owner-1",
      origin: "https://kosmora.example"
    });
    assert.equal(connected.connected, true);
    assert.equal(connected.rootPath, fs.realpathSync.native(workspaceRoot));
    assert.equal(connected.ownerId, "owner-1");
    assert.equal(connected.origin, "https://kosmora.example");

    assert.equal(fs.existsSync(path.join(userDataPath, "koswork-workspace-state.json")), false);

    const status = service.getStatus({
      ownerId: "owner-1",
      origin: "https://kosmora.example"
    });
    assert.equal(status.connected, true);

    await assert.rejects(
      () =>
        service.listFiles({
          ownerId: "owner-2",
          origin: "https://kosmora.example"
        }),
      (err) =>
        err instanceof KosworkWorkspaceError && err.code === ERROR_CODES.WORKSPACE_OWNER_MISMATCH
    );

    await assert.rejects(
      () =>
        service.listFiles({
          ownerId: "owner-1",
          origin: "https://other.example"
        }),
      (err) =>
        err instanceof KosworkWorkspaceError && err.code === ERROR_CODES.WORKSPACE_OWNER_MISMATCH
    );
  })
);

test(
  "rejects unsafe roots: relative paths, filesystem roots, system directories, userData overlap, and symlink roots",
  withTempWorkspace(async ({ tempBase, workspaceRoot, userDataPath, outsideDir }) => {
    const service = createKosworkWorkspaceService({ userDataPath });

    await assert.rejects(
      () => service.connectFolder({ folderPath: "relative/folder" }),
      (err) => err.code === ERROR_CODES.WORKSPACE_UNSAFE_ROOT
    );

    const fsRoot = path.parse(workspaceRoot).root;
    await assert.rejects(
      () => service.connectFolder({ folderPath: fsRoot }),
      (err) => err.code === ERROR_CODES.WORKSPACE_UNSAFE_ROOT
    );

    await assert.rejects(
      () => service.connectFolder({ folderPath: userDataPath }),
      (err) => err.code === ERROR_CODES.WORKSPACE_UNSAFE_ROOT
    );

    await assert.rejects(
      () => service.connectFolder({ folderPath: tempBase }),
      (err) => err.code === ERROR_CODES.WORKSPACE_UNSAFE_ROOT
    );

    const symlinkRoot = path.join(tempBase, "symlink-root");
    fileOrDirectoryLink(outsideDir, symlinkRoot, process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(
      () => service.connectFolder({ folderPath: symlinkRoot }),
      (err) => err.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
    );
  })
);

test(
  "enforces bounded file listing, depth limits, pagination, and skips symlinks/sensitive files",
  withTempWorkspace(async ({ workspaceRoot, userDataPath, outsideDir }) => {
    const service = createKosworkWorkspaceService({
      userDataPath,
      limits: { maxListEntries: 3, maxListDepth: 2 }
    });
    await service.connectFolder({ folderPath: workspaceRoot });

    await service.createDirectory({ relativePath: "a/b/c" });
    await service.createFile({ relativePath: "a/file1.txt", content: "one" });
    await service.createFile({ relativePath: "a/b/file2.txt", content: "two" });
    await service.createFile({ relativePath: "a/b/c/deep.txt", content: "three" });
    fs.writeFileSync(path.join(workspaceRoot, ".env"), "SECRET=123\n", "utf8");
    fs.writeFileSync(path.join(outsideDir, "escaped.txt"), "outside\n", "utf8");
    fileOrDirectoryLink(
      path.join(outsideDir, "escaped.txt"),
      path.join(workspaceRoot, "a", "escape-link.txt")
    );

    const page1 = await service.listFiles({ maxEntries: 2, cursor: 0 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.truncated, true);
    assert.equal(page1.nextCursor, 2);

    const page2 = await service.listFiles({ maxEntries: 2, cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.truncated, false);
    assert.equal(page2.nextCursor, null);

    const fullWithinDepth2 = await service.listFiles({ maxEntries: 20, maxDepth: 2 });
    const listedPaths = fullWithinDepth2.items.map((item) => item.path);
    assert.ok(listedPaths.includes("a"));
    assert.ok(listedPaths.includes("a/b"));
    assert.ok(listedPaths.includes("a/file1.txt"));
    assert.ok(
      !listedPaths.includes("a/b/c/deep.txt"),
      "depth 3 file must be excluded when maxDepth=2"
    );
    assert.ok(!listedPaths.includes(".env"), "sensitive .env file must be excluded");
    assert.ok(
      !listedPaths.includes("a/escape-link.txt"),
      "symlink must not be listed as normal file"
    );
    assert.ok(fullWithinDepth2.skippedSymlinks.includes("a/escape-link.txt"));
  })
);

test(
  "searches by filename and text with binary/size filtering and result bounds",
  withTempWorkspace(async ({ workspaceRoot, userDataPath }) => {
    const service = createKosworkWorkspaceService({
      userDataPath,
      limits: { maxSearchResults: 2, maxSearchFileBytes: 128 }
    });
    await service.connectFolder({ folderPath: workspaceRoot });

    await service.createFile({
      relativePath: "src/alpha-handler.ts",
      content: "export const token = 'KOSWORK_MARKER';\nconst second = 'KOSWORK_MARKER';\n",
      createParents: true
    });
    await service.createFile({
      relativePath: "src/beta-handler.ts",
      content: "export const third = 'KOSWORK_MARKER';\n",
      createParents: true
    });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "binary.bin"),
      Buffer.from("KOSWORK_MARKER\0binary", "utf8")
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "large.txt"),
      "KOSWORK_MARKER " + "x".repeat(200),
      "utf8"
    );

    const nameSearch = await service.searchByName({ query: "handler", maxResults: 10 });
    assert.equal(nameSearch.count, 2);
    assert.deepEqual(
      nameSearch.matches.map((m) => m.path),
      ["src/alpha-handler.ts", "src/beta-handler.ts"]
    );

    const textSearchBounded = await service.searchByText({
      query: "koswork_marker",
      caseSensitive: false,
      maxResults: 2
    });
    assert.equal(textSearchBounded.count, 2);
    assert.equal(textSearchBounded.truncated, true);

    const textSearchAll = await service.searchByText({
      query: "KOSWORK_MARKER",
      caseSensitive: true,
      maxResults: 10
    });
    assert.equal(textSearchAll.count, 3);
    assert.equal(textSearchAll.skippedBinaryFiles, 1);
    assert.equal(textSearchAll.skippedLargeFiles, 1);
  })
);

test(
  "creates, reads, updates files with SHA-256 version checks, stores backups, prunes old backups, and restores backups",
  withTempWorkspace(async ({ workspaceRoot, userDataPath }) => {
    const service = createKosworkWorkspaceService({
      userDataPath,
      limits: { maxBackups: 2 }
    });
    await service.connectFolder({ folderPath: workspaceRoot });

    const created = await service.createFile({
      relativePath: "config/settings.json",
      content: '{"mode":"initial"}\n',
      createParents: true
    });
    assert.equal(created.created, true);
    assert.match(created.version, /^sha256:[0-9a-f]{64}$/);

    await assert.rejects(
      () =>
        service.createFile({
          relativePath: "config/settings.json",
          content: '{"mode":"overwrite"}'
        }),
      (err) => err.code === ERROR_CODES.WORKSPACE_ALREADY_EXISTS
    );

    const read1 = await service.readTextFile({ relativePath: "config/settings.json" });
    assert.equal(read1.content, '{"mode":"initial"}\n');
    assert.equal(read1.version, created.version);

    await assert.rejects(
      () =>
        service.updateFile({
          relativePath: "config/settings.json",
          content: '{"mode":"bad"}',
          expectedVersion: "sha256:" + "0".repeat(64)
        }),
      (err) => err.code === ERROR_CODES.WORKSPACE_VERSION_CONFLICT
    );

    const updatedV2 = await service.updateFile({
      relativePath: "config/settings.json",
      content: '{"mode":"updated-v2"}\n',
      expectedVersion: read1.version
    });
    assert.equal(updatedV2.updated, true);
    assert.equal(updatedV2.previousVersion, read1.version);
    assert.notEqual(updatedV2.version, read1.version);
    assert.ok(updatedV2.backup?.backupId);

    const updatedV3 = await service.updateFile({
      relativePath: "config/settings.json",
      content: '{"mode":"updated-v3"}\n',
      expectedVersion: updatedV2.version
    });
    const updatedV4 = await service.updateFile({
      relativePath: "config/settings.json",
      content: '{"mode":"updated-v4"}\n',
      expectedVersion: updatedV3.version
    });

    // Since maxBackups is 2, only the 2 most recent backups (v3 and v2) are kept
    const backups = service.listBackups({ relativePath: "config/settings.json" });
    assert.equal(backups.length, 2);
    assert.equal(backups[0].backupId, updatedV4.backup.backupId);
    assert.equal(backups[1].backupId, updatedV3.backup.backupId);

    const restored = await service.restoreBackup({
      backupId: updatedV3.backup.backupId,
      expectedVersion: updatedV4.version
    });
    assert.equal(restored.restoredFromBackupId, updatedV3.backup.backupId);

    const readAfterRestore = await service.readTextFile({ relativePath: "config/settings.json" });
    assert.equal(readAfterRestore.content, '{"mode":"updated-v2"}\n');
    assert.equal(readAfterRestore.version, updatedV2.version);
  })
);

test(
  "serializes concurrent in-process updates and detects external disk races before commit",
  withTempWorkspace(async ({ workspaceRoot, userDataPath }) => {
    const service = createKosworkWorkspaceService({ userDataPath });
    await service.connectFolder({ folderPath: workspaceRoot });

    const created = await service.createFile({
      relativePath: "shared.txt",
      content: "version-1\n"
    });

    // Two concurrent in-process updateFile calls with the same initial expectedVersion:
    // exactly one must succeed and the second must reject with WORKSPACE_VERSION_CONFLICT.
    const results = await Promise.allSettled([
      service.updateFile({
        relativePath: "shared.txt",
        content: "writer-A\n",
        expectedVersion: created.version
      }),
      service.updateFile({
        relativePath: "shared.txt",
        content: "writer-B\n",
        expectedVersion: created.version
      })
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, ERROR_CODES.WORKSPACE_VERSION_CONFLICT);

    const afterInProcess = await service.readTextFile({ relativePath: "shared.txt" });

    // External writer modifies file on disk while updateFile is staging
    await assert.rejects(
      () =>
        service.updateFile({
          relativePath: "shared.txt",
          content: "agent-update-v3\n",
          expectedVersion: afterInProcess.version,
          _beforeCommitHook: async () => {
            fs.writeFileSync(
              path.join(workspaceRoot, "shared.txt"),
              "concurrent-external-writer\n",
              "utf8"
            );
          }
        }),
      (err) =>
        err instanceof KosworkWorkspaceError && err.code === ERROR_CODES.WORKSPACE_VERSION_CONFLICT
    );

    const currentOnDisk = await service.readTextFile({ relativePath: "shared.txt" });
    assert.equal(currentOnDisk.content, "concurrent-external-writer\n");
  })
);

test(
  "blocks path traversal, symlinks/junctions at file and parent levels, binary reads, oversized files, and remote webpages",
  withTempWorkspace(async ({ workspaceRoot, userDataPath, outsideDir }) => {
    const service = createKosworkWorkspaceService({
      userDataPath,
      limits: { maxReadBytes: 64, maxWriteBytes: 64 }
    });
    await service.connectFolder({ folderPath: workspaceRoot });

    const traversalPaths = [
      "../outside/file.txt",
      "sub/../../outside/file.txt",
      "/etc/passwd",
      "\\Windows\\System32\\drivers\\etc\\hosts",
      "C:\\Windows\\win.ini",
      "file.txt:zone.identifier",
      "NUL.txt",
      "COM1",
      "trailingdot.",
      "trailingspace ",
      "null\u0000byte.txt",
      ".git/config",
      ".koswork-backups/index.json",
      ".env.production",
      "keys/id_rsa"
    ];

    for (const badPath of traversalPaths) {
      await assert.rejects(
        () => service.readTextFile({ relativePath: badPath }),
        (err) =>
          err instanceof KosworkWorkspaceError &&
          (err.code === ERROR_CODES.WORKSPACE_PATH_TRAVERSAL ||
            err.code === ERROR_CODES.WORKSPACE_PROTECTED_PATH),
        `Expected rejection for path: ${badPath}`
      );
    }

    const outsideTarget = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideTarget, "outside-secret", "utf8");
    fileOrDirectoryLink(outsideTarget, path.join(workspaceRoot, "linked-secret.txt"));

    await assert.rejects(
      () => service.readTextFile({ relativePath: "linked-secret.txt" }),
      (err) => err.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
    );

    fileOrDirectoryLink(
      outsideDir,
      path.join(workspaceRoot, "linked-dir"),
      process.platform === "win32" ? "junction" : "dir"
    );

    await assert.rejects(
      () => service.readTextFile({ relativePath: "linked-dir/secret.txt" }),
      (err) => err.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
    );
    await assert.rejects(
      () =>
        service.createFile({
          relativePath: "linked-dir/new.txt",
          content: "escape"
        }),
      (err) => err.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
    );

    fs.writeFileSync(
      path.join(workspaceRoot, "image.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])
    );
    await assert.rejects(
      () => service.readTextFile({ relativePath: "image.png" }),
      (err) => err.code === ERROR_CODES.WORKSPACE_BINARY_FILE
    );

    await assert.rejects(
      () =>
        service.createFile({
          relativePath: "too-big.txt",
          content: "a".repeat(100)
        }),
      (err) => err.code === ERROR_CODES.WORKSPACE_FILE_TOO_LARGE
    );
    fs.writeFileSync(path.join(workspaceRoot, "disk-big.txt"), "b".repeat(100), "utf8");
    await assert.rejects(
      () => service.readTextFile({ relativePath: "disk-big.txt" }),
      (err) => err.code === ERROR_CODES.WORKSPACE_FILE_TOO_LARGE
    );

    await assert.rejects(
      () =>
        service.readTextFile({
          relativePath: "disk-big.txt",
          ipcEvent: { senderFrame: { url: "https://13.141.51.16/" } }
        }),
      (err) => err.code === ERROR_CODES.WORKSPACE_UNTRUSTED_CALLER
    );
  })
);

test(
  "supports operation cancellation and immediate access revocation mid-flight",
  withTempWorkspace(async ({ workspaceRoot, userDataPath }) => {
    const service = createKosworkWorkspaceService({ userDataPath });
    await service.connectFolder({ folderPath: workspaceRoot });
    const created = await service.createFile({ relativePath: "readme.md", content: "hello\n" });

    const abortController = new AbortController();
    abortController.abort("user_aborted");

    await assert.rejects(
      () => service.listFiles({ signal: abortController.signal }),
      (err) => err.code === ERROR_CODES.WORKSPACE_OPERATION_CANCELLED
    );

    // Revoke access mid-update via _beforeCommitHook
    await assert.rejects(
      () =>
        service.updateFile({
          relativePath: "readme.md",
          content: "updated-before-revoke\n",
          expectedVersion: created.version,
          _beforeCommitHook: async () => {
            await service.revokeAccess({ purgeBackups: true });
          }
        }),
      (err) => err.code === ERROR_CODES.WORKSPACE_OPERATION_CANCELLED
    );

    assert.equal(service.getStatus().connected, false);
    assert.equal(fs.readFileSync(path.join(workspaceRoot, "readme.md"), "utf8"), "hello\n");

    await assert.rejects(
      () => service.readTextFile({ relativePath: "readme.md" }),
      (err) => err.code === ERROR_CODES.WORKSPACE_NOT_CONNECTED
    );
  })
);

test("local temporary folder demo executes end-to-end without errors", async () => {
  const result = await runWorkspaceDemo({ silent: true });
  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 9);
});
