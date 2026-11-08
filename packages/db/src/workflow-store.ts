import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  validateWorkflowDefinition,
  validateWorkflowInputs,
  type WorkflowDefinitionInput,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRunInput,
  type WorkDag
} from "@cosmora/contracts";
import { automationTransaction } from "./project-automation-store.js";

export class WorkflowStoreConflict extends Error {}
type DefinitionRow = {
  id: string;
  project_id: string;
  version: number;
  state_json: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
type RunRow = {
  id: string;
  workflow_id: string;
  definition_version: number;
  definition_json: string;
  inputs_json: string;
  dag_id: string;
  client_request_id: string;
  request_json: string;
  created_at: string;
};
const definitionView = (row: DefinitionRow): WorkflowDefinition => ({
  ...(JSON.parse(row.state_json) as WorkflowDefinitionInput),
  id: row.id,
  project_id: row.project_id,
  version: row.version,
  archived_at: row.archived_at,
  created_at: row.created_at,
  updated_at: row.updated_at
});
const runView = (row: RunRow): WorkflowRun => ({
  id: row.id,
  workflow_id: row.workflow_id,
  definition_version: row.definition_version,
  definition: JSON.parse(row.definition_json) as WorkflowDefinitionInput,
  inputs: JSON.parse(row.inputs_json) as WorkflowRunInput["inputs"],
  dag_id: row.dag_id,
  client_request_id: row.client_request_id,
  created_at: row.created_at
});

/** Definitions do not execute. Every run binds an immutable definition/input
 * snapshot to the existing policy-checked Work DAG, in one SQLite transaction.
 */
export class WorkflowStore {
  constructor(private readonly sql: DatabaseSync) {}
  private writable(project: string, owner: string): void {
    if (
      !this.sql
        .prepare(
          "SELECT 1 FROM projects WHERE id=? AND owner_id=? AND status IN ('DRAFT','ACTIVE')"
        )
        .get(project, owner)
    )
      throw new WorkflowStoreConflict("PROJECT_NOT_FOUND");
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner) ||
      this.sql.prepare("SELECT 1 FROM work_owner_fences WHERE owner_id=? AND fenced=1").get(owner)
    )
      throw new WorkflowStoreConflict("OWNER_DATA_FENCED");
  }
  get(project: string, owner: string, id: string): WorkflowDefinition | null {
    const row = this.sql
      .prepare(
        "SELECT d.* FROM kosmora_workflow_definitions d JOIN projects p ON p.id=d.project_id AND p.owner_id=d.owner_id WHERE d.id=? AND d.project_id=? AND d.owner_id=?"
      )
      .get(id, project, owner) as DefinitionRow | undefined;
    return row ? definitionView(row) : null;
  }
  list(project: string, owner: string): WorkflowDefinition[] {
    return (
      this.sql
        .prepare(
          "SELECT d.* FROM kosmora_workflow_definitions d JOIN projects p ON p.id=d.project_id AND p.owner_id=d.owner_id WHERE d.project_id=? AND d.owner_id=? ORDER BY d.updated_at DESC,d.id LIMIT 100"
        )
        .all(project, owner) as DefinitionRow[]
    ).map(definitionView);
  }
  create(
    project: string,
    owner: string,
    definition: WorkflowDefinitionInput,
    clientCreationId: string = randomUUID()
  ): WorkflowDefinition {
    validateWorkflowDefinition(definition);
    return automationTransaction(this.sql, () => {
      this.writable(project, owner);
      const previous = this.sql
        .prepare(
          "SELECT * FROM kosmora_workflow_definitions WHERE project_id=? AND owner_id=? AND client_creation_id=?"
        )
        .get(project, owner, clientCreationId) as
        (DefinitionRow & { creation_json: string }) | undefined;
      if (previous) {
        if (previous.creation_json !== JSON.stringify(definition))
          throw new WorkflowStoreConflict("IDEMPOTENCY_CONFLICT");
        return definitionView(previous);
      }
      const count = this.sql
        .prepare(
          "SELECT COUNT(*) n FROM kosmora_workflow_definitions WHERE project_id=? AND owner_id=?"
        )
        .get(project, owner) as { n: number };
      if (count.n >= 100) throw new WorkflowStoreConflict("WORKFLOW_LIMIT");
      const id = randomUUID(),
        at = new Date().toISOString(),
        json = JSON.stringify(definition);
      this.sql
        .prepare("INSERT INTO kosmora_workflow_definitions VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, project, owner, 1, json, null, at, at, clientCreationId, json);
      this.sql
        .prepare("INSERT INTO kosmora_workflow_versions VALUES (?,?,?,?)")
        .run(id, 1, json, at);
      return this.get(project, owner, id)!;
    });
  }
  edit(
    project: string,
    owner: string,
    id: string,
    expected: number,
    definition: WorkflowDefinitionInput
  ): WorkflowDefinition {
    validateWorkflowDefinition(definition);
    return automationTransaction(this.sql, () => {
      this.writable(project, owner);
      const current = this.get(project, owner, id);
      if (!current) throw new WorkflowStoreConflict("WORKFLOW_NOT_FOUND");
      if (current.archived_at) throw new WorkflowStoreConflict("WORKFLOW_ARCHIVED");
      if (current.version !== expected) {
        const saved = this.sql
          .prepare(
            "SELECT state_json FROM kosmora_workflow_definitions WHERE id=? AND project_id=? AND owner_id=?"
          )
          .get(id, project, owner) as { state_json: string };
        if (current.version === expected + 1 && saved.state_json === JSON.stringify(definition))
          return current;
        throw new WorkflowStoreConflict("STALE_WORKFLOW");
      }
      if (current.version >= 200) throw new WorkflowStoreConflict("WORKFLOW_VERSION_LIMIT");
      const json = JSON.stringify(definition),
        at = new Date().toISOString();
      this.sql
        .prepare("INSERT INTO kosmora_workflow_versions VALUES (?,?,?,?)")
        .run(id, expected + 1, json, at);
      const result = this.sql
        .prepare(
          "UPDATE kosmora_workflow_definitions SET version=?,state_json=?,updated_at=? WHERE id=? AND project_id=? AND owner_id=? AND version=?"
        )
        .run(expected + 1, json, at, id, project, owner, expected);
      if (!result.changes) throw new WorkflowStoreConflict("STALE_WORKFLOW");
      return this.get(project, owner, id)!;
    });
  }
  archive(
    project: string,
    owner: string,
    id: string,
    expected: number,
    archived: boolean
  ): WorkflowDefinition {
    return automationTransaction(this.sql, () => {
      this.writable(project, owner);
      const current = this.get(project, owner, id);
      if (!current) throw new WorkflowStoreConflict("WORKFLOW_NOT_FOUND");
      if (current.version !== expected) throw new WorkflowStoreConflict("STALE_WORKFLOW");
      this.sql
        .prepare(
          "UPDATE kosmora_workflow_definitions SET archived_at=?,updated_at=? WHERE id=? AND project_id=? AND owner_id=? AND version=?"
        )
        .run(
          archived ? new Date().toISOString() : null,
          new Date().toISOString(),
          id,
          project,
          owner,
          expected
        );
      return this.get(project, owner, id)!;
    });
  }
  versions(
    project: string,
    owner: string,
    id: string
  ): { version: number; definition: WorkflowDefinitionInput; created_at: string }[] {
    if (!this.get(project, owner, id)) throw new WorkflowStoreConflict("WORKFLOW_NOT_FOUND");
    return (
      this.sql
        .prepare(
          "SELECT version,definition_json,created_at FROM kosmora_workflow_versions WHERE workflow_id=? ORDER BY version DESC LIMIT 200"
        )
        .all(id) as { version: number; definition_json: string; created_at: string }[]
    ).map((row) => ({
      version: row.version,
      definition: JSON.parse(row.definition_json) as WorkflowDefinitionInput,
      created_at: row.created_at
    }));
  }
  runs(project: string, owner: string, id: string): WorkflowRun[] {
    if (!this.get(project, owner, id)) throw new WorkflowStoreConflict("WORKFLOW_NOT_FOUND");
    return (
      this.sql
        .prepare(
          "SELECT * FROM kosmora_workflow_runs WHERE workflow_id=? AND project_id=? AND owner_id=? ORDER BY created_at DESC,id LIMIT 100"
        )
        .all(id, project, owner) as RunRow[]
    ).map(runView);
  }
  /** Exact lookup for an explicitly selected run. Unrelated or very old runs
   * return null through the same owner/project/workflow predicate, with no leak.
   */
  run(project: string, owner: string, workflowId: string, runId: string): WorkflowRun | null {
    const row = this.sql
      .prepare(
        `SELECT r.* FROM kosmora_workflow_runs r
         JOIN projects p ON p.id=r.project_id AND p.owner_id=r.owner_id
         WHERE r.id=? AND r.workflow_id=? AND r.project_id=? AND r.owner_id=?`
      )
      .get(runId, workflowId, project, owner) as RunRow | undefined;
    return row ? runView(row) : null;
  }
  start(
    project: string,
    owner: string,
    id: string,
    input: WorkflowRunInput,
    create: (definition: WorkflowDefinitionInput, inputs: WorkflowRunInput["inputs"]) => WorkDag
  ): WorkflowRun {
    const fingerprint = JSON.stringify({
      workflow_id: id,
      ...input,
      inputs: Object.fromEntries(
        Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      )
    });
    return automationTransaction(this.sql, () => {
      this.writable(project, owner);
      const previous = this.sql
        .prepare(
          "SELECT * FROM kosmora_workflow_runs WHERE owner_id=? AND project_id=? AND client_request_id=?"
        )
        .get(owner, project, input.client_request_id) as RunRow | undefined;
      if (previous) {
        if (previous.request_json !== fingerprint)
          throw new WorkflowStoreConflict("IDEMPOTENCY_CONFLICT");
        return runView(previous);
      }
      const definition = this.get(project, owner, id);
      if (!definition) throw new WorkflowStoreConflict("WORKFLOW_NOT_FOUND");
      if (definition.archived_at) throw new WorkflowStoreConflict("WORKFLOW_ARCHIVED");
      if (definition.version !== input.expected_version)
        throw new WorkflowStoreConflict("STALE_WORKFLOW");
      validateWorkflowInputs(definition, input.inputs);
      const snapshot: WorkflowDefinitionInput = {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        nodes: definition.nodes,
        requirements: definition.requirements,
        expected_results: definition.expected_results
      };
      this.sql
        .prepare("UPDATE projects SET status='ACTIVE' WHERE id=? AND owner_id=? AND status='DRAFT'")
        .run(project, owner);
      const graph = create(structuredClone(snapshot), structuredClone(input.inputs));
      const runId = randomUUID(),
        at = new Date().toISOString();
      this.sql
        .prepare("INSERT INTO kosmora_workflow_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          runId,
          id,
          project,
          owner,
          input.client_request_id,
          fingerprint,
          definition.version,
          JSON.stringify(snapshot),
          JSON.stringify(input.inputs),
          graph.id,
          at
        );
      return {
        id: runId,
        workflow_id: id,
        definition_version: definition.version,
        definition: snapshot,
        inputs: structuredClone(input.inputs),
        dag_id: graph.id,
        client_request_id: input.client_request_id,
        created_at: at
      };
    });
  }
  fileMaterial(project: string, owner: string, id: string): { name: string; content: string } {
    const file = this.sql
      .prepare(
        "SELECT f.name,f.status,f.format,f.original FROM document_library_files f JOIN projects p ON p.id=f.project_id AND p.owner_id=f.owner_id WHERE f.id=? AND f.project_id=? AND f.owner_id=?"
      )
      .get(id, project, owner) as
      { name: string; status: string; format: string; original: Uint8Array } | undefined;
    if (!file) throw new WorkflowStoreConflict("WORKFLOW_FILE_NOT_FOUND");
    if (file.status !== "ready") throw new WorkflowStoreConflict("WORKFLOW_FILE_NOT_READY");
    let text: string | undefined;
    if (["txt", "csv"].includes(file.format)) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(file.original);
      } catch {
        /* Indexed text remains available for other encodings. */
      }
    }
    const excerpts =
      text === undefined
        ? this.sql
            .prepare(
              "SELECT ordinal,page,line_start,line_end,content FROM document_library_chunks WHERE file_id=? ORDER BY ordinal"
            )
            .all(id)
        : [];
    if (text === undefined ? excerpts.length === 0 : !text.trim())
      throw new WorkflowStoreConflict("WORKFLOW_FILE_EMPTY");
    const content =
      text === undefined
        ? JSON.stringify({
            file_id: id,
            original_name: file.name,
            representation: "indexed_excerpts_may_overlap",
            excerpts
          })
        : JSON.stringify({
            file_id: id,
            original_name: file.name,
            representation: "original_utf8_text",
            text
          });
    return { name: `workflow-${id}.txt`, content };
  }
}
