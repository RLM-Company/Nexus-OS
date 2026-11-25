import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ProjectCorrectionRule = {
  id: string;
  project_id: string;
  owner_id: string;
  client_request_id: string;
  name: string;
  summary: string;
  instructions: string;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
export class ProjectCorrectionRuleError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND" | "NO_PREVIOUS_VERSION") {
    super(code);
  }
}
type Row = Omit<ProjectCorrectionRule, "enabled"> & { enabled: number };
const decode = (row: Row): ProjectCorrectionRule => ({
  ...row,
  enabled: row.enabled === 1
});

/** Explicit project-level rules derived from owner corrections. Every state
 * change is a new immutable version; disabling or rolling back never rewrites
 * older history. */
export class ProjectCorrectionRuleStore {
  constructor(private readonly sqlite: DatabaseSync) {}

  create(input: {
    projectId: string;
    ownerId: string;
    clientRequestId: string;
    name: string;
    summary: string;
    instructions: string;
  }): ProjectCorrectionRule {
    if (
      !input.projectId ||
      !input.ownerId ||
      !input.clientRequestId ||
      !input.name?.trim() ||
      !input.summary?.trim() ||
      !input.instructions?.trim()
    )
      throw new ProjectCorrectionRuleError("INVALID_INPUT");
    const existing = this.sqlite
      .prepare("SELECT * FROM project_correction_rules WHERE project_id=? AND client_request_id=?")
      .get(input.projectId, input.clientRequestId) as Row | undefined;
    if (existing) return decode(existing);
    const latest = this.sqlite
      .prepare(
        "SELECT MAX(version) AS version FROM project_correction_rules WHERE project_id=? AND name=?"
      )
      .get(input.projectId, input.name.trim()) as { version: number | null };
    const version = (latest.version ?? 0) + 1;
    const at = new Date().toISOString();
    const id = randomUUID();
    try {
      this.sqlite
        .prepare(
          `INSERT INTO project_correction_rules
           (id,project_id,owner_id,client_request_id,name,summary,instructions,version,enabled,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,1,?,?)`
        )
        .run(
          id,
          input.projectId,
          input.ownerId,
          input.clientRequestId,
          input.name.trim(),
          input.summary.trim(),
          input.instructions.trim(),
          version,
          at,
          at
        );
    } catch {
      throw new ProjectCorrectionRuleError("CONFLICT");
    }
    return this.get(input.projectId, input.ownerId, id)!;
  }

  get(projectId: string, ownerId: string, id: string): ProjectCorrectionRule | null {
    const row = this.sqlite
      .prepare("SELECT * FROM project_correction_rules WHERE id=? AND project_id=? AND owner_id=?")
      .get(id, projectId, ownerId) as Row | undefined;
    return row ? decode(row) : null;
  }

  list(projectId: string, ownerId: string): ProjectCorrectionRule[] {
    return (
      this.sqlite
        .prepare(
          "SELECT * FROM project_correction_rules WHERE project_id=? AND owner_id=? ORDER BY created_at ASC, version ASC"
        )
        .all(projectId, ownerId) as Row[]
    ).map(decode);
  }

  active(projectId: string, ownerId: string): ProjectCorrectionRule[] {
    return this.list(projectId, ownerId).filter((rule) => rule.enabled);
  }

  setEnabled(
    projectId: string,
    ownerId: string,
    id: string,
    enabled: boolean,
    expectedVersion: number
  ): ProjectCorrectionRule {
    const result = this.sqlite
      .prepare(
        "UPDATE project_correction_rules SET enabled=?, updated_at=? WHERE id=? AND project_id=? AND owner_id=? AND version=? AND enabled=?"
      )
      .run(
        enabled ? 1 : 0,
        new Date().toISOString(),
        id,
        projectId,
        ownerId,
        expectedVersion,
        enabled ? 0 : 1
      );
    if (result.changes !== 1)
      throw new ProjectCorrectionRuleError(
        this.get(projectId, ownerId, id) ? "CONFLICT" : "NOT_FOUND"
      );
    return this.get(projectId, ownerId, id)!;
  }

  /** Roll back by restoring the previous immutable version as active. */
  rollback(projectId: string, ownerId: string, id: string): ProjectCorrectionRule {
    const current = this.get(projectId, ownerId, id);
    if (!current) throw new ProjectCorrectionRuleError("NOT_FOUND");
    const previous = this.sqlite
      .prepare(
        `SELECT * FROM project_correction_rules
         WHERE project_id=? AND owner_id=? AND name=? AND version<?
         ORDER BY version DESC LIMIT 1`
      )
      .get(projectId, ownerId, current.name, current.version) as Row | undefined;
    if (!previous) throw new ProjectCorrectionRuleError("NO_PREVIOUS_VERSION");
    const at = new Date().toISOString();
    this.sqlite
      .prepare("UPDATE project_correction_rules SET enabled=0, updated_at=? WHERE id=?")
      .run(at, current.id);
    this.sqlite
      .prepare("UPDATE project_correction_rules SET enabled=1, updated_at=? WHERE id=?")
      .run(at, previous.id);
    return decode(previous);
  }
}
