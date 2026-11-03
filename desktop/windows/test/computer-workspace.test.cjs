"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createComputerWorkspace } = require("../computer-workspace.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const { createComputerHistory } = require("../computer-history.cjs");
const { validateComputerAction } = require("../computer-policy.cjs");
const { createKosworkWorkspaceService, createBackupStore } = require("../workspace/index.cjs");
const context = { owner: "owner", origin: "https://example.test" };
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-folder-integration-"));
  const root = path.join(base, "work"),
    profile = path.join(base, "profile");
  fs.mkdirSync(root);
  fs.mkdirSync(profile);
  t.after(() => {
    assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(base, { recursive: true, force: true });
  });
  const key = crypto.randomBytes(32);
  const codec = {
    seal(text) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, c.update(text, "utf8"), c.final(), c.getAuthTag()]).toString(
        "base64"
      );
    },
    open(text) {
      const b = Buffer.from(text, "base64"),
        d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(-16));
      return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8");
    }
  };
  const workspace = createComputerWorkspace({
    userDataPath: profile,
    codec,
    pickDirectory: async () => root
  });
  return { base, root, profile, codec, workspace };
}

test("large Unicode files can be read as literal versioned lines, without enabling whole-file replacement", async (t) => {
  const f = fixture(t),
    selected = await f.workspace.connect(context, new AbortController().signal);
  const name = "большой отчёт.txt";
  const content = Array.from({ length: 1000 }, (_, i) =>
    i === 499
      ? "Важное условие: 77 ₽, только после проверки"
      : `Строка ${i + 1}: исходные условия без изменений`
  ).join("\r\n");
  fs.writeFileSync(path.join(f.root, name), content, "utf8");
  const execute = (action) =>
    f.workspace.execute(validateComputerAction(action), {
      context,
      workspaceId: selected.id,
      signal: new AbortController().signal
    });
  await assert.rejects(
    execute({ kind: "workspace_read", path: name }),
    (e) => e.code === "WORKSPACE_FILE_TOO_LARGE"
  );
  const found = await execute({
    kind: "workspace_find",
    path: "",
    mode: "text",
    query: "Важное условие"
  });
  const source = found.matches[0];
  assert.equal(source.line, 500);
  const quote = await execute({
    kind: "workspace_read_lines",
    path: source.path,
    start_line: 499,
    end_line: 501,
    expected_version: source.version
  });
  assert.ok(content.includes(quote.content));
  assert.ok(quote.content.includes("77 ₽, только после проверки"));
  assert.equal(quote.version, source.version);
  assert.equal(quote.sha256, crypto.createHash("sha256").update(content).digest("hex"));
  assert.equal(quote.excerpt_only, true);
  assert.equal(quote.next_start_line, 502);
  assert.equal(quote.total_lines, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(quote)) < 1000);
  await assert.rejects(
    execute({
      kind: "workspace_update",
      path: name,
      content: "lost source",
      expected_version: quote.version
    }),
    (e) => e.code === "WORKSPACE_FILE_TOO_LARGE"
  );
  assert.equal(fs.readFileSync(path.join(f.root, name), "utf8"), content);
  fs.appendFileSync(path.join(f.root, name), "\r\nchanged");
  await assert.rejects(
    execute({
      kind: "workspace_read_lines",
      path: name,
      start_line: 502,
      end_line: 510,
      expected_version: quote.version
    }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  const fresh = await execute({
    kind: "workspace_read_lines",
    path: name,
    start_line: 1001,
    end_line: 1010,
    expected_version: null
  });
  assert.equal(fresh.content, "changed");
  assert.equal(fresh.end_line, 1001);
  assert.equal(fresh.next_start_line, null);
});

test("line reads retain source limits, protected paths and strict UTF-8 checks", async (t) => {
  const f = fixture(t),
    selected = await f.workspace.connect(context, new AbortController().signal);
  const execute = (name, overrides = {}) =>
    f.workspace.execute(
      validateComputerAction({
        kind: "workspace_read_lines",
        path: name,
        start_line: 1,
        end_line: 2,
        expected_version: null
      }),
      {
        context,
        workspaceId: selected.id,
        signal: new AbortController().signal,
        ...overrides
      }
    );
  fs.writeFileSync(path.join(f.root, "invalid.txt"), Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(path.join(f.root, "huge.txt"), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  await assert.rejects(execute("invalid.txt"), (e) => e.code === "WORKSPACE_BINARY_FILE");
  await assert.rejects(execute("huge.txt"), (e) => e.code === "WORKSPACE_FILE_TOO_LARGE");
  assert.throws(() => execute(".env"), /COMPUTER_ACTION_INVALID/);
  await assert.rejects(
    execute("invalid.txt", { context: { ...context, owner: "other" } }),
    /IDENTITY_CHANGED/
  );
});

test("search and excerpt line numbers agree for CR-only sources", async (t) => {
  const f = fixture(t),
    selected = await f.workspace.connect(context, new AbortController().signal);
  fs.writeFileSync(path.join(f.root, "old.txt"), "one\rtwo\rИскомое условие\rfour");
  const execute = (action) =>
    f.workspace.execute(validateComputerAction(action), {
      context,
      workspaceId: selected.id,
      signal: new AbortController().signal
    });
  const found = await execute({
    kind: "workspace_find",
    path: "",
    mode: "text",
    query: "Искомое условие"
  });
  assert.equal(found.matches[0].line, 3);
  const quote = await execute({
    kind: "workspace_read_lines",
    path: "old.txt",
    start_line: 3,
    end_line: 3,
    expected_version: found.matches[0].version
  });
  assert.equal(quote.content, "Искомое условие");
});
test("real temporary folder actions are scoped, versions are checked and production backups are encrypted", async (t) => {
  const f = fixture(t),
    selected = await f.workspace.connect(context, new AbortController().signal);
  const execute = (action, overrides = {}) =>
    f.workspace.execute(validateComputerAction(action), {
      context,
      workspaceId: selected.id,
      signal: new AbortController().signal,
      ...overrides
    });
  await execute({ kind: "workspace_create", path: "note.md", content: "private original note" });
  const first = await execute({ kind: "workspace_read", path: "note.md" });
  const updated = await execute({
    kind: "workspace_update",
    path: "note.md",
    content: "updated note",
    expected_version: first.version
  });
  await assert.rejects(
    execute({
      kind: "workspace_update",
      path: "note.md",
      content: "stale",
      expected_version: first.version
    }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  const backups = await execute({ kind: "workspace_backups", path: "note.md" });
  await execute({
    kind: "workspace_restore",
    backup_id: backups.backups[0].backupId,
    expected_version: updated.version
  });
  assert.equal(fs.readFileSync(path.join(f.root, "note.md"), "utf8"), "private original note");
  const backupRoot = path.join(f.profile, "koswork-backups", selected.id);
  for (const file of [
    path.join(backupRoot, "index.json"),
    ...fs.readdirSync(path.join(backupRoot, "blobs")).map((n) => path.join(backupRoot, "blobs", n))
  ]) {
    const bytes = fs.readFileSync(file, "utf8");
    for (const text of ["note.md", "private original note", "updated note"])
      assert.ok(!bytes.includes(text));
  }
  await assert.rejects(
    execute(
      { kind: "workspace_read", path: "note.md" },
      { context: { ...context, owner: "other" } }
    ),
    /IDENTITY_CHANGED/
  );
  await f.workspace.invalidate();
  await assert.rejects(execute({ kind: "workspace_read", path: "note.md" }), /WORKSPACE_CHANGED/);
  assert.equal(fs.readFileSync(path.join(f.root, "note.md"), "utf8"), "private original note");
  f.workspace.forget();
  assert.deepEqual(fs.readdirSync(path.join(f.profile, "koswork-backups")), []);
});
test("missing explicit owner scope, Unicode separators and protected directory descendants are refused", async (t) => {
  const f = fixture(t),
    service = createKosworkWorkspaceService({ userDataPath: f.profile, requireOwnerScope: true });
  await service.connectFolder({
    folderPath: f.root,
    ownerId: context.owner,
    origin: context.origin
  });
  await assert.rejects(
    service.readTextFile({ relativePath: "note.md" }),
    (e) => e.code === "WORKSPACE_OWNER_MISMATCH"
  );
  await assert.rejects(
    service.listFiles({ ownerId: context.owner }),
    (e) => e.code === "WORKSPACE_OWNER_MISMATCH"
  );
  for (const target of [
    "folder／.git／config",
    ".ssh/config",
    "folder/.env/secret",
    "../outside",
    "C:\\outside.txt",
    "file:stream",
    ".git/config"
  ])
    assert.throws(
      () => validateComputerAction({ kind: "workspace_read", path: target }),
      /ACTION_INVALID/
    );
  assert.equal(
    validateComputerAction({ kind: "workspace_create", path: "empty.txt", content: "" }).kind,
    "workspace_create"
  );
});
test("tampered backup index cannot read or prune a file outside its managed directory", async (t) => {
  const f = fixture(t),
    directory = path.join(f.profile, "backup-test"),
    store = createBackupStore(directory);
  const buffer = Buffer.from("original"),
    hash = crypto.createHash("sha256").update(buffer).digest("hex");
  store.saveBackup({
    relativePath: "note.txt",
    buffer,
    sha256: hash,
    version: "sha256:" + hash,
    originalMtimeMs: 1
  });
  const outside = path.join(f.profile, "keep.txt");
  fs.writeFileSync(outside, "keep");
  const file = path.join(directory, "index.json"),
    data = JSON.parse(fs.readFileSync(file));
  data.items[0].blobFilename = "../../keep.txt";
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(
    () => store.listBackups(),
    (e) => e.code === "WORKSPACE_BACKUP_UNAVAILABLE"
  );
  assert.throws(
    () =>
      store.saveBackup({
        relativePath: "note.txt",
        buffer,
        sha256: hash,
        version: "sha256:" + hash,
        originalMtimeMs: 1
      }),
    (e) => e.code === "WORKSPACE_BACKUP_UNAVAILABLE"
  );
  store.purgeAll();
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");
});
test("replacing a parent with a junction during update cannot overwrite the outside file", async (t) => {
  const f = fixture(t),
    service = createKosworkWorkspaceService({ userDataPath: f.profile });
  await service.connectFolder({ folderPath: f.root });
  await service.createFile({
    relativePath: "nested/note.txt",
    createParents: true,
    content: "original"
  });
  const read = await service.readTextFile({ relativePath: "nested/note.txt" });
  const outside = path.join(f.base, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "note.txt"), "outside");
  await assert.rejects(
    service.updateFile({
      relativePath: "nested/note.txt",
      content: "bad",
      expectedVersion: read.version,
      _beforeCommitHook: async () => {
        // Both paths are verified children of this test's unique temporary base.
        fs.renameSync(path.join(f.root, "nested"), path.join(f.root, "old-nested"));
        fs.symlinkSync(
          outside,
          path.join(f.root, "nested"),
          process.platform === "win32" ? "junction" : "dir"
        );
      }
    }),
    (e) => e.code === "WORKSPACE_SYMLINK_REJECTED"
  );
  assert.equal(fs.readFileSync(path.join(outside, "note.txt"), "utf8"), "outside");
  assert.equal(fs.readFileSync(path.join(f.root, "old-nested/note.txt"), "utf8"), "original");
});
test("stop can interrupt a directory scan and results never overflow the model result bound", async (t) => {
  const f = fixture(t),
    folder = await f.workspace.connect(context, new AbortController().signal);
  for (let i = 0; i < 80; i++) fs.writeFileSync(path.join(f.root, "note-" + i + ".txt"), "hello");
  const controller = new AbortController();
  const scan = f.workspace.execute(
    { kind: "workspace_find", path: "", mode: "name", query: "absent" },
    { context, workspaceId: folder.id, signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(scan, (e) => e.code === "WORKSPACE_OPERATION_CANCELLED");
  fs.writeFileSync(path.join(f.root, "escaped.txt"), "\x01".repeat(9000));
  const answer = await f.workspace.execute(
    { kind: "workspace_read", path: "escaped.txt" },
    { context, workspaceId: folder.id, signal: new AbortController().signal }
  );
  assert.equal(answer.error, "WORKSPACE_RESULT_TOO_LARGE");
  assert.ok(JSON.stringify(answer).length < 16000);
});
test("agent loop writes a real temp file after native consent, with journal and fresh observations", async (t) => {
  const f = fixture(t),
    folder = await f.workspace.connect(context, new AbortController().signal);
  const history = createComputerHistory(f.profile, { codec: f.codec }),
    confirmations = [],
    previous = [],
    observations = [];
  const action = {
    kind: "workspace_create",
    path: "agent-note.md",
    content: "Koswork local file result"
  };
  const actions = [
    action,
    action,
    { kind: "workspace_read", path: "agent-note.md" },
    { kind: "done", summary: "File verified" }
  ];
  const runner = new ComputerSession({
    history,
    workspace: f.workspace,
    identity: async () => context,
    confirm: async (input) => {
      confirmations.push(input);
      return true;
    },
    notify() {},
    planner: {
      begin: async () => ({ id: "fixture-session" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async (input) => {
        previous.push(input.previousResult);
        observations.push(input.observation);
        return { action: actions.shift(), message: "test", requires_confirmation: false };
      }
    },
    driver: {
      observe: async () => ({
        observation_id: "fake-screen",
        active_window: "42",
        width: 800,
        height: 600,
        image_jpeg_base64: "fake"
      }),
      execute: async () => {
        throw Error("No native desktop input permitted in this test");
      },
      stop() {}
    }
  });
  await runner.run({ project: "project", goal: "Create and verify a note in the selected folder" });
  assert.equal(fs.readFileSync(path.join(f.root, "agent-note.md"), "utf8"), action.content);
  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[0].workspace.id, folder.id);
  assert.equal(observations[0].workspace.id, folder.id);
  assert.equal(JSON.parse(previous[2]).created, true);
  assert.equal(JSON.parse(previous[3]).content, action.content);
  const record = history.list(context)[0];
  assert.equal(record.status, "completed");
  assert.equal(record.workspaceId, folder.id);
  assert.equal(record.steps[0].phase, "not_executed");
  assert.equal(record.steps[1].phase, "observed");
});
test("recovery cannot silently switch the original task to a different folder", async (t) => {
  const f = fixture(t),
    history = createComputerHistory(f.profile, { codec: f.codec });
  const task = history.start(context, {
    project: "project",
    goal: "Write a note",
    workspaceId: "a".repeat(24)
  });
  task.state("failed");
  await f.workspace.connect(context, new AbortController().signal);
  let confirmations = 0;
  const runner = new ComputerSession({
    history,
    workspace: f.workspace,
    identity: async () => context,
    confirm: async () => {
      confirmations++;
      return true;
    },
    notify() {},
    driver: { stop() {} },
    planner: { end: async () => {} }
  });
  await assert.rejects(
    runner.run({ project: "project", goal: "Write a note", recovery: { taskId: task.id } }),
    /WORKSPACE_CHANGED/
  );
  assert.equal(confirmations, 0);
});

test("replacing the selected directory with a new ordinary directory revokes the old scope", async (t) => {
  const f = fixture(t),
    original = await f.workspace.connect(context, new AbortController().signal);
  fs.renameSync(f.root, path.join(f.base, "previous-work"));
  fs.mkdirSync(f.root);
  fs.writeFileSync(path.join(f.root, "note.md"), "replacement");
  assert.throws(
    () => f.workspace.snapshot(context),
    (e) => e.code === "WORKSPACE_ROOT_CHANGED"
  );
  const selected = await f.workspace.connect(context, new AbortController().signal);
  assert.notEqual(selected.id, original.id);
});

test("binary browser transfers stay in the selected folder without overwriting an existing file", async (t) => {
  const f = fixture(t),
    selected = await f.workspace.connect(context, new AbortController().signal);
  fs.writeFileSync(path.join(f.root, "report.pdf"), "keep original");
  const reserved = f.workspace.reserveDownload(context, selected.id, "../report.pdf");
  assert.notEqual(reserved.name, "report.pdf");
  fs.writeFileSync(reserved.path, Buffer.from([0, 1, 255]));
  f.workspace.verifyDownload(context, selected.id, reserved.path, 3);
  assert.equal(f.workspace.uploadFile(context, selected.id, reserved.name), reserved.path);
  assert.equal(fs.readFileSync(path.join(f.root, "report.pdf"), "utf8"), "keep original");
  assert.throws(() => f.workspace.reserveDownload(context, selected.id, ".env"));
  assert.throws(
    () => f.workspace.uploadFile({ ...context, owner: "other" }, selected.id, reserved.name),
    /IDENTITY_CHANGED/
  );
  await f.workspace.invalidate();
  assert.throws(
    () => f.workspace.verifyDownload(context, selected.id, reserved.path, 3),
    /WORKSPACE_CHANGED/
  );
});
