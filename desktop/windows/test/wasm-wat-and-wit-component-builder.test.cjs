"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  WasmWatAndWitComponentBuilder
} = require("../workspace/wasm-wat-and-wit-component-builder.cjs");

test("WebAssembly WAT & Component Model WIT Builder emits valid .wat S-expressions and .wit worlds", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-wasm-wit-"));
  try {
    const res = WasmWatAndWitComponentBuilder.writeBundleFiles(tmpDir, "kosmora-plugin", {
      packageNamespace: "kosmora:kernel-plugin@1.0.0",
      worldName: "sandbox-plugin",
      memoryPages: 2,
      exportedFunctions: [
        {
          name: "compute-score",
          params: [
            { name: "a", wasmType: "i32", witType: "s32" },
            { name: "b", wasmType: "i32", witType: "s32" }
          ],
          resultWasmType: "i32",
          resultWitType: "s32",
          bodySExpr: "local.get $a local.get $b i32.add"
        }
      ]
    });

    assert.ok(res.watText.includes('(memory (export "memory") 2)'));
    assert.ok(res.watText.includes('(func (export "compute-score")'));
    assert.ok(res.witText.includes("package kosmora:kernel-plugin@1.0.0;"));
    assert.ok(res.witText.includes("compute-score: func(a: s32, b: s32) -> s32;"));
    assert.equal(fs.existsSync(res.watPath), true);
    assert.equal(fs.existsSync(res.witPath), true);
    assert.equal(res.bundleSha256.length, 64);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
