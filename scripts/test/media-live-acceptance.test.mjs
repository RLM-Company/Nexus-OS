/* global Response */
import { test } from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaAcceptanceConfig, runMediaAcceptance } from "../media-live-acceptance.mjs";

const argv = ["--confirm-live-paid-media"];
const validEnv = (path) => ({
  KOSMORA_MEDIA_LIVE_CONFIRM: "YES_RUN_PAID_ACCEPTANCE",
  KOSMORA_MEDIA_API_ORIGIN: "https://kosmora.example",
  KOSMORA_MEDIA_OWNER_BEARER_TOKEN: "fixture-owner-only",
  KOSMORA_MEDIA_LIVE_REPORT_DIR: path
});
test("import and incomplete confirmations never dispatch or create a report", async () => {
  for (const input of [
    { env: {}, argv },
    { env: validEnv(tmpdir()), argv: [] }
  ]) {
    let called = false;
    await assert.rejects(
      runMediaAcceptance({
        ...input,
        fetchImpl: () => {
          called = true;
          throw Error("must not fetch");
        }
      }),
      /LIVE_CONFIRMATION_REQUIRED/
    );
    assert.equal(called, false);
  }
});
test("rejects invalid origins, missing tokens and unbounded operation counts before dispatch", () => {
  for (const origin of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com/?token=secret"
  ])
    assert.throws(() =>
      mediaAcceptanceConfig({ ...validEnv(tmpdir()), KOSMORA_MEDIA_API_ORIGIN: origin }, argv)
    );
  for (const count of ["0", "4", "-1", "1.5", "Infinity", "NaN"])
    assert.throws(() =>
      mediaAcceptanceConfig({ ...validEnv(tmpdir()), KOSMORA_MEDIA_LIVE_MAX_OPS: count }, argv)
    );
  assert.throws(() =>
    mediaAcceptanceConfig({ ...validEnv(tmpdir()), KOSMORA_MEDIA_OWNER_BEARER_TOKEN: "" }, argv)
  );
  assert.throws(
    () => mediaAcceptanceConfig({ ...validEnv(tmpdir()), KOSMORA_MEDIA_LIVE_MAX_OPS: "3" }, argv),
    /SPOKEN_WAV/
  );
});
test("verifies authenticated bytes against hash, size and MIME with one POST and no redirects", async () => {
  const path = mkdtempSync(join(tmpdir(), "kosmora-media-guard-"));
  const bytes = Buffer.from("fixture-binary");
  const id = "f70d2912-97f1-42cf-acf1-92569da40c1c";
  const asset = {
    bytes: bytes.length,
    mime: "image/png",
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
  const calls = [];
  try {
    const result = await runMediaAcceptance({
      env: validEnv(path),
      argv,
      fetchImpl: async (url, options) => {
        calls.push([url, options]);
        assert.equal(options.redirect, "error");
        assert.equal(options.credentials, "omit");
        assert.ok(options.signal);
        assert.equal(options.headers.Authorization, "Bearer fixture-owner-only");
        if (url.endsWith("/capabilities"))
          return Response.json({ capabilities: { image_generation: { ready: true } } });
        if (options.method === "POST") return Response.json({ id });
        if (url.includes("/assets/"))
          return new Response(bytes, { headers: { "content-type": "image/png" } });
        return Response.json({
          id,
          kind: "image",
          status: "done",
          budget_state: "uncertain",
          asset
        });
      }
    });
    assert.equal(result.passed, true);
    assert.equal(calls.filter(([, options]) => options.method === "POST").length, 1);
    const raw = readFileSync(result.reportPath, "utf8");
    assert.ok(!raw.includes("fixture-owner-only"));
    const report = JSON.parse(raw);
    assert.equal(report.provider_invoice_reconciled, false);
    assert.equal(report.operations[0].verified_download, true);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test("unknown POST outcome stops all later operations without retry or saved secrets", async () => {
  const path = mkdtempSync(join(tmpdir(), "kosmora-media-guard-"));
  let posts = 0;
  try {
    const result = await runMediaAcceptance({
      env: { ...validEnv(path), KOSMORA_MEDIA_LIVE_MAX_OPS: "2" },
      argv,
      fetchImpl: async (_url, options) => {
        if (options.method === "POST") {
          posts++;
          throw Error("credential and private provider diagnostic");
        }
        return Response.json({
          capabilities: { image_generation: { ready: true }, speech: { ready: true } }
        });
      }
    });
    assert.equal(result.passed, false);
    assert.equal(posts, 1);
    const raw = readFileSync(result.reportPath, "utf8");
    assert.ok(!raw.includes("private provider"));
    assert.equal(JSON.parse(raw).operations[0].status, "outcome_unknown");
    assert.equal(readdirSync(path).length, 1);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});
test("failed hash or a foreign operation identity cannot pass acceptance", async () => {
  const id = "f70d2912-97f1-42cf-acf1-92569da40c1c";
  for (const wrongIdentity of [false, true]) {
    const path = mkdtempSync(join(tmpdir(), "kosmora-media-guard-"));
    try {
      const result = await runMediaAcceptance({
        env: validEnv(path),
        argv,
        fetchImpl: async (url, options) => {
          if (url.endsWith("/capabilities"))
            return Response.json({ capabilities: { image_generation: { ready: true } } });
          if (options.method === "POST") return Response.json({ id });
          if (url.includes("/assets/"))
            return new Response("bad bytes", { headers: { "content-type": "image/png" } });
          return Response.json({
            id: wrongIdentity ? "foreign" : id,
            kind: "image",
            status: "done",
            asset: { bytes: 9, mime: "image/png", sha256: "0".repeat(64) }
          });
        }
      });
      assert.equal(result.passed, false);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  }
});
