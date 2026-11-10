"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { createLocalVault } = require("../local-vault.cjs"),
  { createVaultWorkspace, VAULT_WORKSPACE_PREFIX: P } = require("../vault-workspace.cjs"),
  { createComputerWorkspace } = require("../computer-workspace.cjs"),
  { ComputerSession } = require("../computer-session.cjs"),
  { createWorkCycleDriver } = require("../work-cycle-driver.cjs");
const c = { owner: "alice", origin: "https://kosmora.test" };
const officeFixtures = require("./fixtures/office-import.json").files;
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-vault-agent-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("koswork-vault-agent-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const profile = path.join(dir, "profile"),
    folder = path.join(dir, "files"),
    storage = path.join(dir, "storage");
  for (const p of [profile, folder, storage]) fs.mkdirSync(p);
  const codec = {
    seal: (s) => Buffer.from(s).toString("base64"),
    open: (s) => Buffer.from(s, "base64").toString()
  };
  const vault = createLocalVault({ userDataPath: profile, codec });
  vault.choose(c, storage);
  const source = vault.put(
    c,
    "budget.md",
    Buffer.from("Цель — демка. Бюджет 17 350.25 ₽. Кроме иконок, ничего не менять.")
  );
  const base = createComputerWorkspace({
    userDataPath: profile,
    codec,
    pickDirectory: async () => folder,
    scopeNamespace: "work-cycle"
  });
  const workspace = createVaultWorkspace({ base, vault, ...options });
  const signal = new AbortController().signal;
  return {
    dir,
    profile,
    folder,
    storage,
    vault,
    base,
    workspace,
    source,
    signal,
    async grant() {
      return workspace.connectVault(c, signal, async () => true);
    },
    execute(action, id = workspace.snapshot(c)?.id) {
      return workspace.execute(action, { context: c, workspaceId: id, signal });
    }
  };
}
test("Office source excerpts require a vault grant and preserve original and extracted-text hashes", async (t) => {
  const f = fixture(t),
    file = officeFixtures[0],
    item = f.vault.put(c, file.name, Buffer.from(file.base64, "base64"));
  const p = P + "/" + item.id + "/0";
  await assert.rejects(f.execute({ kind: "workspace_read", path: p }));
  await f.grant();
  const read = await f.execute({ kind: "workspace_read", path: p });
  assert.equal(read.sha256, item.id);
  assert.equal(read.representation.kind, "office_text");
  assert.ok(read.content.includes("19 700 ₽, кроме доставки"));
  assert.equal(
    read.representation.sha256,
    crypto.createHash("sha256").update(read.content).digest("hex")
  );
  const bad = f.vault.put(c, "broken.docx", Buffer.from("corrupt"));
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + bad.id + "/0" }),
    (e) => e.code === "WORKSPACE_BINARY_FILE"
  );
  await f.workspace.revokeVault();
  await assert.rejects(f.execute({ kind: "workspace_read", path: p }));
});
test("document generators cannot turn a vault source into a writable workspace", async (t) => {
  const f = fixture(t);
  await f.grant();
  assert.equal(f.workspace.supportsDocuments(c), false);
  await assert.rejects(
    f.execute({
      kind: "workspace_create_docx",
      path: P + "/report.docx",
      title: "Report",
      sections: [{ heading: "", text: "Unauthorized write" }]
    }),
    (e) => e.code === "WORKSPACE_PROTECTED_PATH"
  );
});
test("ordinary file line readers cannot bypass the vault's opaque source protocol", async (t) => {
  const f = fixture(t);
  await f.grant();
  await assert.rejects(
    f.execute({
      kind: "workspace_read_lines",
      path: P + "/" + f.source.id + "/0",
      start_line: 1,
      end_line: 5,
      expected_version: null
    }),
    (e) => e.code === "WORKSPACE_PROTECTED_PATH"
  );
  const stillReadable = await f.execute({
    kind: "workspace_read",
    path: P + "/" + f.source.id + "/0"
  });
  assert.ok(stillReadable.content.includes("17 350.25"));
});

