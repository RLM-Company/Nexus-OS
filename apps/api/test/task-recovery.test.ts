import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CreateManagerWork } from "@cosmora/contracts";
import { ModelOutputCheckpointWriter } from "@cosmora/core";
import { ManagerWorkStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { CodeAgentStore } from "../src/code-agent/store.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
const owner = "local-owner";
const request: CreateManagerWork = {
  client_request_id: "durable-recovery",
  goal: "Prepare a useful document",
  worker_role: "analyst",
  max_model_requests: 3,
  max_input_tokens: 32000,
  max_output_tokens: 6000
};

async function fixture(path = ":memory:") {
  const database = openDatabase(path);
  let closed = false;
  const close = () => {
    if (!closed) database.close();
    closed = true;
  };
  cleanup.push(close);
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite);
  const project = projects.createProject("Durable task", "task-recovery").project.id;
  const workStore = new ManagerWorkStore(database.sqlite);
  const codeStore = new CodeAgentStore(database.sqlite);
  const work = workStore.claim(workStore.create(project, owner, owner, request)!)!;
  const code = codeStore.create({
    client_request_id: randomUUID(),
    project_id: project,
    owner_id: owner,
    actor_id: owner,
    status: "running",
    task: "Prepare a proposed code change",
    base_branch: "main",
    base_sha: "a".repeat(40),
    workspace_scope: "fixture",
    repository: "RLM-Company/Nexus-OS",
    requested_files: ["src/example.ts"],
    snapshot: []
  });
  return { database, close, projects, project, workStore, codeStore, work, code };
}

describe("durable task child bindings and restart recovery", () => {
  it("rolls back a Code child run if linking its parent fails", async () => {
    const f = await fixture();
    const before = f.database.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n;
    f.database.sqlite.exec(
      "CREATE TEMP TRIGGER reject_code_link BEFORE UPDATE ON code_agent_runs BEGIN SELECT RAISE(ABORT,'LINK_REJECTED'); END"
    );
    expect(() => f.codeStore.createModelRun(f.code)).toThrow("LINK_REJECTED");
    expect(f.database.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n).toBe(before);
    expect(f.codeStore.get(f.code.id, owner)).toEqual(f.code);
    f.database.sqlite.exec("DROP TRIGGER reject_code_link");
    const id = f.codeStore.createModelRun(f.code);
    expect(f.codeStore.get(f.code.id, owner)?.model_run_ids).toEqual([id]);
    expect(f.projects.getRun(id)?.status).toBe("running");
  });

  it("rolls back a Work child run if linking its parent fails", async () => {
    const f = await fixture();
    const before = f.database.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n;
    f.database.sqlite.exec(
      "CREATE TEMP TRIGGER reject_work_link BEFORE UPDATE ON manager_work BEGIN SELECT RAISE(ABORT,'LINK_REJECTED'); END"
    );
    expect(() => f.workStore.createModelRun(f.work)).toThrow("LINK_REJECTED");
    expect(f.database.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n).toBe(before);
    expect(f.workStore.get(f.work.id, owner)).toEqual(f.work);
    f.database.sqlite.exec("DROP TRIGGER reject_work_link");
    const id = f.workStore.createModelRun(f.work);
    expect(f.workStore.get(f.work.id, owner)?.inflight_run_id).toBe(id);
    expect(f.projects.getRun(id)?.status).toBe("running");
  });

  it("recovers saved prefixes after reopening SQLite without replaying or publishing them", async () => {
    const root = mkdtempSync(join(tmpdir(), "kosmora-task-recovery-"));
    cleanup.push(() => {
      const child = relative(resolve(tmpdir()), resolve(root));
      if (!child || child.startsWith("..") || !child.startsWith("kosmora-task-recovery-"))
        throw new Error("Unexpected task recovery cleanup path");
      rmSync(root, { recursive: true, force: true });
    });
    const path = join(root, "tasks.sqlite");
    const f = await fixture(path);
    const workChild = f.workStore.createModelRun(f.work);
    const codeChild = f.codeStore.createModelRun(f.code);
    const partial = '{"summary":"Незавершённый результат 🚀';
    new ModelOutputCheckpointWriter(workChild, "plan", (checkpoint) => {
      f.workStore.save({ ...f.workStore.get(f.work.id, owner)!, output_checkpoint: checkpoint });
      return true;
    }).update(partial);
    new ModelOutputCheckpointWriter(codeChild, "code", (checkpoint) => {
      f.codeStore.save({ ...f.codeStore.get(f.code.id, owner)!, output_checkpoint: checkpoint });
      return true;
    }).update(partial);
    f.close();

    const reopened = openDatabase(path);
    cleanup.push(() => reopened.close());
    const projects = new ProjectStore(reopened.sqlite);
    const workStore = new ManagerWorkStore(reopened.sqlite);
    const codeStore = new CodeAgentStore(reopened.sqlite);
    // The production startup order closes child ledgers before recovering coordinators.
    expect(projects.recoverInterruptedRuns()).toBe(2);
    codeStore.recover();
    expect(workStore.recover()).toBe(1);
    const work = workStore.get(f.work.id, owner)!;
    const code = codeStore.get(f.code.id, owner)!;
    expect(work).toMatchObject({
      status: "failed",
      error_code: "RECOVERY_REQUIRED",
      plan: null,
      draft: null,
      output_checkpoint: {
        text: partial,
        kind: "unvalidated_model_output",
        stream_completed: false
      }
    });
    expect(code).toMatchObject({
      status: "failed",
      error: "INTERRUPTED",
      output_checkpoint: {
        text: partial,
        kind: "unvalidated_model_output",
        stream_completed: false
      }
    });
    expect(code.proposal).toBeUndefined();
    expect(code.draft).toBeUndefined();
    expect(workStore.file(work.id, owner, "result.md")).toBeNull();
    expect(workStore.get(work.id, "foreign-owner")).toBeNull();
    expect(codeStore.get(code.id, "foreign-owner")).toBeNull();
    expect(projects.getRun(workChild)?.status).toBe("failed");
    expect(projects.getRun(codeChild)?.status).toBe("failed");
    const count = reopened.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n;
    expect(workStore.create(f.project, owner, owner, request)).toEqual(work);
    expect(codeStore.findRequest(owner, code.client_request_id!)).toEqual(code);
    codeStore.recover();
    expect(workStore.recover()).toBe(0);
    expect(projects.recoverInterruptedRuns()).toBe(0);
    expect(workStore.get(work.id, owner)).toEqual(work);
    expect(codeStore.get(code.id, owner)).toEqual(code);
    expect(reopened.sqlite.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n).toBe(count);
    expect(reopened.sqlite.prepare("SELECT COUNT(*) AS n FROM manager_work_files").get()!.n).toBe(
      0
    );
  });
});
