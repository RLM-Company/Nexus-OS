"use strict";
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scenario, cases } = require("./fixtures/run-office-plan-isolation.cjs");
for (const [format, mutation] of cases) {
  test(`Office ${format}: ${mutation} mutation cannot change an approved write or receipt`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-plan-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await scenario(path.join(root, "files"), format, mutation);
  });
}