test("no agent access without a grant, then opaque listing/search/read return exact source data", async (t) => {
  const f = fixture(t);
  await f.workspace.connect(c, f.signal);
  await assert.rejects(
    f.execute({ kind: "workspace_list", path: P, cursor: 0 }),
    (e) => e.code === "WORKSPACE_PROTECTED_PATH"
  );
  const descriptor = await f.grant();
  assert.match(descriptor.id, /^[a-f0-9]{24}$/);
  const root = await f.execute({ kind: "workspace_list", path: "", cursor: 0 });
  assert.ok(root.items.some((i) => i.path === P));
  const result = await f.execute({
    kind: "workspace_find",
    path: P,
    mode: "text",
    query: "17 350.25"
  });
  assert.equal(result.matches[0].sha256, f.source.id);
  const read = await f.execute({ kind: "workspace_read", path: result.matches[0].path });
  assert.match(read.content, /Кроме иконок/);
  assert.equal(read.kind, "untrusted_local_excerpt");
  assert.equal(read.sha256, f.source.id);
  assert.equal(read.excerpt_only, false);
});
test("readonly vault and writeable output folder coexist, with no upload/download escape", async (t) => {
  const f = fixture(t);
  await f.workspace.connect(c, f.signal);
  await f.grant();
  for (const kind of [
    "workspace_create",
    "workspace_update",
    "workspace_mkdir",
    "workspace_backups"
  ]) {
    await assert.rejects(
      f.execute({
        kind,
        path: P + "/" + f.source.id + "/0",
        content: "overwrite",
        expected_version: "sha256:" + f.source.id
      }),
      (e) => e.code === "WORKSPACE_PROTECTED_PATH"
    );
  }
  await f.execute({ kind: "workspace_create", path: "report.md", content: "Separate output" });
  assert.equal(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), "Separate output");
  assert.match(f.vault.get(c, f.source.id).bytes.toString(), /17 350.25/);
  assert.throws(
    () => f.workspace.uploadFile(c, f.workspace.snapshot(c).id, P + "/" + f.source.id + "/0"),
    (e) => e.code === "WORKSPACE_PROTECTED_PATH"
  );
  assert.throws(
    () => f.workspace.reserveDownload(c, f.workspace.snapshot(c).id, P + "/download"),
    (e) => e.code === "WORKSPACE_PROTECTED_PATH"
  );
});
test("cancel, task end, owner changes and folder replacement revoke access", async (t) => {
  const f = fixture(t);
  const first = await f.grant();
  f.workspace.cancel();
  assert.equal(f.workspace.snapshot(c), null);
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + f.source.id + "/0" }, first.id),
    /COMPUTER_WORKSPACE_CHANGED/
  );
  await f.grant();
  assert.throws(() => f.workspace.snapshot({ ...c, owner: "bob" }), /COMPUTER_IDENTITY_CHANGED/);
  f.workspace.endSession();
  assert.equal(f.workspace.vaultState(c), false);
  await f.grant();
  f.vault.disconnect(c);
  assert.throws(() => f.workspace.snapshot(c), /COMPUTER_WORKSPACE_CHANGED/);
  assert.equal(f.workspace.vaultState(c), false);
});
test("ordinary workspace tools cannot bypass the grant via a storage parent or the physical vault root", async (t) => {
  const f = fixture(t);
  const codec = {
    seal: (s) => Buffer.from(s).toString("base64"),
    open: (s) => Buffer.from(s, "base64").toString()
  };
  const base = createComputerWorkspace({
    userDataPath: f.profile,
    codec,
    pickDirectory: async () => f.storage,
    scopeNamespace: "parent-fixture"
  });
  await base.connect(c, f.signal);
  const id = base.snapshot(c).id,
    physical = fs.readdirSync(f.storage)[0];
  for (const kind of ["workspace_read", "workspace_update"]) {
    await assert.rejects(
      base.execute(
        {
          kind,
          path: physical + "/" + f.source.id,
          content: "changed",
          expected_version: "sha256:" + f.source.id
        },
        { context: c, workspaceId: id, signal: f.signal }
      ),
      (e) => e.code === "WORKSPACE_PROTECTED_PATH"
    );
  }
  const listed = await base.execute(
    { kind: "workspace_list", path: "", cursor: 0 },
    { context: c, workspaceId: id, signal: f.signal }
  );
  assert.equal(
    listed.items.some((i) => i.name === physical),
    false
  );
  const direct = createComputerWorkspace({
    userDataPath: f.profile,
    codec,
    pickDirectory: async () => path.join(f.storage, physical),
    scopeNamespace: "direct-fixture"
  });
  await assert.rejects(direct.connect(c, f.signal), (e) => e.code === "WORKSPACE_PROTECTED_PATH");
  assert.match(f.vault.get(c, f.source.id).bytes.toString(), /17 350.25/);
});
test("Windows short-name expansion cannot hide a managed vault directory", (t) => {
  const f = fixture(t);
  const { resolveSafeWorkspaceTarget } = require("../workspace/path-guard.cjs");
  const managed = path.join(f.storage, fs.readdirSync(f.storage)[0]);
  const alias = path.join(f.storage, "KOSMOR~1");
  const realpath = fs.realpathSync.native;
  const root = realpath(f.storage);
  // Exercise a real 8.3 alias when the Windows volume has short names enabled.
  // Other volumes/platforms exercise the same canonical-path check with a mock.
  if (fs.existsSync(alias)) {
    assert.equal(realpath(alias), realpath(managed));
    assert.throws(
      () => resolveSafeWorkspaceTarget(root, "KOSMOR~1/" + f.source.id),
      (e) => e.code === "WORKSPACE_PROTECTED_PATH"
    );
    return;
  }
  fs.mkdirSync(alias);
  const replacement = t.mock.method(fs.realpathSync, "native", (value, ...args) =>
    path.resolve(String(value)) === path.join(root, "KOSMOR~1")
      ? realpath(managed)
      : realpath(value, ...args)
  );
  try {
    assert.throws(
      () => resolveSafeWorkspaceTarget(root, "KOSMOR~1/" + f.source.id),
      (e) => e.code === "WORKSPACE_PROTECTED_PATH"
    );
  } finally {
    replacement.mock.restore();
  }
});

