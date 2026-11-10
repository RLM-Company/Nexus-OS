"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Zero-dependency CycloneDX 1.5 JSON (.cdx.json) & SPDX 2.3 JSON (.spdx.json)
 * Software Bill of Materials (SBOM) Supply-Chain Bundle Builder.
 */
function buildSbomCycloneDxAndSpdx(spec = {}) {
  const appName = spec.applicationName || "kosmora-autonomous-os";
  const appVersion = spec.applicationVersion || "2.12.0";
  const timestamp = spec.timestampIso || new Date().toISOString();
  const components = Array.isArray(spec.components) ? spec.components : [];

  const cdxComponents = components.map((c) => {
    const name = c.name || "unknown-pkg";
    const version = c.version || "1.0.0";
    const licenseId = c.license || "MIT";
    const sha256 =
      c.sha256 ||
      crypto.createHash("sha256").update(`${name}@${version}`, "utf8").digest("hex");

    return {
      type: c.type || "library",
      "bom-ref": `pkg:npm/${name}@${version}`,
      name,
      version,
      purl: `pkg:npm/${name}@${version}`,
      hashes: [{ alg: "SHA-256", content: sha256 }],
      licenses: [{ license: { id: licenseId } }]
    };
  });

  const cycloneDxObj = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp,
      component: {
        type: "application",
        "bom-ref": `pkg:generic/${appName}@${appVersion}`,
        name: appName,
        version: appVersion
      }
    },
    components: cdxComponents
  };

  const spdxPackages = components.map((c, idx) => {
    const name = c.name || `pkg-${idx + 1}`;
    const version = c.version || "1.0.0";
    const licenseId = c.license || "MIT";
    const sha256 =
      c.sha256 ||
      crypto.createHash("sha256").update(`${name}@${version}`, "utf8").digest("hex");

    return {
      SPDXID: `SPDXRef-Package-${name.replace(/[^a-zA-Z0-9.-]/g, "-")}`,
      name,
      versionInfo: version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: licenseId,
      licenseDeclared: licenseId,
      checksums: [{ algorithm: "SHA256", checksumValue: sha256 }],
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${name}@${version}`
        }
      ]
    };
  });

  const spdxObj = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${appName}-${appVersion}-sbom`,
    documentNamespace: `https://kosmora.local/spdx/${appName}-${appVersion}`,
    creationInfo: {
      created: timestamp,
      creators: ["Tool: Kosmora-SBOM-Engine-1.0"]
    },
    packages: spdxPackages
  };

  return {
    cycloneDxJson: JSON.stringify(cycloneDxObj, null, 2) + "\n",
    spdxJson: JSON.stringify(spdxObj, null, 2) + "\n",
    componentCount: components.length
  };
}

function saveSbomBundleToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "kosmora-sbom")
    .replace(/\.(cdx\.json|spdx\.json|json)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const cdxPath = path.resolve(resolvedWorkspace, `${cleanBase}.cdx.json`);
  const spdxPath = path.resolve(resolvedWorkspace, `${cleanBase}.spdx.json`);

  if (!cdxPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildSbomCycloneDxAndSpdx(spec);
  fs.writeFileSync(cdxPath, built.cycloneDxJson, "utf8");
  fs.writeFileSync(spdxPath, built.spdxJson, "utf8");

  return {
    cdxPath,
    spdxPath,
    componentCount: built.componentCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.cycloneDxJson + built.spdxJson, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildSbomCycloneDxAndSpdx,
  saveSbomBundleToWorkspace
};
