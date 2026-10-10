"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDraftStore } = require("../draft-store.cjs");
const originA = "https://a.example";
const originB = "https://b.example";
const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const scope = "chat:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const codec = {
  seal: (s) => Buffer.from(s, "utf8").toString("base64"),
  open: (s) => Buffer.from(s, "base64").toString("utf8")
};
function file(dir, origin, owner) {
  const name =
    crypto
      .createHash("sha256")
      .update(origin + "\0" + owner)
      .digest("hex") + ".json";
  return path.join(dir, "desktop-text-drafts-v1", name);
}
test("valid ciphertext copied across accounts/origins cannot become a different owner's draft", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-isolation-"));
  try {
    const drafts = createDraftStore(dir, { codec });
    drafts.save(ownerA, originA, scope, "CONFIDENTIAL A");
    fs.copyFileSync(file(dir, originA, ownerA), file(dir, originA, ownerB));
    fs.copyFileSync(file(dir, originA, ownerA), file(dir, originB, ownerA));
    assert.equal(drafts.load(ownerA, originA, scope), "CONFIDENTIAL A");
    assert.equal(drafts.load(ownerB, originA, scope), "");
    assert.equal(drafts.load(ownerA, originB, scope), "");
    const raw = JSON.parse(fs.readFileSync(file(dir, originA, ownerA)));
    assert.equal(raw.version, 2);
    raw.records[scope].savedAt += 1;
    fs.writeFileSync(file(dir, originA, ownerA), JSON.stringify(raw));
    assert.equal(drafts.load(ownerA, originA, scope), "");
    drafts.clearAll();
    assert.deepEqual(fs.readdirSync(path.join(dir, "desktop-text-drafts-v1")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