test("an expired grant cannot read local sources or be silently renewed", async (t) => {
  let now = 1000;
  const f = fixture(t, { now: () => now });
  await f.grant();
  const id = f.workspace.snapshot(c).id;
  now += 30 * 60 * 1000;
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + f.source.id + "/0" }, id),
    /COMPUTER_WORKSPACE_CHANGED/
  );
  assert.equal(f.workspace.vaultState(c), false);
});
test("late confirmation cannot resurrect a stopped or replaced vault", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.workspace.connectVault(c, f.signal, async () => {
      f.workspace.cancel();
      return true;
    }),
    /COMPUTER_SESSION_STOPPED/
  );
  await assert.rejects(
    f.workspace.connectVault(c, f.signal, async () => {
      f.vault.disconnect(c);
      f.vault.choose(c, f.storage);
      return true;
    }),
    /COMPUTER_WORKSPACE_CHANGED/
  );
  assert.equal(f.workspace.vaultState(c), false);
});
test("large fragments keep exact numbers, offsets, hashes and UTF-16 boundaries", async (t) => {
  const f = fixture(t);
  const text = "🙂".repeat(3000) + "\nБюджет 17350.25. Не менять sidebar.\n" + "end ".repeat(2000);
  const item = f.vault.put(c, "large.md", Buffer.from(text));
  await f.grant();
  let next = P + "/" + item.id + "/0",
    joined = "",
    offset = 0;
  for (let i = 0; next && i < 20; i++) {
    const read = await f.execute({ kind: "workspace_read", path: next });
    assert.equal(read.offset_utf16, offset);
    assert.equal(read.content, text.slice(read.offset_utf16, read.end_utf16));
    assert.equal(read.sha256, item.id);
    assert.ok(JSON.stringify(read).length < 14000);
    joined += read.content;
    offset = read.end_utf16;
    next = read.next_path;
  }
  assert.equal(joined, text);
  assert.match(joined, /17350.25/);
});
test("search-by-name does not disclose contents and corrupt/deleted/binary originals fail closed", async (t) => {
  const f = fixture(t);
  await f.grant();
  const named = await f.execute({ kind: "workspace_find", path: P, mode: "name", query: "budget" });
  assert.equal(named.matches.length, 1);
  assert.equal(named.matches[0].snippet, undefined);
  const image = f.vault.put(c, "image.png", Buffer.from([1, 2, 3]));
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + image.id + "/0" }),
    (e) => e.code === "WORKSPACE_BINARY_FILE"
  );
  f.vault.remove(c, f.source.id);
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + f.source.id + "/0" }),
    (e) => e.code === "WORKSPACE_NOT_FOUND"
  );
  await assert.rejects(f.execute({ kind: "workspace_read", path: P + "/../secret" }));
});
test("driver cleanup failure still revokes the local vault grant", async (t) => {
  const f = fixture(t);
  await f.grant();
  let decisions = 0;
  const runner = new ComputerSession({
    driver: {
      observe: async () => ({
        observation_id: crypto.randomUUID(),
        active_window: "1",
        width: 100,
        height: 100,
        image_jpeg_base64: Buffer.from([255, 216, 255, 217]).toString("base64")
      }),
      stop() {
        throw Error("fixture cleanup failure");
      }
    },
    workspace: f.workspace,
    identity: async () => c,
    confirm: async () => true,
    notify() {},
    planner: {
      begin: async () => ({ id: "fixture" }),
      end: async () => {},
      next: async () => {
        decisions++;
        return {
          action: { kind: "done", summary: "Fixture" },
          message: "Fixture",
          requires_confirmation: false
        };
      }
    }
  });
  await assert.rejects(
    runner.run({ project: "project", goal: "Read-only fixture" }),
    /COMPUTER_RECOVERY_RESTART_REQUIRED/
  );
  assert.equal(decisions, 1);
  assert.equal(f.workspace.vaultState(c), false);
});
test("a bounded Koswork session searches the vault, writes a report and checks it without a screen grant", async (t) => {
  const f = fixture(t);
  await f.workspace.connect(c, f.signal);
  await f.grant();
  let currentResult = "",
    at = 0,
    reads = 0;
  const sourcePath = P + "/" + f.source.id + "/0";
  const actions = [
    () => ({
      kind: "work_plan",
      steps: [{ title: "Read and report", criteria: "Budget and exception retained" }]
    }),
    (obs) => ({
      kind: "work_step",
      step: 1,
      state: "running",
      evidence: "",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "workspace_find", path: P, mode: "text", query: "17 350.25" }),
    () => ({ kind: "workspace_read", path: sourcePath }),
    () => ({ kind: "workspace_create", path: "report.md", content: currentResult }),
    () => ({ kind: "workspace_read", path: "report.md" }),
    (obs) => ({
      kind: "work_step",
      step: 1,
      state: "checked",
      evidence: "Fresh file read retains exact budget and exception",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "done", summary: "Fixture report checked" })
  ];
  const driver = createWorkCycleDriver({
    browser: { stop() {} },
    computer: { stop() {} },
    identity: async () => c,
    confirmEnvironment: async () => {
      throw Error("Unexpected environment grant");
    }
  });
  const runner = new ComputerSession({
    executionMode: "work",
    driver,
    workspace: f.workspace,
    identity: async () => c,
    notify() {},
    confirm: async () => true,
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        if (at === 4) {
          const read = JSON.parse(previousResult);
          currentResult = read.content;
          assert.equal(read.sha256, f.source.id);
          reads++;
        }
        if (at === 6) assert.match(previousResult, /17 350.25/);
        return {
          action: actions[at++](observation),
          message: "Fixture only",
          requires_confirmation: false
        };
      }
    }
  });
  const result = await runner.run({
    project: "project",
    goal: "Use the approved local budget to prepare a report",
    maxSteps: 12
  });
  assert.equal(result.status, "completed");
  assert.equal(reads, 1);
  assert.match(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), /Кроме иконок/);
  assert.equal(f.workspace.vaultState(c), false);
  assert.ok(!f.workspace.snapshot(c).name.includes(P));
});

