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
