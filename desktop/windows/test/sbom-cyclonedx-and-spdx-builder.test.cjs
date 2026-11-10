"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSbomCycloneDxAndSpdx,
  saveSbomBundleToWorkspace
} = require("../workspace/sbom-cyclonedx-and-spdx-builder.cjs");

test("SBOM CycloneDX 1.5 & SPDX 2.3 Builder emits valid supply-chain manifests with purl and SHA-256", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-sbom-"));

  const built = buildSbomCycloneDxAndSpdx({
    applicationName: "kosmora-os-kernel",
    applicationVersion: "2.12.0",
    components: [
      { name: "@kosmora/core", version: "2.12.0", license: "Apache-2.0" },
      { name: "@kosmora/db", version: "2.12.0", license: "MIT" }
    ]
  });

  assert.equal(built.componentCount, 2);
  const cdx = JSON.parse(built.cycloneDxJson);
  const spdx = JSON.parse(built.spdxJson);

  assert.equal(cdx.bomFormat, "CycloneDX");
  assert.equal(cdx.specVersion, "1.5");
  assert.equal(cdx.components.length, 2);
  assert.equal(spdx.spdxVersion, "SPDX-2.3");
  assert.equal(spdx.packages.length, 2);

  const saved = saveSbomBundleToWorkspace(workspaceDir, "release-sbom", {
    applicationName: "kosmora-os-kernel",
    components: [{ name: "@kosmora/core", version: "2.12.0" }]
  });

  assert.equal(fs.existsSync(saved.cdxPath), true);
  assert.equal(fs.existsSync(saved.spdxPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveSbomBundleToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
