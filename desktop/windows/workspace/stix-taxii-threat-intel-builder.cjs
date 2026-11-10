"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Zero-dependency OASIS STIX 2.1 Cyber Threat Intelligence Bundle (.stix.json) &
 * YARA Malware/Prompt-Injection Signature Rule Builder (.yar).
 */
function buildStixAndYaraBundle(spec = {}) {
  const nowIso = spec.timestampIso || new Date().toISOString();
  const indicators = Array.isArray(spec.indicators) ? spec.indicators : [];
  const yaraRules = Array.isArray(spec.yaraRules) ? spec.yaraRules : [];

  const stixObjects = [
    {
      type: "identity",
      spec_version: "2.1",
      id: "identity--kosmora-security-soc-0001",
      created: nowIso,
      modified: nowIso,
      name: spec.organizationName || "Kosmora Autonomous Security Center",
      identity_class: "organization"
    }
  ];

  for (let i = 0; i < indicators.length; i++) {
    const ind = indicators[i];
    const id = ind.id || `indicator--${crypto.randomUUID()}`;
    stixObjects.push({
      type: "indicator",
      spec_version: "2.1",
      id,
      created: nowIso,
      modified: nowIso,
      name: ind.name || `Threat Indicator #${i + 1}`,
      pattern: ind.pattern || "[file:hashes.'SHA-256' = '0000']",
      pattern_type: ind.patternType || "stix",
      valid_from: nowIso,
      indicator_types: ind.types || ["malicious-activity"]
    });
  }

  const stixBundle = {
    type: "bundle",
    id: `bundle--${crypto.randomUUID()}`,
    objects: stixObjects
  };

  const yaraBlocks = yaraRules.map((r, idx) => {
    const ruleName = String(r.name || `Kosmora_Rule_${idx + 1}`).replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    );
    const strings = Array.isArray(r.strings) && r.strings.length > 0
      ? r.strings
      : ["rm -rf /", "DROP TABLE"];
    const strLines = strings.map(
      (s, sIdx) => `    $s${sIdx + 1} = "${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" nocase`
    );

    return [
      `rule ${ruleName} {`,
      "  meta:",
      `    author = "Kosmora Threat Engine"`,
      `    severity = "${r.severity || "high"}"`,
      "  strings:",
      ...strLines,
      "  condition:",
      `    ${r.condition || "any of them"}`,
      "}"
    ].join("\n");
  });

  return {
    stixJson: JSON.stringify(stixBundle, null, 2) + "\n",
    yaraText: yaraBlocks.join("\n\n") + "\n",
    indicatorCount: indicators.length,
    yaraRuleCount: yaraRules.length
  };
}

function saveStixAndYaraToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "threat-intel")
    .replace(/\.(stix\.json|json|yar|yara)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const stixPath = path.resolve(resolvedWorkspace, `${cleanBase}.stix.json`);
  const yaraPath = path.resolve(resolvedWorkspace, `${cleanBase}.yar`);

  if (!stixPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildStixAndYaraBundle(spec);
  fs.writeFileSync(stixPath, built.stixJson, "utf8");
  fs.writeFileSync(yaraPath, built.yaraText, "utf8");

  return {
    stixPath,
    yaraPath,
    indicatorCount: built.indicatorCount,
    yaraRuleCount: built.yaraRuleCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.stixJson + built.yaraText, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildStixAndYaraBundle,
  saveStixAndYaraToWorkspace
};
