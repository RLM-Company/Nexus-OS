"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const trust = JSON.parse(fs.readFileSync(path.join(root, "update-trust.json"), "utf8"));

test("download center files are packaged, syntax-checked and leave release trust disabled", () => {
  for (const relative of [
    "download-history.cjs",
    "download-center.cjs",
    "downloads-preload.cjs",
    "downloads.html",
    "downloads.css",
    "downloads.js"
  ]) {
    assert.equal(pkg.build.files.includes(relative), true, `${relative} must be packaged`);
    assert.equal(fs.existsSync(path.join(root, relative)), true, `${relative} must exist`);
    if (/\.(?:cjs|js)$/.test(relative)) {
      assert.match(pkg.scripts.check, new RegExp(relative.replaceAll(".", "\\.")));
    }
  }
  assert.equal(trust.publicKeyPem, null);
});