test("Vault wire responses stay bounded in UTF-8 across opaque continuation paths", async (t) => {
  const f = fixture(t);
  const text = '漢🚀\\"\t 00123; кроме доставки. '.repeat(700);
  const item = f.vault.put(c, "source.txt", Buffer.from(text));
  await f.grant();
  let next = P + "/" + item.id + "/0",
    joined = "";
  while (next) {
    const page = await f.execute({ kind: "workspace_read", path: next });
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 14000);
    assert.equal(page.error, undefined);
    assert.equal(page.sha256, item.id);
    assert.ok(page.content.isWellFormed());
    assert.ok(page.end_utf16 > page.offset_utf16);
    joined += page.content;
    next = page.next_path;
  }
  assert.equal(joined, text);
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + item.id + "/2" }),
    (e) => e.code === "WORKSPACE_PATH_TRAVERSAL"
  );
  f.workspace.revokeVault();
  await assert.rejects(f.execute({ kind: "workspace_read", path: P + "/" + item.id + "/0" }));
});

test("Koswork discovers an outline, follows a source section and loses access after revocation", async (t) => {
  const f = fixture(t);
  const text =
    "# Обзор\n" + "Вступление. ".repeat(900) + "\n## Условия 00123\nЦена 19 700 ₽, кроме доставки.";
  const item = f.vault.put(c, "manual.md", Buffer.from(text));
  await assert.rejects(f.execute({ kind: "workspace_read", path: P + "/" + item.id + "/outline" }));
  await f.grant();
  const listed = await f.execute({ kind: "workspace_list", path: P, cursor: 0 });
  const source = listed.items.find((i) => i.sha256 === item.id);
  assert.ok(source.outline_path.endsWith("/outline"));
  const outline = await f.execute({ kind: "workspace_read", path: source.outline_path });
  const section = outline.headings.find((h) => h.title === "Условия 00123");
  const read = await f.execute({ kind: "workspace_read", path: section.path });
  assert.equal(read.sha256, item.id);
  assert.ok(read.content.startsWith("## Условия 00123"));
  assert.ok(read.content.includes("19 700 ₽, кроме доставки"));
  assert.ok(Buffer.byteLength(JSON.stringify(outline)) <= 14000);
  f.workspace.revokeVault();
  await assert.rejects(f.execute({ kind: "workspace_read", path: section.path }));
});

test("outline wire budget includes every section link and refuses foreign or deleted originals", async (t) => {
  const f = fixture(t);
  const item = f.vault.put(
    c,
    "sections.md",
    Buffer.from(Array.from({ length: 100 }, () => "# " + "漢🚀".repeat(90)).join("\n"))
  );
  await f.grant();
  const p = P + "/" + item.id + "/outline";
  const outline = await f.execute({ kind: "workspace_read", path: p });
  assert.equal(outline.error, undefined);
  assert.equal(outline.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(outline)) <= 14000);
  await assert.rejects(
    f.workspace.execute(
      { kind: "workspace_read", path: p },
      {
        context: { ...c, owner: "other" },
        workspaceId: f.workspace.snapshot(c).id,
        signal: f.signal
      }
    )
  );
  f.vault.remove(c, item.id);
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: p }),
    (e) => e.code === "WORKSPACE_NOT_FOUND"
  );
});

test("Koswork follows opaque outline pages to a late source section and rechecks grants", async (t) => {
  const f = fixture(t);
  const text = Array.from({ length: 95 }, (_, i) => `# Section ${i}\nValue 00123 ${i}\n`).join("");
  const item = f.vault.put(c, "paginated.md", Buffer.from(text));
  await f.grant();
  let p = P + "/" + item.id + "/outline",
    found = [],
    last;
  while (p) {
    const r = await f.execute({ kind: "workspace_read", path: p });
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
    found.push(...r.headings);
    last = p;
    p = r.next_outline_path;
  }
  assert.deepEqual(
    found.map((h) => h.title),
    Array.from({ length: 95 }, (_, i) => `Section ${i}`)
  );
  const read = await f.execute({ kind: "workspace_read", path: found[94].path });
  assert.ok(read.content.startsWith("# Section 94\nValue 00123 94"));
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: P + "/" + item.id + "/outline/2" }),
    (e) => e.code === "WORKSPACE_PATH_TRAVERSAL"
  );
  f.workspace.revokeVault();
  await assert.rejects(f.execute({ kind: "workspace_read", path: last }));
});

