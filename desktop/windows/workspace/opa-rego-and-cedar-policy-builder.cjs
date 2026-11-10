"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * CNCF Open Policy Agent Rego v1 (.rego) & Cedar Policy Language (.cedar)
 * Zero-Trust Authorization Bundle Builder for Kosmora Desktop Workspace.
 */
class OpaRegoAndCedarPolicyBuilder {
  static buildBundle(spec) {
    const packagePath = spec.packagePath || "kosmora.authz.v1";
    const rules = Array.isArray(spec.rules) ? spec.rules : [];

    const regoLines = [
      `package ${packagePath}`,
      `import rego.v1`,
      ``,
      `default allow := false`
    ];

    const cedarBlocks = [];

    for (const r of rules) {
      const effect = r.effect === "forbid" ? "forbid" : "permit";
      const role = r.role || "admin";
      const action = r.action || "read";
      const resourceType = r.resourceType || "WorkspaceArtifact";

      if (effect === "permit") {
        regoLines.push(``);
        regoLines.push(`allow if {`);
        regoLines.push(`  input.principal.role == "${role}"`);
        regoLines.push(`  input.action == "${action}"`);
        regoLines.push(`  input.resource.type == "${resourceType}"`);
        if (r.requireMfa) {
          regoLines.push(`  input.principal.mfa_verified == true`);
        }
        regoLines.push(`}`);
      }

      const whenClause = r.requireMfa
        ? `\nwhen {\n  principal.mfa_verified == true\n};`
        : ";";
      cedarBlocks.push(
        `${effect} (\n  principal in Role::"${role}",\n  action == Action::"${action}",\n  resource is ${resourceType}\n)${whenClause}`
      );
    }

    const regoText = regoLines.join("\n") + "\n";
    const cedarText = cedarBlocks.join("\n\n") + "\n";

    const bundleSha256 = crypto
      .createHash("sha256")
      .update(regoText)
      .update(cedarText)
      .digest("hex");

    return {
      regoText,
      cedarText,
      bundleSha256
    };
  }

  static writeBundleFiles(outputDir, baseName, spec) {
    fs.mkdirSync(outputDir, { recursive: true });
    const built = OpaRegoAndCedarPolicyBuilder.buildBundle(spec);
    const regoPath = path.join(outputDir, `${baseName}.rego`);
    const cedarPath = path.join(outputDir, `${baseName}.cedar`);
    fs.writeFileSync(regoPath, built.regoText, "utf8");
    fs.writeFileSync(cedarPath, built.cedarText, "utf8");
    return {
      ...built,
      regoPath,
      cedarPath
    };
  }
}

module.exports = { OpaRegoAndCedarPolicyBuilder };
