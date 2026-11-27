import type { DatabaseSync } from "node:sqlite";
import { Value } from "typebox/value";
import {
  RunSourcesInputSchema,
  SourceExclusionsInputSchema,
  type RunSourcesInput,
  type RunSourcesView,
  type SourceExclusionsInput,
  type SourceExclusionsView,
  type UsedSource
} from "@cosmora/contracts";

export class ProjectSourceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string
  ) {
    super(code);
  }
}

/** Project-scoped exclusions and immutable per-run used-source receipts. */
export class ProjectSourceStore {
  constructor(private readonly db: DatabaseSync) {}

  private active(owner: string) {
    if (
      this.db
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner)
    )
      throw new ProjectSourceError(409, "OWNER_DATA_FENCED");
  }
  private project(projectId: string, owner: string) {
    if (!this.db.prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?").get(projectId, owner))
      throw new ProjectSourceError(404, "PROJECT_NOT_FOUND");
  }
  private settings(projectId: string, owner: string, initialize = true): number {
    const row = this.db
      .prepare("SELECT version FROM project_source_settings WHERE owner_id=? AND project_id=?")
      .get(owner, projectId) as { version: number } | undefined;
    if (row) return row.version;
    if (!initialize) return 1;
    this.db
      .prepare(
        "INSERT INTO project_source_settings(owner_id,project_id,version,updated_at) VALUES(?,?,1,?)"
      )
      .run(owner, projectId, new Date().toISOString());
    return 1;
  }

  isSharedSource(projectId: string, source: Pick<UsedSource, "source_kind" | "source_id">) {
    return (
      source.source_kind === "research_page" ||
      (source.source_kind === "project_message" &&
        !!this.db
          .prepare("SELECT 1 FROM messages WHERE project_id=? AND id=?")
          .get(projectId, source.source_id))
    );
  }

  exclusions(projectId: string, owner: string): SourceExclusionsView {
    this.active(owner);
    this.project(projectId, owner);
    const version = this.settings(projectId, owner, false);
    const items = this.db
      .prepare(
        "SELECT source_kind,source_id,excluded_at,reason FROM project_source_exclusions WHERE owner_id=? AND project_id=? ORDER BY source_kind,source_id"
      )
      .all(owner, projectId) as SourceExclusionsView["items"];
    return { project_id: projectId, version, items };
  }

  updateExclusions(
    projectId: string,
    owner: string,
    input: SourceExclusionsInput
  ): SourceExclusionsView {
    this.active(owner);
    this.project(projectId, owner);
    if (!Value.Check(SourceExclusionsInputSchema, input))
      throw new ProjectSourceError(400, "INVALID_SOURCE_EXCLUSIONS");
    const ids = new Set(input.exclusions.map((e) => `${e.source_kind}:${e.source_id}`));
    if (ids.size !== input.exclusions.length)
      throw new ProjectSourceError(400, "INVALID_SOURCE_EXCLUSIONS");
    const current = this.settings(projectId, owner);
    if (input.expected_version !== current)
      throw new ProjectSourceError(409, "SOURCE_EXCLUSIONS_VERSION_CONFLICT");
    const at = new Date().toISOString();
    this.db.exec("SAVEPOINT project_sources_update");
    try {
      this.db
        .prepare("DELETE FROM project_source_exclusions WHERE owner_id=? AND project_id=?")
        .run(owner, projectId);
      const insert = this.db.prepare(
        "INSERT INTO project_source_exclusions(owner_id,project_id,source_kind,source_id,excluded_at,reason) VALUES(?,?,?,?,?,?)"
      );
      for (const item of input.exclusions)
        insert.run(owner, projectId, item.source_kind, item.source_id, at, item.reason);
      const updated = this.db
        .prepare(
          "UPDATE project_source_settings SET version=version+1,updated_at=? WHERE owner_id=? AND project_id=? AND version=?"
        )
        .run(at, owner, projectId, current);
      if (updated.changes !== 1)
        throw new ProjectSourceError(409, "SOURCE_EXCLUSIONS_VERSION_CONFLICT");
      this.db.exec("RELEASE project_sources_update");
    } catch (error) {
      this.db.exec("ROLLBACK TO project_sources_update; RELEASE project_sources_update");
      throw error;
    }
    return this.exclusions(projectId, owner);
  }

  /** Links are written once at the run boundary; later edits/exclusions never rewrite them. */
  recordRunSources(projectId: string, owner: string, input: RunSourcesInput): RunSourcesView {
    this.active(owner);
    this.project(projectId, owner);
    if (!Value.Check(RunSourcesInputSchema, input))
      throw new ProjectSourceError(400, "INVALID_RUN_SOURCES");
    const prior = this.db
      .prepare(
        "SELECT sources_json FROM project_run_sources WHERE owner_id=? AND project_id=? AND run_id=?"
      )
      .get(owner, projectId, input.run_id) as { sources_json: string } | undefined;
    const json = JSON.stringify(input.sources);
    if (prior) {
      if (prior.sources_json !== json) throw new ProjectSourceError(409, "RUN_SOURCES_CONFLICT");
    } else {
      this.db
        .prepare(
          "INSERT INTO project_run_sources(owner_id,project_id,run_id,at,sources_json) VALUES(?,?,?,?,?)"
        )
        .run(owner, projectId, input.run_id, new Date().toISOString(), json);
    }
    return this.runSources(projectId, owner, input.run_id);
  }

  runSources(projectId: string, owner: string, runId: string): RunSourcesView {
    this.active(owner);
    this.project(projectId, owner);
    const row = this.db
      .prepare(
        "SELECT at,sources_json FROM project_run_sources WHERE owner_id=? AND project_id=? AND run_id=?"
      )
      .get(owner, projectId, runId) as { at: string; sources_json: string } | undefined;
    if (!row) throw new ProjectSourceError(404, "RUN_SOURCES_NOT_FOUND");
    const sources = JSON.parse(row.sources_json) as UsedSource[];
    const excluded = this.db
      .prepare(
        "SELECT source_kind,source_id FROM project_source_exclusions WHERE owner_id=? AND project_id=?"
      )
      .all(owner, projectId) as { source_kind: string; source_id: string }[];
    const excludedIds = new Set(excluded.map((e) => e.source_kind + ":" + e.source_id));
    return {
      project_id: projectId,
      run_id: runId,
      at: row.at,
      sources,
      excluded_now: [
        ...new Set(
          sources
            .filter((s) => excludedIds.has(s.source_kind + ":" + s.source_id))
            .map((s) => s.source_id)
        )
      ]
    };
  }

  /** Ids to pass into the existing recall path before the next run. */
  excludedSourceIds(projectId: string, owner: string): string[] {
    this.active(owner);
    this.project(projectId, owner);
    return (
      this.db
        .prepare(
          "SELECT DISTINCT source_id FROM project_source_exclusions WHERE owner_id=? AND project_id=? AND source_kind IN ('chat_message','project_message')"
        )
        .all(owner, projectId) as { source_id: string }[]
    ).map((e) => e.source_id);
  }
}
