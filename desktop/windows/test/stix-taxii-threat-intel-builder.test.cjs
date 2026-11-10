"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildStixAndYaraBundle,
  saveStixAndYaraToWorkspace
} = require("../workspace/stix-taxii-threat-intel-builder.cjs");

test("OASIS STIX 2.1 & YARA Threat Intel Builder emits valid STIX bundles and YARA rules", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-stix-yar-"));

  const built = buildStixAndYaraBundle({
    organizationName: "Kosmora Cyber Defense",
    indicators: [
      {
        name: "Prompt Injection Payload Hash",
        pattern: "[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']"
      }
    ],
    yaraRules: [
      {
        name: "Kosmora_Destructive_SQL_Guard",
        severity: "critical",
        strings: ["DROP TABLE", "TRUNCATE TABLE"]
      }
    ]
  });

  assert.equal(built.indicatorCount, 1);
  assert.equal(built.yaraRuleCount, 1);
  const stix = JSON.parse(built.stixJson);
  assert.equal(stix.type, "bundle");
  assert.equal(stix.objects.length, 2);
  assert.match(built.yaraText, /rule Kosmora_Destructive_SQL_Guard/);

  const saved = saveStixAndYaraToWorkspace(workspaceDir, "soc-bundle", {
    indicators: [{ name: "IoC-1" }],
    yaraRules: [{ name: "Rule_1" }]
  });

  assert.equal(fs.existsSync(saved.stixPath), true);
  assert.equal(fs.existsSync(saved.yaraPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveStixAndYaraToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
