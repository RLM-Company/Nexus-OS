import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import {
  childEnvironment,
  options,
  sourceGraph,
  checkProductionProxy
} from "../presentation-demo.mjs";

test("the launcher discards inherited paid routes, credentials and executable preload settings", () => {
  const input = {
    PATH: "/test/bin",
    HOME: "/test/home",
    SystemRoot: "C:\\Windows",
    MODEL_PROVIDER: "openai-compatible",
    MODEL_API_KEY: "fixture-secret",
    MODEL_REGISTRY_PATH: "private.json",
    GITHUB_TOKEN: "fixture-secret",
    KOSMORA_MEDIA_OPENAI_API_KEY: "fixture-secret",
    KOSMORA_MEDIA_PAID_ENABLED: "true",
    KOSMORA_CODE_EXECUTOR_URL: "https://remote.invalid",
    NODE_OPTIONS: "--import=bad.mjs",
    DATABASE_URL: "file:customer.db",
    API_HOST: "0.0.0.0",
    API_PORT: "80"
  };
  const env = childEnvironment(input, options([]), "/isolated-demo");
  assert.equal(env.PATH, input.PATH);
  assert.equal(env.SystemRoot, input.SystemRoot);
  for (const key of [
    "MODEL_API_KEY",
    "MODEL_REGISTRY_PATH",
    "GITHUB_TOKEN",
    "KOSMORA_MEDIA_OPENAI_API_KEY",
    "KOSMORA_CODE_EXECUTOR_URL",
    "NODE_OPTIONS"
  ]) {
    assert.equal(Object.hasOwn(env, key), false, key);
  }
  assert.equal(env.MODEL_PROVIDER, "mock");
  assert.equal(env.MODEL_PROVIDER_ID, "mock");
  assert.equal(env.KOSMORA_MEDIA_PAID_ENABLED, "false");
  assert.equal(env.API_HOST, "127.0.0.1");
  assert.equal(env.API_PORT, "3310");
  assert.equal(env.DATABASE_URL, "file:/isolated-demo/demo.db");
  assert.equal(input.MODEL_PROVIDER, "openai-compatible");
});

test("ports are explicit, distinct and never accept URLs or wildcard hosts", () => {
  assert.deepEqual(options(["--check", "--production", "--api-port=4410", "--web-port=4400"]), {
    check: true,
    production: true,
    help: false,
    apiPort: 4410,
    webPort: 4400
  });
  for (const argv of [
    ["--api-port=0"],
    ["--api-port=65536"],
    ["--api-port=http://host"],
    ["--host=0.0.0.0"],
    ["--api-port=3300"],
    ["--delete"]
  ])
    assert.throws(() => options(argv));
});

test("source-backed demo graph carries exact excerpts and hashes without fabricating verification", () => {
  const graph = sourceGraph();
  assert.equal(graph.nodes.length, 7);
  assert.equal(graph.edges.length, 6);
  for (const edge of graph.edges.filter((edge) => edge.evidence)) {
    const source = graph.nodes.find((node) => node.key === edge.evidence.source);
    assert.ok(source.detail.includes(edge.evidence.excerpt));
    const path = edge.evidence.location.replace(/:\d+$/, "");
    const text = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.ok(text.includes(edge.evidence.excerpt));
    assert.ok(source.detail.includes(createHash("sha256").update(text).digest("hex")));
  }
  for (const node of graph.nodes) {
    assert.equal(Object.hasOwn(node, "verification_status"), false);
    assert.equal(Object.hasOwn(node, "confidence"), false);
  }
});

test("a changed or missing source excerpt stops seeding instead of manufacturing a citation", () => {
  assert.throws(() => sourceGraph(() => "The source was changed"), /no longer matches/);
});

test("a production build must route to this API before any processes or data are started", () => {
  const rule = { source: "/api/:path*", destination: "http://127.0.0.1:3100/api/:path*" };
  assert.doesNotThrow(() =>
    checkProductionProxy({ rewrites: { beforeFiles: [], afterFiles: [rule], fallback: [] } }, 3100)
  );
  assert.throws(() => checkProductionProxy({ rewrites: [rule] }, 3310), /bakes rewrites/);
  assert.throws(() => checkProductionProxy({ rewrites: [] }, 3310));
  assert.throws(() =>
    checkProductionProxy(
      { rewrites: [{ ...rule, destination: "https://remote.invalid/api/:path*" }] },
      3100
    )
  );
});
