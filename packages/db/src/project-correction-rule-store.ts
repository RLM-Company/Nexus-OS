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
  constructor(
    readonly code:
      "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND" | "NO_PREVIOUS_VERSION" | "OWNER_DATA_FENCED"
  ) {
    super(code);
  }
}
type Row = Omit<ProjectCorrectionRule, "enabled"> & { enabled: number };
type RuleText = Pick<ProjectCorrectionRule, "name" | "summary" | "instructions">;
const decode = (row: Row): ProjectCorrectionRule => ({ ...row, enabled: row.enabled === 1 });

export class ProjectCorrectionRuleStore {
  constructor(private readonly sqlite: DatabaseSync) {}

  assertProject(projectId: string, ownerId: string): void {
    if (
      !this.sqlite
        .prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?")
        .get(projectId, ownerId)
    )
      throw new ProjectCorrectionRuleError("NOT_FOUND");
    if (
      this.sqlite
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(ownerId)
    )
      throw new ProjectCorrectionRuleError("OWNER_DATA_FENCED");
  }

  private current(projectId: string, ownerId: string, name: string): ProjectCorrectionRule | null {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM project_correction_rules WHERE project_id=? AND owner_id=? AND name=? ORDER BY version DESC LIMIT 1"
      )
      .get(projectId, ownerId, name) as Row | undefined;
    return row ? decode(row) : null;
  }

  private insert(
    projectId: string,
    ownerId: string,
    requestId: string,
    text: RuleText,
    version: number,
    enabled: boolean
  ) {
    const at = new Date().toISOString();
    const id = randomUUID();
    const row = this.sqlite
      .prepare(
        `INSERT INTO project_correction_rules
       (id,project_id,owner_id,client_request_id,name,summary,instructions,version,enabled,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING *`
      )
      .get(
        id,
        projectId,
        ownerId,
        requestId,
        text.name,
        text.summary,
        text.instructions,
        version,
        Number(enabled),
        at,
        at
      ) as Row;
    return decode(row);
  }

  private change<T>(run: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (cause) {
      this.sqlite.exec("ROLLBACK");
      throw cause;
    }
  }

  create(
    input: RuleText & { projectId: string; ownerId: string; clientRequestId: string }
  ): ProjectCorrectionRule {
    const { projectId, ownerId, clientRequestId } = input;
    const text = {
      name: input.name?.trim(),
      summary: input.summary?.trim(),
      instructions: input.instructions?.trim()
    };
    if (!clientRequestId || !text.name || !text.summary || !text.instructions)
      throw new ProjectCorrectionRuleError("INVALID_INPUT");
    return this.change(() => {
      this.assertProject(projectId, ownerId);
      const existing = this.sqlite
        .prepare(
          "SELECT * FROM project_correction_rules WHERE project_id=? AND owner_id=? AND client_request_id=?"
        )
        .get(projectId, ownerId, clientRequestId) as Row | undefined;
      if (existing) {
        if (
          existing.name !== text.name ||
          existing.summary !== text.summary ||
          existing.instructions !== text.instructions
        )
          throw new ProjectCorrectionRuleError("CONFLICT");
        return decode(existing);
      }
      const latest = this.current(projectId, ownerId, text.name);
      return this.insert(
        projectId,
        ownerId,
        clientRequestId,
        text,
        (latest?.version ?? 0) + 1,
        true
      );
    });
  }

  get(projectId: string, ownerId: string, id: string): ProjectCorrectionRule | null {
    this.assertProject(projectId, ownerId);
    const row = this.sqlite
      .prepare("SELECT * FROM project_correction_rules WHERE id=? AND project_id=? AND owner_id=?")
      .get(id, projectId, ownerId) as Row | undefined;
    return row ? decode(row) : null;
  }

  list(projectId: string, ownerId: string): ProjectCorrectionRule[] {
    this.assertProject(projectId, ownerId);
    return (
      this.sqlite
        .prepare(
          "SELECT * FROM project_correction_rules WHERE project_id=? AND owner_id=? ORDER BY name,version"
        )
        .all(projectId, ownerId) as Row[]
    ).map(decode);
  }

  active(projectId: string, ownerId: string): ProjectCorrectionRule[] {
    const latest = new Map(this.list(projectId, ownerId).map((rule) => [rule.name, rule]));
    return [...latest.values()].filter((rule) => rule.enabled);
  }

  private requireCurrent(projectId: string, ownerId: string, id: string, expectedVersion: number) {
    const rule = this.get(projectId, ownerId, id);
    if (!rule) throw new ProjectCorrectionRuleError("NOT_FOUND");
    if (rule.version !== expectedVersion || this.current(projectId, ownerId, rule.name)?.id !== id)
      throw new ProjectCorrectionRuleError("CONFLICT");
    return rule;
  }

  setEnabled(
    projectId: string,
    ownerId: string,
    id: string,
    enabled: boolean,
    expectedVersion: number
  ): ProjectCorrectionRule {
    return this.change(() => {
      const rule = this.requireCurrent(projectId, ownerId, id, expectedVersion);
      if (rule.enabled === enabled) return rule;
      return this.insert(projectId, ownerId, randomUUID(), rule, rule.version + 1, enabled);
    });
  }

  rollback(
    projectId: string,
    ownerId: string,
    id: string,
    expectedVersion: number
  ): ProjectCorrectionRule {
    return this.change(() => {
      const current = this.requireCurrent(projectId, ownerId, id, expectedVersion);
      const previous = this.sqlite
        .prepare(
          `SELECT * FROM project_correction_rules WHERE project_id=? AND owner_id=? AND name=? AND version<?
         ORDER BY version DESC LIMIT 1`
        )
        .get(projectId, ownerId, current.name, current.version) as Row | undefined;
      if (!previous) throw new ProjectCorrectionRuleError("NO_PREVIOUS_VERSION");
      return this.insert(
        projectId,
        ownerId,
        randomUUID(),
        previous,
        current.version + 1,
        previous.enabled === 1
      );
    });
  }
}
