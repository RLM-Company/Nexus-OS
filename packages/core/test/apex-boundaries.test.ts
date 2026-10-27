import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { KosmoraEnterpriseSecurityEngine } from "../src/apex/kosmora-enterprise-security.js";
import { KosmoraRuntimeStore } from "../src/apex/kosmora-runtime-store.js";
import {
  KosmoraFinOpsComplianceEngine,
  type PrivacyAccountant
} from "../src/apex/kosmora-finops-compliance-engine.js";
import { queryReadOnlyDataset } from "../src/apex/read-only-dataset.js";
const principal = {
  tenant_id: "tenant",
  user_id: "owner",
  workspace_ids: ["workspace"],
  role: "owner" as const,
  mfa_verified: true
};
it("requires an explicit private key and rejects both public-key and unregistered-owner tokens", () => {
  const previous = process.env.KOSMORA_ENTERPRISE_MASTER_KEY;
  delete process.env.KOSMORA_ENTERPRISE_MASTER_KEY;
  try {
    expect(() => new KosmoraEnterpriseSecurityEngine()).toThrow("ENTERPRISE_MASTER_KEY_REQUIRED");
  } finally {
    if (previous !== undefined) process.env.KOSMORA_ENTERPRISE_MASTER_KEY = previous;
  }
  const key = randomBytes(32).toString("hex"),
    engine = new KosmoraEnterpriseSecurityEngine(key);
  const payload = Buffer.from(
    JSON.stringify({ ...principal, exp: new Date(Date.now() + 60000).toISOString() })
  ).toString("base64url");
  const sign = (master: Buffer) =>
    "ksm_sess." +
    payload +
    "." +
    createHmac(
      "sha256",
      createHash("sha256")
        .update(Buffer.concat([master, Buffer.from(":session-hmac-v1")]))
        .digest()
    )
      .update(payload)
      .digest("base64url");
  expect(() =>
    engine.verifySignedSessionToken(
      sign(createHash("sha256").update("kosmora-sovereign-enterprise-kms-default-key").digest())
    )
  ).toThrow();
  expect(() => engine.verifySignedSessionToken(sign(Buffer.from(key, "hex")))).toThrow(
    "UNREGISTERED_OR_CHANGED_PRINCIPAL"
  );
  expect(engine.authorizeAction(principal, "tenant", "workspace", "workspace:read").allowed).toBe(
    false
  );
  const token = engine.issueSignedSessionToken(principal).token;
  expect(engine.verifySignedSessionToken(token)).toMatchObject(principal);
  expect(
    engine.authenticateAndAuthorize(token, "other-tenant", "workspace", "workspace:read").allowed
  ).toBe(false);
  expect(
    engine.authenticateAndAuthorize(token, "tenant", "other-workspace", "workspace:read").allowed
  ).toBe(false);
});
it("artifact history remains immutable across SQLite reopen and scope is required", () => {
  const dir = mkdtempSync(join(tmpdir(), "kosmora-apex-history-")),
    file = join(dir, "test.db");
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error("UNSAFE_TEST_CLEANUP");
  let store = new KosmoraRuntimeStore(file);
  const record = {
    revision_id: "r1",
    artifact_id: "a1",
    project_id: "p1",
    tenant_id: "t1",
    version: 1,
    title: "Original",
    kind: "code",
    content_json: '"original"',
    content_sha256: "test",
    author_id: "owner",
    created_at: new Date().toISOString()
  };
  try {
    store.saveArtifactRevision(record);
    store.saveArtifactRevision(record);
    expect(() => store.saveArtifactRevision({ ...record, content_json: '"changed"' })).toThrow(
      "ARTIFACT_REVISION_IMMUTABLE"
    );
    expect(() =>
      store.saveArtifactRevision({ ...record, revision_id: "r2", content_json: '"changed"' })
    ).toThrow("ARTIFACT_REVISION_IMMUTABLE");
    const { tenant_id: tenant, ...unscoped } = record;
    void tenant;
    expect(() => store.saveArtifactRevision(unscoped)).toThrow("ARTIFACT_SCOPE_REQUIRED");
    store.close();
    store = new KosmoraRuntimeStore(file);
    expect(store.listArtifactRevisions("a1", "p1", "t1")).toMatchObject([
      { content_json: '"original"', version: 1 }
    ]);
    expect(store.listArtifactRevisions("a1", "p1", "t2")).toHaveLength(0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("privacy requires a trusted accountant, rejects seeded noise and never returns the raw value", () => {
  const input = { tenant_id: "tenant", true_value: 12345, query_sensitivity: 1, epsilon_cost: 0.1 };
  expect(() =>
    new KosmoraFinOpsComplianceEngine().applyDifferentialPrivacyMechanism(input)
  ).toThrow("PRIVACY_ACCOUNTANT_UNAVAILABLE");
  let remaining = 1;
  const accountant: PrivacyAccountant = {
    configure: () => {
      throw Error("not in this test");
    },
    consume: (_tenant, cost) => {
      if (remaining < cost) throw Error("PRIVACY_BUDGET_EXHAUSTED");
      remaining -= cost;
      return remaining;
    }
  };
  const engine = new KosmoraFinOpsComplianceEngine(accountant);
  expect(() =>
    engine.applyDifferentialPrivacyMechanism({ ...input, deterministic_seed: "attacker" })
  ).toThrow("CALLER_CONTROLLED_PRIVACY_RANDOMNESS_FORBIDDEN");
  expect(remaining).toBe(1);
  const first = engine.applyDifferentialPrivacyMechanism(input),
    second = engine.applyDifferentialPrivacyMechanism(input);
  expect(first).not.toHaveProperty("true_value");
  expect(first.noised_value).not.toBe(second.noised_value);
  expect(first.remaining_epsilon_budget).toBeCloseTo(0.9);
  expect(remaining).toBeCloseTo(0.8);
  expect(() => engine.applyDifferentialPrivacyMechanism({ ...input, epsilon_cost: 1 })).toThrow(
    "PRIVACY_BUDGET_EXHAUSTED"
  );
  expect(() =>
    engine.executeRightToBeForgottenCascade({ tenant_id: "tenant", subject_id: "subject" })
  ).toThrow("SUBJECT_ERASURE_ADAPTER_UNAVAILABLE");
});
it("SQL analytics reads only an explicit in-memory dataset and cannot read host files", () => {
  expect(
    queryReadOnlyDataset({
      connection_id: "explicit-test-dataset",
      read_only_enforced: true,
      dialect: "sqlite",
      rows_dataset: [{ value: 2 }, { value: 3 }],
      sql: "SELECT sum(value) AS total FROM items",
      max_rows: 5
    })
  ).toMatchObject({ rows: [{ total: 5 }] });
  expect(() =>
    queryReadOnlyDataset({
      connection_id: "explicit-test-dataset",
      read_only_enforced: true,
      dialect: "sqlite",
      rows_dataset: [],
      sql: "SELECT readfile('/outside-marker')",
      max_rows: 5
    })
  ).toThrow("SQL_FUNCTION_NOT_ALLOWED");
});
