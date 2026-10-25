import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import { KosmoraEnterpriseSecurityEngine } from "../../core/src/kosmora-enterprise-security.js";
import { KosmoraRuntimeStore } from "../../core/src/kosmora-runtime-store.js";
import { queryReadOnlyDataset } from "../../core/src/read-only-dataset.js";
import { Stage5EnterpriseKernel } from "../../policy-engine/src/stage5-enterprise/stage-kernel.js";
import { F130RowLevelSecurityIsolationEngine } from "../../policy-engine/src/stage5-enterprise/f130-row-level-security-isolation.js";
import { F070AgenticGithubPrCreatorEngine } from "../../tool-runtime/src/stage3-skills-bus/f070-agentic-github-pr-creator.js";
import {
  KosmoraDagWorker,
  SandboxIsolationUnavailableError
} from "../../../apps/worker/src/kosmora-dag-worker.js";
import { KosmoraAutonomyEngine } from "../../core/src/kosmora-autonomy-engine.js";

const key = "ab".repeat(32);
const context = {
  requestId: "request",
  projectId: "project",
  workspaceId: "workspace",
  tenantId: "tenant",
  actorId: "actor",
  autonomyLevel: "A1" as const
};
test("enterprise key must be exactly configured; public default and truncated keys are rejected", () => {
  assert.throws(() => new KosmoraEnterpriseSecurityEngine(""), /MASTER_KEY_REQUIRED/);
  assert.throws(() => new KosmoraEnterpriseSecurityEngine("abcd"), /MASTER_KEY_REQUIRED/);
  assert.throws(() => new KosmoraEnterpriseSecurityEngine(key + "00"), /MASTER_KEY_REQUIRED/);
  assert.doesNotThrow(() => new KosmoraEnterpriseSecurityEngine(key));
});
test("even correctly signed tokens reject invalid expiry and role claims", () => {
  const engine = new KosmoraEnterpriseSecurityEngine(key);
  const signing = createHash("sha256")
    .update(Buffer.concat([Buffer.from(key, "hex"), Buffer.from(":session-hmac-v1")]))
    .digest();
  for (const invalid of [{ exp: "invalid" }, { role: "root" }, { workspace_ids: [3] }]) {
    const payload = Buffer.from(
      JSON.stringify({
        user_id: "actor",
        tenant_id: "tenant",
        workspace_ids: ["workspace"],
        role: "viewer",
        mfa_verified: false,
        exp: "2030-01-01T00:00:00Z",
        ...invalid
      })
    ).toString("base64url");
    const signature = createHmac("sha256", signing).update(payload).digest("base64url");
    assert.throws(
      () => engine.verifySignedSessionToken(`ksm_sess.${payload}.${signature}`),
      /Invalid session token claims/
    );
  }
});
test("enterprise kernel never self-authorizes an input actor", () => {
  assert.throws(
    () =>
      new Stage5EnterpriseKernel().executeDomainOperation({
        ...context,
        featureId: "F129",
        operationCode: "test",
        domainFields: { a: "x", b: "y", c: false, d: 0 }
      }),
    /IDENTITY_ADAPTER_REQUIRED/
  );
});
test("unwired row guard never grants a cross-tenant row", () => {
  assert.throws(
    () =>
      new F130RowLevelSecurityIsolationEngine().execute({
        ...context,
        requesting_tenant_id: "tenant",
        row_tenant_id: "foreign",
        access_granted: true,
        policy_enforcement: "strict"
      }),
    /ROW_ISOLATION_ADAPTER_REQUIRED/
  );
});
test("unwired GitHub module never returns a fabricated completed PR", () => {
  assert.throws(
    () =>
      new F070AgenticGithubPrCreatorEngine().execute({
        ...context,
        repo_name: "owner/repo",
        head_branch: "feature",
        base_branch: "main",
        pr_body_markdown: "test"
      }),
    /GITHUB_FEATURE_NOT_CONNECTED/
  );
});
test("sandbox refuses both host and OCI requests without a real isolated executor", () => {
  const store = new KosmoraRuntimeStore(":memory:");
  try {
    const worker = new KosmoraDagWorker(new KosmoraAutonomyEngine(), store);
    for (const isolation_mode of ["subprocess_restricted", "oci_container_required"] as const)
      assert.throws(
        () =>
          worker.executeInSandbox({
            language: "node",
            code: "throw new Error('must never execute')",
            isolation_mode
          }),
        SandboxIsolationUnavailableError
      );
  } finally {
    store.close();
  }
});
test("SQLite actually evaluates WHERE, projection, aggregation and row bounds", () => {
  const base = {
    connection_id: "local",
    dialect: "sqlite" as const,
    read_only_enforced: true,
    max_rows: 10,
    rows_dataset: [
      { kind: "a", price: 10 },
      { kind: "b", price: 20 },
      { kind: "c", price: 5 }
    ]
  };
  const filtered = queryReadOnlyDataset({
    ...base,
    sql: "SELECT kind, price * 2 AS doubled FROM items WHERE price >= 10 ORDER BY price DESC"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(filtered.rows)), [
    { kind: "b", doubled: 40 },
    { kind: "a", doubled: 20 }
  ]);
  assert.equal(
    queryReadOnlyDataset({ ...base, sql: "SELECT SUM(price) AS total FROM items" }).rows[0]!.total,
    35
  );
  assert.equal(
    queryReadOnlyDataset({ ...base, sql: "SELECT * FROM items", max_rows: 1 }).truncated,
    true
  );
  assert.throws(
    () => queryReadOnlyDataset({ ...base, sql: "SELECT randomblob(1000000000)" }),
    /FUNCTION_NOT_ALLOWED/
  );
  assert.throws(
    () => queryReadOnlyDataset({ ...base, sql: "DELETE FROM items", read_only_enforced: false }),
    /READ_ONLY/
  );
  assert.throws(
    () =>
      queryReadOnlyDataset({ ...base, rows_dataset: undefined } as unknown as Parameters<
        typeof queryReadOnlyDataset
      >[0]),
    /ADAPTER_REQUIRED/
  );
});
test("revision ids and version slots are immutable and snapshot restore preserves later history", () => {
  const store = new KosmoraRuntimeStore(":memory:");
  const revision = {
    revision_id: "r1",
    artifact_id: "a",
    project_id: "p",
    tenant_id: "t",
    version: 1,
    title: "One",
    kind: "text",
    content_json: "{}",
    content_sha256: createHash("sha256").update("{}").digest("hex"),
    author_id: "owner",
    created_at: "2026-10-25T00:00:00Z"
  };
  try {
    store.saveArtifactRevision(revision);
    store.saveArtifactRevision(revision);
    assert.throws(
      () => store.saveArtifactRevision({ ...revision, title: "Tampered" }),
      /IMMUTABLE/
    );
    assert.throws(
      () => store.saveArtifactRevision({ ...revision, revision_id: "different" }),
      /IMMUTABLE/
    );
    const snapshot = store.createProjectSnapshot("p", "t");
    store.saveArtifactRevision({ ...revision, revision_id: "r2", version: 2, title: "Two" });
    store.restoreProjectSnapshot(snapshot.snapshot_id, "p");
    assert.deepEqual(
      store.listArtifactRevisions("a", "p").map((row) => row.version),
      [1, 2]
    );
  } finally {
    store.close();
  }
});