test("paginated Vault search reaches every match and binds continuation to query, sources and grant", async (t) => {
  const f = fixture(t);
  const ids = [];
  for (let i = 0; i < 23; i++)
    ids.push(
      f.vault.put(c, `report-${i}.md`, Buffer.from(`needle ${i} 00123; кроме доставки.`)).id
    );
  await f.grant();
  for (const mode of ["text", "name"]) {
    const query = mode === "text" ? "needle" : "report-";
    let p = P,
      seen = [],
      first;
    do {
      const r = await f.execute({ kind: "workspace_find", path: p, mode, query });
      assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
      assert.ok(r.matches.length <= 8);
      seen.push(...r.matches.map((i) => i.sha256));
      first ??= r.next_search_path;
      p = r.next_search_path;
    } while (p);
    assert.deepEqual(seen, ids);
    await assert.rejects(
      f.execute({ kind: "workspace_find", path: first, mode, query: query + "changed" }),
      (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
    );
    const old = first;
    const newItem = f.vault.put(c, `unrelated-${mode}.txt`, Buffer.from(`other ${mode}`));
    await assert.rejects(
      f.execute({ kind: "workspace_find", path: old, mode, query }),
      (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
    );
    f.vault.remove(c, newItem.id);
  }
  const page = await f.execute({ kind: "workspace_find", path: P, mode: "text", query: "needle" });
  const read = await f.execute({ kind: "workspace_read", path: page.matches[0].path });
  assert.ok(read.content.includes("00123; кроме доставки"));
  f.workspace.revokeVault();
  await f.grant();
  await assert.rejects(
    f.execute({
      kind: "workspace_find",
      path: page.next_search_path,
      mode: "text",
      query: "needle"
    }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
});

test("search page budgets include escaped multilingual snippets and expose their truncation", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++)
    f.vault.put(
      c,
      `${i}-` + "漢".repeat(150) + ".md",
      Buffer.from(`needle ${i} ` + "漢🚀".repeat(300))
    );
  await f.grant();
  const r = await f.execute({ kind: "workspace_find", path: P, mode: "text", query: "needle" });
  assert.equal(r.matches.length, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
  assert.ok(r.matches.every((m) => m.snippet_truncated && m.snippet.isWellFormed()));
});

test("Vault listing pages are source-bound, complete and compatible with numeric cursors", async (t) => {
  const f = fixture(t),
    ids = [f.source.id];
  for (let i = 0; i < 24; i++)
    ids.push(f.vault.put(c, `source-${i}.txt`, Buffer.from(`original ${i}`)).id);
  await f.grant();
  let p = P,
    seen = [],
    first;
  do {
    const r = await f.execute({ kind: "workspace_list", path: p, cursor: 0 });
    assert.ok(r.items.length <= 10);
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
    seen.push(...r.items.map((i) => i.sha256));
    first ??= r.next_list_path;
    p = r.next_list_path;
  } while (p);
  assert.deepEqual(seen, ids);
  const legacy = await f.execute({ kind: "workspace_list", path: P, cursor: 10 });
  assert.deepEqual(
    legacy.items.map((i) => i.sha256),
    ids.slice(10, 20)
  );
  const added = f.vault.put(c, "new.txt", Buffer.from("new original"));
  await assert.rejects(
    f.execute({ kind: "workspace_list", path: first, cursor: 0 }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  await assert.rejects(
    f.execute({ kind: "workspace_list", path: P, cursor: 10 }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  const fresh = await f.execute({ kind: "workspace_list", path: P, cursor: 0 });
  assert.ok(fresh.next_list_path);
  f.vault.remove(c, added.id);
  await assert.rejects(
    f.execute({ kind: "workspace_list", path: fresh.next_list_path, cursor: 0 }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  const page = await f.execute({ kind: "workspace_list", path: P, cursor: 0 });
  f.workspace.revokeVault();
  await f.grant();
  await assert.rejects(
    f.execute({ kind: "workspace_list", path: page.next_list_path, cursor: 0 }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  await assert.rejects(
    f.execute({ kind: "workspace_list", path: P, cursor: 10 }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
});

test("real Work session navigates listing and outline pages before writing a verified report", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 23; i++) f.vault.put(c, `other-${i}.txt`, Buffer.from(`other document ${i}`));
  const text = Array.from(
    { length: 95 },
    (_, i) =>
      `# Section ${i}\n` + (i === 94 ? "00123: 19 700 ₽, кроме доставки." : "Reference section")
  ).join("\n");
  const target = f.vault.put(c, "target.md", Buffer.from(text));
  await f.workspace.connect(c, f.signal);
  await f.grant();
  let state = "plan",
    quote = "",
    listPages = 0,
    outlinePages = 0,
    approvals = 0;
  const driver = createWorkCycleDriver({
    browser: { stop() {} },
    computer: { stop() {} },
    identity: async () => c,
    confirmEnvironment: async () => {
      throw Error("Unexpected device permission");
    }
  });
  const runner = new ComputerSession({
    executionMode: "work",
    driver,
    workspace: f.workspace,
    identity: async () => c,
    notify() {},
    confirm: async () => {
      approvals++;
      return true;
    },
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        let action;
        if (state === "plan") {
          state = "start";
          action = {
            kind: "work_plan",
            steps: [
              {
                title: "Read source and verify report",
                criteria: "Exact late section and exception retained"
              }
            ]
          };
        } else if (state === "start") {
          state = "list";
          action = {
            kind: "work_step",
            step: 1,
            state: "running",
            evidence: "",
            observation_id: observation.observation_id
          };
        } else if (state === "list") {
          state = "listing";
          action = { kind: "workspace_list", path: P, cursor: 0 };
        } else if (state === "listing") {
          listPages++;
          const r = JSON.parse(previousResult),
            item = r.items.find((i) => i.sha256 === target.id);
          if (item) {
            state = "outline";
            action = { kind: "workspace_read", path: item.outline_path };
          } else {
            assert.ok(r.next_list_path);
            action = { kind: "workspace_list", path: r.next_list_path, cursor: 0 };
          }
        } else if (state === "outline") {
          outlinePages++;
          const r = JSON.parse(previousResult),
            h = r.headings.find((i) => i.title === "Section 94");
          if (h) {
            state = "source";
            action = { kind: "workspace_read", path: h.path };
          } else {
            assert.ok(r.next_outline_path);
            action = { kind: "workspace_read", path: r.next_outline_path };
          }
        } else if (state === "source") {
          const r = JSON.parse(previousResult);
          assert.equal(r.sha256, target.id);
          quote = r.content;
          assert.ok(quote.includes("00123: 19 700 ₽, кроме доставки."));
          state = "written";
          action = { kind: "workspace_create", path: "report.md", content: quote };
        } else if (state === "written") {
          state = "verify";
          action = { kind: "workspace_read", path: "report.md" };
        } else if (state === "verify") {
          assert.equal(JSON.parse(previousResult).content, quote);
          state = "done";
          action = {
            kind: "work_step",
            step: 1,
            state: "checked",
            evidence: "Output read back against exact source",
            observation_id: observation.observation_id
          };
        } else action = { kind: "done", summary: "Report verified" };
        return { action, message: "Scripted planner fixture", requires_confirmation: false };
      }
    }
  });
  const result = await runner.run({
    project: "project",
    goal: "Find the final section and create a report",
    maxSteps: 30
  });
  assert.equal(result.status, "completed");
  assert.equal(listPages, 3);
  assert.ok(outlinePages >= 3);
  assert.ok(approvals > 0);
  assert.equal(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), quote);
  assert.equal(f.workspace.vaultState(c), false);
});

test("outline section paths cannot leak a neighbouring section through continuation", async (t) => {
  const f = fixture(t);
  const text =
    "# First\n" +
    "00123; кроме доставки. 🚀 ".repeat(1500) +
    "\n# Neighbour\n99999; доставка включена.";
  const item = f.vault.put(c, "scoped.md", Buffer.from(text));
  await f.grant();
  const outline = await f.execute({ kind: "workspace_read", path: P + "/" + item.id + "/outline" });
  let p = outline.headings[0].path,
    actual = "";
  assert.ok(p.includes("/section/"));
  while (p) {
    const r = await f.execute({ kind: "workspace_read", path: p });
    assert.equal(r.kind, "untrusted_markdown_section_excerpt");
    assert.equal(r.sha256, item.id);
    assert.equal(r.section_end_utf16, text.indexOf("# Neighbour"));
    assert.ok(!r.content.includes("99999"));
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
    actual += r.content;
    p = r.next_path;
  }
  assert.equal(actual, text.slice(0, text.indexOf("# Neighbour")));
  const next = await f.execute({ kind: "workspace_read", path: outline.headings[1].path });
  assert.ok(next.content.includes("99999"));
  f.vault.remove(c, item.id);
  await assert.rejects(
    f.execute({ kind: "workspace_read", path: outline.headings[0].path }),
    (e) => e.code === "WORKSPACE_NOT_FOUND"
  );
});

test("Koswork searches a selected section, follows matches and binds search pages to query/grant", async (t) => {
  const f = fixture(t);
  const text =
    "# Selected\n" +
    "19700 ₽, кроме доставки.\n".repeat(19) +
    "# Other\n19700 ₽, доставка включена.";
  const item = f.vault.put(c, "prices.md", Buffer.from(text));
  await f.grant();
  const o = await f.execute({ kind: "workspace_read", path: P + "/" + item.id + "/outline" });
  const source = o.headings[0].path;
  let p = source,
    positions = [],
    first;
  while (p) {
    const r = await f.execute({ kind: "workspace_find", path: p, mode: "text", query: "19700 ₽" });
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
    positions.push(...r.matches.map((m) => m.offset_utf16));
    first ??= r.next_search_path;
    const read = await f.execute({ kind: "workspace_read", path: r.matches[0].path });
    assert.ok(read.content.startsWith("19700 ₽"));
    assert.ok(!read.content.includes("доставка включена"));
    p = r.next_search_path;
  }
  assert.equal(positions.length, 19);
  assert.equal(new Set(positions).size, 19);
  await assert.rejects(
    f.execute({ kind: "workspace_find", path: first, mode: "text", query: "other" }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
  f.workspace.revokeVault();
  await f.grant();
  await assert.rejects(
    f.execute({ kind: "workspace_find", path: first, mode: "text", query: "19700 ₽" }),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
});

test("section search fits escaped source snippets and resumes before every omitted match", async (t) => {
  const f = fixture(t);
  const query = String.fromCharCode(1).repeat(159) + "Q";
  const row = String.fromCharCode(2).repeat(80) + query + String.fromCharCode(3).repeat(80);
  const text = "# Selected\n" + (row + "\n").repeat(19) + "# Other\n" + query;
  const item = f.vault.put(c, "escaped.md", Buffer.from(text));
  await f.grant();
  let p = P + "/" + item.id + "/section/0/0",
    positions = [],
    pages = 0;
  while (p) {
    const r = await f.execute({ kind: "workspace_find", path: p, mode: "text", query });
    assert.equal(r.error, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(r), "utf8") <= 14000);
    assert.ok(r.matches.length > 0);
    for (const m of r.matches) {
      assert.equal(text.slice(m.offset_utf16, m.end_utf16), query);
      assert.equal(
        m.snippet,
        text.slice(m.snippet_offset_utf16, m.snippet_offset_utf16 + m.snippet.length)
      );
      positions.push(m.offset_utf16);
    }
    p = r.next_search_path;
    assert.ok(++pages < 20);
  }
  assert.ok(pages > 3, "actual JSON bytes must determine page size");
  const expected = [...text.slice(0, text.indexOf("# Other")).matchAll(new RegExp(query, "g"))].map(
    (m) => m.index
  );
  assert.deepEqual(positions, expected);
});

test("real Work session continues empty and populated section-search pages before verifying a report", async (t) => {
  const f = fixture(t);
  const clause = "00123: 19 700 ₽, кроме доставки.";
  const text =
    "# Selected\n" +
    "Reference 🚀. ".repeat(21000) +
    "\n" +
    Array.from({ length: 19 }, (_, i) => (i === 18 ? clause : `00123: reference row ${i}.`)).join(
      "\n"
    ) +
    "\n# Other\n00123: 99 999 ₽, доставка включена.";
  const target = f.vault.put(c, "contract.md", Buffer.from(text));
  await f.workspace.connect(c, f.signal);
  await f.grant();
  let state = "plan",
    section,
    quote,
    report,
    searchPages = 0,
    emptyPages = 0,
    approvals = 0;
  const observedPositions = [];
  const driver = createWorkCycleDriver({
    browser: { stop() {} },
    computer: { stop() {} },
    identity: async () => c,
    confirmEnvironment: async () => {
      throw Error("Unexpected device permission");
    }
  });
  const runner = new ComputerSession({
    executionMode: "work",
    driver,
    workspace: f.workspace,
    identity: async () => c,
    notify() {},
    confirm: async () => {
      approvals++;
      return true;
    },
    planner: {
      begin: async () => ({ id: "section-search-fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        let action;
        if (state === "plan") {
          state = "start";
          action = {
            kind: "work_plan",
            steps: [
              {
                title: "Verify contract clause",
                criteria: "Preserve price, identifier and delivery exception"
              }
            ]
          };
        } else if (state === "start") {
          state = "find-file";
          action = {
            kind: "work_step",
            step: 1,
            state: "running",
            evidence: "",
            observation_id: observation.observation_id
          };
        } else if (state === "find-file") {
          state = "outline";
          action = { kind: "workspace_find", path: P, mode: "name", query: "contract.md" };
        } else if (state === "outline") {
          const found = JSON.parse(previousResult).matches;
          assert.equal(found.length, 1);
          assert.equal(found[0].sha256, target.id);
          state = "section";
          action = { kind: "workspace_read", path: found[0].outline_path };
        } else if (state === "section") {
          section = JSON.parse(previousResult).headings.find((h) => h.title === "Selected").path;
          state = "begin-search";
          action = { kind: "workspace_read", path: section };
        } else if (state === "begin-search") {
          const r = JSON.parse(previousResult);
          assert.ok(!r.content.includes("00123"));
          assert.ok(r.next_path, "first excerpt alone cannot answer this task");
          state = "search";
          action = { kind: "workspace_find", path: section, mode: "text", query: "00123" };
        } else if (state === "search") {
          const r = JSON.parse(previousResult);
          assert.equal(r.sha256, target.id);
          assert.equal(r.match_mode, "exact_case_sensitive_literal");
          assert.ok(Buffer.byteLength(previousResult, "utf8") <= 14000);
          searchPages++;
          if (!r.matches.length) emptyPages++;
          observedPositions.push(...r.matches.map((m) => m.offset_utf16));
          const match = r.matches.find((m) => m.offset_utf16 === text.indexOf(clause));
          if (match) {
            assert.ok(match.snippet.includes(clause));
            state = "source";
            action = { kind: "workspace_read", path: match.path };
          } else {
            assert.ok(r.next_search_path, "an empty window is not absence from the full section");
            action = {
              kind: "workspace_find",
              path: r.next_search_path,
              mode: "text",
              query: "00123"
            };
          }
        } else if (state === "source") {
          const r = JSON.parse(previousResult);
          assert.equal(r.sha256, target.id);
          assert.equal(r.section_end_utf16, text.indexOf("# Other"));
          quote = r.content;
          assert.equal(quote.trim(), clause);
          assert.equal(r.next_path, null);
          report = `Источник SHA256: ${r.sha256}\n\n${quote}`;
          state = "written";
          action = { kind: "workspace_create", path: "contract-report.md", content: report };
        } else if (state === "written") {
          state = "verify";
          action = { kind: "workspace_read", path: "contract-report.md" };
        } else if (state === "verify") {
          assert.equal(JSON.parse(previousResult).content, report);
          state = "done";
          action = {
            kind: "work_step",
            step: 1,
            state: "checked",
            evidence: "Report bytes read back against the selected source clause and hash",
            observation_id: observation.observation_id
          };
        } else action = { kind: "done", summary: "Clause and report verified" };
        return { action, message: "Scripted planner fixture", requires_confirmation: false };
      }
    }
  });
  const result = await runner.run({
    project: "project",
    goal: "Find clause 00123 within Selected and create a verified report",
    maxSteps: 30
  });
  assert.equal(result.status, "completed");
  assert.equal(emptyPages, 1);
  assert.equal(searchPages, 4);
  assert.equal(observedPositions.length, 19);
  assert.equal(new Set(observedPositions).size, 19);
  assert.ok(approvals > 0);
  assert.equal(fs.readFileSync(path.join(f.folder, "contract-report.md"), "utf8"), report);
  assert.ok(!report.includes("99 999") && !report.includes("доставка включена"));
  assert.equal(f.workspace.vaultState(c), false);
  await assert.rejects(
    f.execute({ kind: "workspace_find", path: section, mode: "text", query: "00123" })
  );
});

test("text-page capability belongs to the selected folder and never opens a vault source", async (t) => {
  const f = fixture(t);
  await f.grant();
  assert.equal(f.workspace.supportsTextReads(c), false);
  const sourcePath = P + "/" + f.source.id + "/0";
  const virtual = {
    kind: "workspace_read_text",
    path: sourcePath,
    offset_utf16: 0,
    expected_version: null
  };
  await assert.rejects(f.execute(virtual), (e) => e.code === "WORKSPACE_PROTECTED_PATH");
  await f.workspace.connect(c, f.signal);
  await f.grant();
  assert.equal(f.workspace.supportsTextReads(c), true);
  await assert.rejects(f.execute(virtual), (e) => e.code === "WORKSPACE_PROTECTED_PATH");
  fs.writeFileSync(
    path.join(f.folder, "ordinary.txt"),
    "Exact selected-folder source 00123",
    "utf8"
  );
  const result = await f.execute({
    kind: "workspace_read_text",
    path: "ordinary.txt",
    offset_utf16: 0,
    expected_version: null
  });
  assert.equal(result.content, "Exact selected-folder source 00123");
  assert.equal(result.excerpt_only, false);
});

test("Work stops at the earliest session or Vault deadline while the planner waits", async (t) => {
  for (const scenario of [
    {
      name: "Vault expires first",
      age: 25 * 60 * 1000,
      duration: 30 * 60 * 1000,
      advance: 5 * 60 * 1000
    },
    { name: "session expires first", age: 0, duration: 20, advance: 20 }
  ])
    await t.test(scenario.name, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let clock = 0;
      const f = fixture(t, { now: () => clock });
      await f.workspace.connect(c, f.signal);
      await f.grant();
      clock = scenario.age;
      t.mock.timers.tick(clock);
      const cleanup = [];
      let enter,
        release,
        plannerSignal,
        cancelled = 0;
      const ready = new Promise((resolve) => {
        enter = resolve;
      });
      const cancel = f.base.cancel;
      f.base.cancel = () => {
        cancelled++;
        cancel();
      };
      const driver = createWorkCycleDriver({
        browser: {
          stop() {
            cleanup.push("browser");
          }
        },
        computer: {
          stop() {
            cleanup.push("computer");
          }
        },
        identity: async () => c,
        confirmEnvironment: async () => {
          throw Error("Unexpected device grant");
        }
      });
      const runner = new ComputerSession({
        executionMode: "work",
        driver,
        workspace: f.workspace,
        identity: async () => c,
        confirm: async () => true,
        notify() {},
        now: () => clock,
        planner: {
          begin: async () => ({ id: "fixture" }),
          authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
          end: async () => {},
          next: async ({ signal }) => {
            plannerSignal = signal;
            enter();
            return new Promise((resolve) => {
              release = resolve;
            });
          }
        }
      });
      const enable = runner.gate.enable.bind(runner.gate);
      runner.gate.enable = (args) => enable({ ...args, durationMs: scenario.duration });
      const pending = runner.run({
        project: "project",
        goal: "Read an approved local source",
        maxSteps: 2
      });
      await ready;
      cleanup.length = 0;
      clock += scenario.advance;
      t.mock.timers.tick(scenario.advance);
      const beforeLateReply = {
        aborted: plannerSignal.aborted,
        mounted: f.workspace.vaultState(c),
        cleanup: [...cleanup],
        cancelled
      };
      release({
        action: {
          kind: "work_plan",
          steps: [{ title: "Inspect source", criteria: "Verify exact quote" }]
        },
        message: "Late fixture",
        requires_confirmation: false
      });
      await assert.rejects(pending, /COMPUTER_SESSION_STOPPED|COMPUTER_WORKSPACE_CHANGED/);
      assert.equal(beforeLateReply.aborted, true);
      assert.equal(beforeLateReply.mounted, false);
      assert.deepEqual(beforeLateReply.cleanup, ["browser", "computer"]);
      assert.equal(beforeLateReply.cancelled, 1);
      assert.equal(runner.active, null);
    });
});

test("Vault remaining permission time is scoped, revoked and never reported as mounted after expiry", async (t) => {
  let clock = 0;
  const f = fixture(t, { now: () => clock });
  assert.equal(f.workspace.grantRemainingMs(c), null);
  await f.grant();
  assert.equal(f.workspace.grantRemainingMs(c), 30 * 60 * 1000);
  clock = 1000;
  assert.equal(f.workspace.grantRemainingMs(c), 30 * 60 * 1000 - 1000);
  assert.throws(
    () => f.workspace.grantRemainingMs({ ...c, owner: "other" }),
    /COMPUTER_IDENTITY_CHANGED/
  );
  f.workspace.revokeVault();
  assert.equal(f.workspace.grantRemainingMs(c), null);
  await f.grant();
  clock += 30 * 60 * 1000;
  assert.equal(f.workspace.vaultState(c), false);
  assert.throws(() => f.workspace.grantRemainingMs(c), /COMPUTER_WORKSPACE_CHANGED/);
  assert.equal(f.workspace.grantRemainingMs(c), null);
});
