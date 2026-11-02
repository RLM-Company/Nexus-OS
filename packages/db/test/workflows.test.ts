import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  WorkflowStore,
  WorkDagStore,
  DocumentLibraryStore
} from "../src/index.js";
import { renderWorkflowNodes, type WorkflowDefinitionInput } from "@cosmora/contracts";
const resources: (() => void)[] = [];
afterEach(() => {
  for (const close of resources.splice(0)) close();
});
const definition = (): WorkflowDefinitionInput => ({
  name: "Report",
  description: "Reusable",
  parameters: [{ id: "topic", label: "Topic", type: "text", required: true }],
  nodes: [{ id: "report", title: "Report", goal: "Write {{topic}}", depends_on: [] }],
  requirements: ["work.files.create"],
  expected_results: ["report.md"]
});
async function fixture() {
  const db = openDatabase(":memory:");
  resources.push(() => db.close());
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite),
    workflows = new WorkflowStore(db.sqlite),
    dags = new WorkDagStore(db.sqlite);
  const project = projects.createProject("A", "client-a", "owner-a").project;
  const other = projects.createProject("B", "client-b", "owner-b").project;
  let serial = 0;
  const create = (d: WorkflowDefinitionInput, inputs: Record<string, string | number | boolean>) =>
    dags.create(project.id, "owner-a", "owner-a", {
      client_request_id: `graph-${++serial}`,
      title: d.name,
      nodes: renderWorkflowNodes(d, inputs)
    });
  return { db, projects, workflows, dags, project, other, create };
}
describe("durable parameterized workflows", () => {
  it("creates editable definitions, immutable versions and archived entries", async () => {
    const f = await fixture(),
      d = f.workflows.create(f.project.id, "owner-a", definition());
    const v2 = f.workflows.edit(f.project.id, "owner-a", d.id, 1, {
      ...definition(),
      name: "Changed"
    });
    expect(v2.version).toBe(2);
    expect(f.workflows.versions(f.project.id, "owner-a", d.id).map((v) => v.version)).toEqual([
      2, 1
    ]);
    expect(() => f.workflows.edit(f.project.id, "owner-a", d.id, 1, definition())).toThrow(
      "STALE_WORKFLOW"
    );
    f.workflows.archive(f.project.id, "owner-a", d.id, 2, true);
    expect(() => f.workflows.edit(f.project.id, "owner-a", d.id, 2, definition())).toThrow(
      "WORKFLOW_ARCHIVED"
    );
    expect(() =>
      f.db.sqlite
        .prepare("UPDATE kosmora_workflow_versions SET definition_json='{}' WHERE workflow_id=?")
        .run(d.id)
    ).toThrow("IMMUTABLE_WORKFLOW_VERSION");
    expect(f.workflows.archive(f.project.id, "owner-a", d.id, 2, false).archived_at).toBeNull();
  });
  it("replays a run exactly without repeating graph creation after a template edit", async () => {
    const f = await fixture(),
      d = f.workflows.create(f.project.id, "owner-a", definition());
    let calls = 0;
    const input = {
      client_request_id: "run-1",
      expected_version: 1,
      inputs: { topic: "original" },
      auto_start: false
    };
    const callback = (...args: Parameters<typeof f.create>) => {
      calls++;
      return f.create(...args);
    };
    const run = f.workflows.start(f.project.id, "owner-a", d.id, input, callback);
    f.workflows.edit(f.project.id, "owner-a", d.id, 1, { ...definition(), name: "New definition" });
    const replay = f.workflows.start(f.project.id, "owner-a", d.id, input, callback);
    expect(replay).toEqual(run);
    expect(calls).toBe(1);
    expect(replay.definition.name).toBe("Report");
    expect(replay.definition_version).toBe(1);
    expect(f.dags.get(run.dag_id, "owner-a")!.nodes[0]!.goal).toBe('Write "original"');
    expect(() =>
      f.workflows.start(
        f.project.id,
        "owner-a",
        d.id,
        { ...input, inputs: { topic: "changed" } },
        callback
      )
    ).toThrow("IDEMPOTENCY_CONFLICT");
    expect(() =>
      f.db.sqlite
        .prepare("UPDATE kosmora_workflow_runs SET inputs_json='{}' WHERE id=?")
        .run(run.id)
    ).toThrow("IMMUTABLE_WORKFLOW_RUN");
  });
  it("rolls back the DAG and draft activation if admission fails", async () => {
    const f = await fixture();
    f.db.sqlite.prepare("UPDATE projects SET status='DRAFT' WHERE id=?").run(f.project.id);
    const d = f.workflows.create(f.project.id, "owner-a", definition());
    expect(() =>
      f.workflows.start(
        f.project.id,
        "owner-a",
        d.id,
        {
          client_request_id: "fail",
          expected_version: 1,
          inputs: { topic: "x" },
          auto_start: false
        },
        (...args) => {
          f.create(...args);
          throw new Error("injected");
        }
      )
    ).toThrow("injected");
    expect(f.dags.list(f.project.id, "owner-a")).toHaveLength(0);
    expect(f.projects.getProject(f.project.id, "owner-a")!.status).toBe("DRAFT");
    expect(f.workflows.runs(f.project.id, "owner-a", d.id)).toHaveLength(0);
  });
  it("isolates owners and projects in reads, writes, histories and SQL foreign bindings", async () => {
    const f = await fixture(),
      d = f.workflows.create(f.project.id, "owner-a", definition());
    expect(f.workflows.get(f.project.id, "owner-b", d.id)).toBeNull();
    expect(f.workflows.list(f.project.id, "owner-b")).toEqual([]);
    expect(() => f.workflows.versions(f.project.id, "owner-b", d.id)).toThrow("WORKFLOW_NOT_FOUND");
    expect(() => f.workflows.create(f.other.id, "owner-a", definition())).toThrow(
      "PROJECT_NOT_FOUND"
    );
    expect(() => f.workflows.edit(f.other.id, "owner-b", d.id, 1, definition())).toThrow(
      "WORKFLOW_NOT_FOUND"
    );
    const wrongGraph = f.dags.create(f.other.id, "owner-b", "owner-b", {
      client_request_id: "other-graph",
      title: "Other",
      nodes: definition().nodes
    });
    expect(() =>
      f.workflows.start(
        f.project.id,
        "owner-a",
        d.id,
        {
          client_request_id: "wrong-binding",
          expected_version: 1,
          inputs: { topic: "x" },
          auto_start: false
        },
        () => wrongGraph
      )
    ).toThrow("WORKFLOW_OWNER_MISMATCH");
  });
  it("blocks writes during owner fencing and deletes dependent snapshots with privacy cleanup", async () => {
    const f = await fixture(),
      d = f.workflows.create(f.project.id, "owner-a", definition());
    f.workflows.start(
      f.project.id,
      "owner-a",
      d.id,
      { client_request_id: "run", expected_version: 1, inputs: { topic: "x" }, auto_start: false },
      f.create
    );
    f.db.sqlite
      .prepare("INSERT INTO work_owner_fences(owner_id,fenced) VALUES (?,1)")
      .run("owner-a");
    expect(() => f.workflows.create(f.project.id, "owner-a", definition())).toThrow(
      "OWNER_DATA_FENCED"
    );
    expect(() => f.workflows.archive(f.project.id, "owner-a", d.id, 1, true)).toThrow(
      "OWNER_DATA_FENCED"
    );
    f.db.sqlite.prepare("DELETE FROM kosmora_workflow_definitions WHERE owner_id=?").run("owner-a");
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM kosmora_workflow_versions").get()!.n).toBe(
      0
    );
    expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM kosmora_workflow_runs").get()!.n).toBe(0);
  });
  it("only reads selected project files after successful extraction", async () => {
    const f = await fixture(),
      library = new DocumentLibraryStore(f.db.sqlite);
    const file = library.stage(
      f.project.id,
      "owner-a",
      "source.txt",
      Buffer.from("Actual source\n")
    );
    expect(() => f.workflows.fileMaterial(f.project.id, "owner-a", file.id)).toThrow(
      "WORKFLOW_FILE_NOT_READY"
    );
    library.complete(
      f.project.id,
      "owner-a",
      file.id,
      [{ page: null, text: "Actual source\n" }],
      [{ ordinal: 0, page: null, line_start: 1, line_end: 1, content: "Actual source" }]
    );
    expect(f.workflows.fileMaterial(f.project.id, "owner-a", file.id).content).toContain(
      "Actual source"
    );
    expect(() => f.workflows.fileMaterial(f.other.id, "owner-b", file.id)).toThrow(
      "WORKFLOW_FILE_NOT_FOUND"
    );
    expect(() => f.workflows.fileMaterial(f.project.id, "owner-b", file.id)).toThrow(
      "WORKFLOW_FILE_NOT_FOUND"
    );
  });
});
