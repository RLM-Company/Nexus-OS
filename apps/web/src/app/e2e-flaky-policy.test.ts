import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("CI rejects a browser failure even when its diagnostic retry succeeds", () => {
  const require = createRequire(import.meta.url);
  const playwright = require.resolve("@playwright/test");
  const original = fileURLToPath(new URL("../../playwright.config.ts", import.meta.url));
  const directory = mkdtempSync(resolve(tmpdir(), "kosmora-flaky-policy-"));
  try {
    writeFileSync(
      resolve(directory, "probe.spec.cjs"),
      `
      const { test } = require(${JSON.stringify(playwright)});
      test('synthetic failed attempt followed by successful retry', () => {
        if (test.info().retry === 0) throw new Error('Synthetic fixture failure');
      });
    `
    );
    writeFileSync(
      resolve(directory, "playwright.config.cjs"),
      `
      const config = require(${JSON.stringify(original)}).default;
      module.exports = {
        testDir: '.', workers: 1, retries: config.retries,
        failOnFlakyTests: config.failOnFlakyTests,
        reporter: 'json', timeout: 2000
      };
    `
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve(dirname(playwright), "cli.js"),
        "test",
        "--config",
        resolve(directory, "playwright.config.cjs")
      ],
      { env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 15000 }
    );
    expect(result.error).toBeUndefined();
    const report = JSON.parse(result.stdout) as {
      stats: { flaky: number; unexpected: number };
    };
    expect(report.stats).toMatchObject({ flaky: 1, unexpected: 0 });
    expect(result.status).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
