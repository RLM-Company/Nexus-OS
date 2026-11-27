import { describe, expect, it } from "vitest";
import { codeAgentViewState } from "../src/code-agent/service.js";
import type { CodeAgentRun } from "../src/code-agent/store.js";

const run: CodeAgentRun = {
  id: "11111111-1111-4111-8111-111111111111",
  client_request_id: "22222222-2222-4222-8222-222222222222",
  request_digest: "0".repeat(64),
  project_id: "project",
  owner_id: "owner",
  actor_id: "actor",
  version: 7,
  status: "checked",
  task: "Fix a bug",
  base_branch: "main",
  base_sha: "a".repeat(40),
  workspace_scope: "private-scope",
  repository: "RLM-Company/Nexus-OS",
  requested_files: ["src/add.js"],
  snapshot: [{ path: "src/add.js", content: "export const add = (a,b) => a-b;\n" }],
  repository_paths: ["src/add.js", "README.md"],
  proposal: [
    {
      path: "src/add.js",
      before: "export const add = (a,b) => a-b;\n",
      content: "export const add = (a,b) => a+b;\n"
    }
  ],
  proposal_hash: "1".repeat(64),
  proposal_diff: "--- a/src/add.js\n+++ b/src/add.js\n",
  publication_token: "33333333-3333-4333-8333-333333333333",
  output_checkpoint: {
    kind: "unvalidated_model_output",
    stage: "code",
    text: '{"summary":"sk-proj-SUPERSECRET-123456789"}',
    received_bytes: 44,
    updated_at: "2026-11-27T00:00:00.000Z",
    truncated: false,
    stream_completed: false,
    model_run_id: "44444444-4444-4444-8444-444444444444"
  },
  check: {
    status: "passed",
    exitCode: 0,
    cleanupVerified: true,
    snapshotDigest: "2".repeat(64),
    stdout: "",
    stderr: "",
    truncated: false,
    journal: [],
    review_hash: "3".repeat(64)
  },
  log: [{ at: "2026-11-27T00:00:00.000Z", event: "Проверка завершена успешно" }],
  created_at: "2026-11-27T00:00:00.000Z"
};

describe("owner-facing code agent run projection", () => {
  it("keeps internal source, identity, scope and raw model output server-side", () => {
    const visible = codeAgentViewState(run);
    for (const field of [
      "snapshot",
      "owner_id",
      "actor_id",
      "workspace_scope",
      "repository_paths",
      "output_checkpoint"
    ])
      expect(Object.hasOwn(visible, field)).toBe(false);
    expect(JSON.stringify(visible)).not.toContain("sk-proj-SUPERSECRET");
    expect(JSON.stringify(visible)).not.toContain("unvalidated_model_output");
  });

  it("preserves the exact diff, check evidence and one-time publication proof", () => {
    const visible = codeAgentViewState(run);
    expect(visible.id).toBe(run.id);
    expect(visible.version).toBe(7);
    expect(visible.status).toBe("checked");
    expect(visible.proposal).toEqual(run.proposal);
    expect(visible.proposal_hash).toBe(run.proposal_hash);
    expect(visible.proposal_diff).toBe(run.proposal_diff);
    expect(visible.publication_token).toBe(run.publication_token);
    expect(visible.check).toEqual(run.check);
    expect(visible.log).toEqual(run.log);
    // Never mutate the durable run while projecting it.
    expect(run.output_checkpoint?.text).toContain("sk-proj-SUPERSECRET");
  });
});
