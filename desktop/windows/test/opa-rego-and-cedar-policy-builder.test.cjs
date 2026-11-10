"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  OpaRegoAndCedarPolicyBuilder
} = require("../workspace/opa-rego-and-cedar-policy-builder.cjs");

test("OPA Rego v1 & Cedar Policy Builder emits valid .rego and .cedar authorization bundles", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-rego-cedar-"));
  try {
    const res = OpaRegoAndCedarPolicyBuilder.writeBundleFiles(tmpDir, "kosmora-authz", {
      packagePath: "kosmora.kernel.guard",
      rules: [
        {
          effect: "permit",
          role: "kernel_operator",
          action: "execute_mutation",
          resourceType: "SqliteVault",
          requireMfa: true
        }
      ]
    });

    assert.ok(res.regoText.includes("import rego.v1"));
    assert.ok(res.regoText.includes('input.principal.role == "kernel_operator"'));
    assert.ok(res.cedarText.includes('principal in Role::"kernel_operator"'));
    assert.equal(fs.existsSync(res.regoPath), true);
    assert.equal(fs.existsSync(res.cedarPath), true);
    assert.equal(res.bundleSha256.length, 64);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
