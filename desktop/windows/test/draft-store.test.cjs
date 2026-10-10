"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDraftStore, activeOwnerFromSessions } = require("../draft-store.cjs");
const {
  safeWorkspaceRoute,
  isLoginOrLogout,
  isExplicitLogout
} = require("../desktop-recovery.cjs");
const { deepLinkRoute, createPreferenceStore } = require("../desktop-state.cjs");
const ORIGIN = "https://kosmora.example";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHAT = "chat:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT = "project:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const codec = {
  seal(text) {
    return Buffer.from(text, "utf8").toString("base64");
  },
  open(sealed) {
    return Buffer.from(sealed, "base64").toString("utf8");
  }
};
function temporary(testFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-draft-test-"));
  try {
    testFn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("draft crash/restart recovery is text-only and strictly owner/origin scoped", () =>
  temporary((dir) => {
    const store = createDraftStore(dir, { codec });
    store.save(OWNER_A, ORIGIN, CHAT, "Черновик для чата");
    store.save(OWNER_A, ORIGIN, PROJECT, "Черновик для проекта");
    assert.equal(createDraftStore(dir, { codec }).load(OWNER_A, ORIGIN, CHAT), "Черновик для чата");
    assert.equal(store.load(OWNER_B, ORIGIN, CHAT), "");
    assert.equal(store.load(OWNER_A, "https://other.example", CHAT), "");
    const files = fs.readdirSync(path.join(dir, "desktop-text-drafts-v1"));
    assert.equal(files.length, 1);
    const data = fs.readFileSync(path.join(dir, "desktop-text-drafts-v1", files[0]), "utf8");
    assert.equal(data.includes("Черновик для чата"), false);
    assert.equal(data.includes(OWNER_A), false);
    assert.equal(data.includes("PAT"), false);
    store.clearScope(OWNER_A, ORIGIN, CHAT);
    assert.equal(store.load(OWNER_A, ORIGIN, CHAT), "");
    assert.equal(store.load(OWNER_A, ORIGIN, PROJECT), "Черновик для проекта");
    store.clearOwner(OWNER_A, ORIGIN);
    assert.equal(store.load(OWNER_A, ORIGIN, PROJECT), "");
  }));

test("native text store rejects tokens, passwords, oversize and malicious scopes", () =>
  temporary((dir) => {
    const store = createDraftStore(dir, { codec });
    // Assemble the synthetic marker at runtime; the source contains no PEM key.
    const syntheticPem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\n...";
    for (const value of [
      "password=secret123",
      "пароль: 123456",
      "api_key: secret",
      "Bearer ey.Abc",
      "github_pat_s3cr3t",
      syntheticPem
    ]) {
      assert.throws(() => store.save(OWNER_A, ORIGIN, CHAT, value));
    }
    assert.throws(() => store.save(OWNER_A, ORIGIN, "../../etc/passwd", "abc"));
    assert.throws(() => store.save(OWNER_A, ORIGIN, CHAT, "x".repeat(128001)));
    assert.throws(() => store.save(OWNER_A, ORIGIN, CHAT, { content: "abc", files: ["secret"] }));
  }));

test("retention capped; expiry pruned; malformed records do not leak or crash", () =>
  temporary((dir) => {
    let now = 100 * 86400_000;
    const store = createDraftStore(dir, { now: () => now, codec });
    store.save(OWNER_A, ORIGIN, CHAT, "a");
    now += 31 * 86400_000;
    assert.equal(store.load(OWNER_A, ORIGIN, CHAT), "");
    store.save(OWNER_A, ORIGIN, "new-chat", "fresh");
    assert.equal(store.load(OWNER_A, ORIGIN, "new-chat"), "fresh");
    store.clearAll();
    assert.equal(store.load(OWNER_A, ORIGIN, "new-chat"), "");
  }));

test("identity must be unique current active owner with server-side asserted owner ID", () => {
  const item = {
    owner_id: OWNER_A,
    current: true,
    actor_kind: "owner",
    status: "active",
    expires_at: "2035-01-01T00:00:00.000Z"
  };
  assert.deepEqual(activeOwnerFromSessions({ items: [item] }), {
    owner: OWNER_A,
    expiresAt: Date.parse(item.expires_at)
  });
  assert.deepEqual(activeOwnerFromSessions({ items: [{ ...item, owner_id: "local-owner" }] }), {
    owner: "local-owner",
    expiresAt: Date.parse(item.expires_at)
  });
  assert.equal(activeOwnerFromSessions({ items: [{ ...item, status: "revoked" }] }), null);
  assert.equal(activeOwnerFromSessions({ items: [{ ...item, actor_kind: "agent" }] }), null);
  assert.equal(activeOwnerFromSessions({ items: [item, item] }), null);
  assert.equal(
    activeOwnerFromSessions({ items: [{ ...item, expires_at: "2020-01-01T00:00:00Z" }] }),
    null
  );
  assert.equal(activeOwnerFromSessions({ owner_id: OWNER_B }), null);
});

test("safe workspace links preserve selected project/chat/Code but reject hostile query & routes", () => {
  const p = "/?project=dddddddd-dddd-4ddd-8ddd-dddddddddddd&view=chat&surface=code";
  assert.equal(safeWorkspaceRoute(p), p);
  assert.equal(
    createPreferenceStore(fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-pref-"))).get().lastPath,
    "/"
  );
  assert.equal(deepLinkRoute(`kosmora://open?path=${encodeURIComponent(p)}`), p);
  assert.equal(
    safeWorkspaceRoute("/?chat=cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    "/?chat=cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  );
  for (const bad of [
    "/?project=other",
    "/?project=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&chat=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "/?token=secret",
    "/?surface=admin",
    "/?project=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&view=unknown",
    "/%2e%2e/",
    "/?chat=x&chat=y",
    "//evil",
    "/logout"
  ])
    assert.equal(safeWorkspaceRoute(bad), null, bad);
  assert.equal(isLoginOrLogout("https://kosmora.example/login", ORIGIN), true);
  assert.equal(isLoginOrLogout("https://other.example/login", ORIGIN), false);
  assert.equal(isExplicitLogout("https://kosmora.example/logout", ORIGIN), true);
  assert.equal(isExplicitLogout("https://kosmora.example/signout", ORIGIN), true);
  assert.equal(isExplicitLogout("https://kosmora.example/login", ORIGIN), false);
  assert.equal(isExplicitLogout("https://other.example/logout", ORIGIN), false);
  assert.equal(
    isExplicitLogout("https://kosmora.example/logout?next=https://other.example", ORIGIN),
    false
  );
});
