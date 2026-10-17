import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { ArtifactContextCandidate } from "@cosmora/contracts/artifact-context";
import {
  DATA_SERVER_BYTES,
  DATA_SERVER_HISTORY_BYTES,
  DATA_SERVER_REVISIONS,
  parseDataWorkspace
} from "@cosmora/contracts/data-workspace";
import {
  CANVAS_MAX_IMPORT_BYTES,
  CANVAS_MAX_PROJECT_ARTIFACTS,
  CANVAS_MAX_REVISIONS,
  canvasBytes,
  validateCanvasContent,
  type CanvasArtifact,
  type CanvasFormat,
  type CanvasRevision,
  type CanvasSource
} from "@cosmora/contracts";

export class CanvasConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("CANVAS_VERSION_CONFLICT");
  }
}
export class CanvasLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
interface ArtifactRow extends Omit<CanvasArtifact, "version"> {
  [column: string]: SQLOutputValue;
  current_version: number;
}
interface RevisionRow extends Omit<CanvasRevision, "source"> {
  source_json: string;
}
const artifact = (r: ArtifactRow): CanvasArtifact => ({
  id: r.id,
  project_id: r.project_id,
  title: r.title,
  format: r.format,
  version: r.current_version,
  created_at: r.created_at,
  updated_at: r.updated_at
});
const revision = (r: RevisionRow): CanvasRevision => ({
  artifact_id: r.artifact_id,
  version: r.version,
  title: r.title,
  format: r.format,
  content: r.content,
  sha256: r.sha256,
  source: JSON.parse(r.source_json) as CanvasSource,
  created_at: r.created_at
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const timestamp = () => new Date().toISOString();

/** Single SQLite writer, atomic optimistic updates, never writes existing revision contents. */
export class CanvasArtifactStore {
  constructor(readonly sqlite: DatabaseSync) {}

  /** Every editor write honors the durable owner fence installed by migration 0030. */
  private assertOwnerActive(ownerId: string): void {
    const state = this.sqlite
      .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(ownerId) as { state: string } | undefined;
    if (state && state.state !== "active") throw new CanvasLimitError("CANVAS_OWNER_FENCED");
  }
  private ownedProject(projectId: string, ownerId: string): boolean {
    return !!this.sqlite
      .prepare("SELECT 1 FROM projects WHERE id = ? AND owner_id = ?")
      .get(projectId, ownerId);
  }
  private ownedArtifact(projectId: string, ownerId: string, id: string): ArtifactRow | null {
    return (
      (this.sqlite
        .prepare(
          `SELECT a.* FROM canvas_artifacts a
      JOIN projects p ON p.id = a.project_id AND p.owner_id = a.owner_id
      WHERE a.id = ? AND a.project_id = ? AND a.owner_id = ?`
        )
        .get(id, projectId, ownerId) as ArtifactRow | undefined) ?? null
    );
  }
  list(
    projectId: string,
    ownerId: string,
    limit = 100,
    offset = 0,
    tables = false
  ): CanvasArtifact[] | null {
    if (!this.ownedProject(projectId, ownerId)) return null;
    return (
      this.sqlite
        .prepare(
          `SELECT a.* FROM canvas_artifacts a JOIN projects p
      ON p.id = a.project_id AND p.owner_id = a.owner_id
      WHERE a.owner_id = ? AND a.project_id = ?
      AND EXISTS(SELECT 1 FROM canvas_revisions first WHERE first.artifact_id=a.id AND first.version=1
        AND (json_extract(first.source_json,'$.kind')='data_workspace')=?)
      ORDER BY a.updated_at DESC, a.id DESC LIMIT ? OFFSET ?`
        )
        .all(
          ownerId,
          projectId,
          Number(tables),
          Math.min(Math.max(limit, 1), 100),
          Math.max(offset, 0)
        ) as ArtifactRow[]
    ).map(artifact);
  }
  isTable(projectId: string, ownerId: string, id: string): boolean {
    return this.getRevision(projectId, ownerId, id, 1)?.source.kind === "data_workspace";
  }
  contextCandidates(projectId: string, ownerId: string): ArtifactContextCandidate[] | null {
    if (!this.ownedProject(projectId, ownerId)) return null;
    return this.sqlite
      .prepare(
        `SELECT a.id, a.title, a.current_version AS version, r.sha256,
      length(CAST(r.content AS BLOB)) AS bytes,
      CASE WHEN json_extract(first.source_json,'$.kind')='data_workspace' THEN 'table' ELSE 'canvas' END AS kind
      FROM canvas_artifacts a
      JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id
      JOIN canvas_revisions r ON r.artifact_id=a.id AND r.version=a.current_version
      JOIN canvas_revisions first ON first.artifact_id=a.id AND first.version=1
      WHERE a.project_id=? AND a.owner_id=? ORDER BY a.updated_at DESC, a.id DESC LIMIT 200`
      )
      .all(projectId, ownerId) as unknown as ArtifactContextCandidate[];
  }
  private validateInput(input: {
    title: string;
    format: CanvasFormat;
    content: string;
    source?: CanvasSource;
  }) {
    if (input.source?.kind !== "data_workspace") {
      validateCanvasContent(input.title, input.format, input.content);
      return;
    }
    validateCanvasContent(input.title, input.format, "");
    if (input.format !== "code") throw new CanvasLimitError("DATA_WORKSPACE_INVALID");
    if (canvasBytes(input.content) > DATA_SERVER_BYTES)
      throw new CanvasLimitError("DATA_WORKSPACE_SIZE_LIMIT");
    try {
      parseDataWorkspace(input.content);
    } catch {
      throw new CanvasLimitError("DATA_WORKSPACE_INVALID");
    }
  }
  private assertTableQuota(projectId: string, ownerId: string, content: string) {
    const total = this.sqlite
      .prepare(
        `SELECT COALESCE(SUM(length(CAST(r.content AS BLOB))),0) AS bytes
      FROM canvas_revisions r JOIN canvas_artifacts a ON a.id=r.artifact_id
      WHERE a.project_id=? AND a.owner_id=? AND EXISTS(SELECT 1 FROM canvas_revisions first
        WHERE first.artifact_id=a.id AND first.version=1 AND json_extract(first.source_json,'$.kind')='data_workspace')`
      )
      .get(projectId, ownerId) as { bytes: number };
    if (total.bytes + canvasBytes(content) > DATA_SERVER_HISTORY_BYTES)
      throw new CanvasLimitError("DATA_WORKSPACE_PROJECT_QUOTA");
  }
  get(
    projectId: string,
    ownerId: string,
    id: string
  ): { artifact: CanvasArtifact; revision: CanvasRevision } | null {
    const a = this.ownedArtifact(projectId, ownerId, id);
    const r =
      a &&
      (this.sqlite
        .prepare("SELECT * FROM canvas_revisions WHERE artifact_id = ? AND version = ?")
        .get(id, a.current_version) as RevisionRow | undefined);
    return a && r ? { artifact: artifact(a), revision: revision(r) } : null;
  }
  history(
    projectId: string,
    ownerId: string,
    id: string,
    limit = 100,
    offset = 0
  ): Omit<CanvasRevision, "content">[] | null {
    if (!this.ownedArtifact(projectId, ownerId, id)) return null;
    return (
      this.sqlite
        .prepare(
          `SELECT artifact_id, version, title, format, sha256, source_json, created_at
      FROM canvas_revisions WHERE artifact_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`
        )
        .all(id, Math.min(Math.max(1, limit), 100), Math.min(Math.max(0, offset), 500)) as Omit<
        RevisionRow,
        "content"
      >[]
    ).map((r) => ({
      artifact_id: r.artifact_id,
      version: r.version,
      title: r.title,
      format: r.format,
      sha256: r.sha256,
      source: JSON.parse(r.source_json) as CanvasSource,
      created_at: r.created_at
    }));
  }
  getRevision(
    projectId: string,
    ownerId: string,
    id: string,
    version: number
  ): CanvasRevision | null {
    if (!this.ownedArtifact(projectId, ownerId, id)) return null;
    const r = this.sqlite
      .prepare("SELECT * FROM canvas_revisions WHERE artifact_id = ? AND version = ?")
      .get(id, version) as RevisionRow | undefined;
    return r ? revision(r) : null;
  }
  private tx<T>(operation: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  private insertRevision(
    id: string,
    version: number,
    title: string,
    format: CanvasFormat,
    content: string,
    source: CanvasSource,
    at: string
  ): void {
    this.sqlite
      .prepare(
        `INSERT INTO canvas_revisions
      (artifact_id,version,title,format,content,sha256,source_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(id, version, title, format, content, hash(content), JSON.stringify(source), at);
  }
  create(
    projectId: string,
    ownerId: string,
    input: {
      title: string;
      format: CanvasFormat;
      content: string;
      source?: CanvasSource;
      idempotency_id?: string;
    }
  ): { artifact: CanvasArtifact; revision: CanvasRevision } | null {
    this.validateInput(input);
    return this.tx(() => {
      this.assertOwnerActive(ownerId);
      if (!this.ownedProject(projectId, ownerId)) return null;
      if (input.idempotency_id) {
        const existing = this.get(projectId, ownerId, input.idempotency_id);
        if (existing) {
          const first = this.getRevision(projectId, ownerId, existing.artifact.id, 1)!;
          // Chat transfer historically addresses one editor copy per source. Its
          // later edits stay canonical; ordinary creates must match exactly.
          const sameChat =
            input.source?.kind === "chat" &&
            first.source.kind === "chat" &&
            input.source.chat_id === first.source.chat_id &&
            input.source.message_id === first.source.message_id;
          if (
            !sameChat &&
            ((input.source?.kind ?? "manual") !== first.source.kind ||
              existing.revision.content !== input.content ||
              existing.artifact.title !== input.title ||
              existing.artifact.format !== input.format)
          )
            throw new CanvasLimitError(
              input.source?.kind === "data_workspace"
                ? "DATA_WORKSPACE_REQUEST_CONFLICT"
                : "CANVAS_REQUEST_CONFLICT"
            );
          if (
            input.source?.kind === "data_workspace" &&
            (!this.isTable(projectId, ownerId, existing.artifact.id) ||
              existing.revision.content !== input.content ||
              existing.artifact.title !== input.title)
          )
            throw new CanvasLimitError("DATA_WORKSPACE_REQUEST_CONFLICT");
          return existing;
        }
        if (
          this.sqlite.prepare("SELECT 1 FROM canvas_artifacts WHERE id=?").get(input.idempotency_id)
        )
          throw new CanvasLimitError(
            input.source?.kind === "data_workspace"
              ? "DATA_WORKSPACE_REQUEST_CONFLICT"
              : "CANVAS_REQUEST_CONFLICT"
          );
      }
      if (input.source?.kind === "data_workspace")
        this.assertTableQuota(projectId, ownerId, input.content);
      const total = this.sqlite
        .prepare("SELECT COUNT(*) AS n FROM canvas_artifacts WHERE owner_id=? AND project_id=?")
        .get(ownerId, projectId) as { n: number };
      if (total.n >= CANVAS_MAX_PROJECT_ARTIFACTS)
        throw new CanvasLimitError("CANVAS_ARTIFACT_LIMIT");
      const id = input.idempotency_id ?? randomUUID(),
        at = timestamp();
      this.sqlite
        .prepare(
          `INSERT INTO canvas_artifacts
        (id,project_id,owner_id,title,format,current_version,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?)`
        )
        .run(id, projectId, ownerId, input.title, input.format, at, at);
      this.insertRevision(
        id,
        1,
        input.title,
        input.format,
        input.content,
        input.source ?? { kind: "manual" },
        at
      );
      return this.get(projectId, ownerId, id);
    });
  }
  update(
    projectId: string,
    ownerId: string,
    id: string,
    input: {
      baseVersion: number;
      title: string;
      format: CanvasFormat;
      content: string;
      source?: CanvasSource;
    }
  ): { artifact: CanvasArtifact; revision: CanvasRevision } | null {
    this.validateInput(input);
    return this.tx(() => {
      this.assertOwnerActive(ownerId);
      const a = this.ownedArtifact(projectId, ownerId, id);
      if (!a) return null;
      const table = this.isTable(projectId, ownerId, id);
      if (table !== (input.source?.kind === "data_workspace"))
        throw new CanvasLimitError("DATA_WORKSPACE_EDITOR_REQUIRED");
      if (a.current_version !== input.baseVersion) throw new CanvasConflictError(a.current_version);
      if (table) {
        if (a.current_version >= DATA_SERVER_REVISIONS)
          throw new CanvasLimitError("DATA_WORKSPACE_REVISION_LIMIT");
        this.assertTableQuota(projectId, ownerId, input.content);
      }
      if (a.current_version >= CANVAS_MAX_REVISIONS)
        throw new CanvasLimitError("CANVAS_REVISION_LIMIT");
      const next = a.current_version + 1,
        at = timestamp();
      const changed = this.sqlite
        .prepare(
          `UPDATE canvas_artifacts
        SET current_version=?,title=?,format=?,updated_at=?
        WHERE id=? AND owner_id=? AND project_id=? AND current_version=?`
        )
        .run(next, input.title, input.format, at, id, ownerId, projectId, input.baseVersion);
      if (changed.changes !== 1) throw new CanvasConflictError(a.current_version);
      this.insertRevision(
        id,
        next,
        input.title,
        input.format,
        input.content,
        input.source ?? { kind: "manual" },
        at
      );
      return this.get(projectId, ownerId, id);
    });
  }
  restore(
    projectId: string,
    ownerId: string,
    id: string,
    baseVersion: number,
    sourceVersion: number
  ) {
    const original = this.getRevision(projectId, ownerId, id, sourceVersion);
    if (!original) return null;
    return this.update(projectId, ownerId, id, {
      baseVersion,
      title: original.title,
      format: original.format,
      content: original.content,
      source: { kind: "restore", revision: sourceVersion }
    });
  }
  delete(projectId: string, ownerId: string, id: string): boolean {
    return this.tx(() => {
      this.assertOwnerActive(ownerId);
      return (
        this.sqlite
          .prepare(
            `DELETE FROM canvas_artifacts WHERE id=? AND project_id=? AND owner_id=?
        AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=?)`
          )
          .run(id, projectId, ownerId, projectId, ownerId).changes === 1
      );
    });
  }
  importCandidates(
    projectId: string,
    ownerId: string
  ): Array<{
    title: string;
    source:
      | { kind: "work"; work_artifact_id: string }
      | { kind: "chat"; chat_id: string; message_id: string }
      | { kind: "project_chat"; message_id: string };
  }> | null {
    if (!this.ownedProject(projectId, ownerId)) return null;
    const work = this.sqlite
      .prepare(
        `SELECT a.id, a.name AS title FROM work_artifact_versions a
      JOIN manager_work w ON w.id=a.work_id AND w.project_id=a.project_id
      JOIN projects p ON p.id=a.project_id
      WHERE a.project_id=? AND p.owner_id=? AND w.owner_id=?
        AND a.published=1 AND json_extract(w.state_json,'$.status')='completed'
      ORDER BY a.rowid DESC LIMIT 50`
      )
      .all(projectId, ownerId, ownerId) as { id: string; title: string }[];
    const project = this.sqlite
      .prepare(
        `SELECT m.id, substr(m.content,1,100) AS title FROM messages m
      JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND p.owner_id=?
      AND m.role='assistant' AND m.status='completed' AND m.content_type='text'
      ORDER BY m.created_at DESC,m.rowid DESC LIMIT 50`
      )
      .all(projectId, ownerId) as { id: string; title: string }[];
    const chats = this.sqlite
      .prepare(
        `SELECT m.id,m.chat_id,substr(m.content,1,100) AS title FROM general_chat_messages m
      JOIN general_chats c ON c.id=m.chat_id WHERE c.owner_id=? AND m.owner_id=?
      AND m.role='assistant' AND m.status='completed' AND m.content_type='text'
      ORDER BY m.created_at DESC,m.rowid DESC LIMIT 50`
      )
      .all(ownerId, ownerId) as { id: string; chat_id: string; title: string }[];
    return [
      ...work.map((r) => ({
        title: r.title,
        source: { kind: "work" as const, work_artifact_id: r.id }
      })),
      ...project.map((r) => ({
        title: r.title,
        source: { kind: "project_chat" as const, message_id: r.id }
      })),
      ...chats.map((r) => ({
        title: r.title,
        source: { kind: "chat" as const, chat_id: r.chat_id, message_id: r.id }
      }))
    ];
  }
  /** Read existing completed/published source only. No mutation of Work or chat tables. */
  importSource(
    projectId: string,
    ownerId: string,
    input: {
      title: string;
      format: CanvasFormat;
      source:
        | { kind: "work"; work_artifact_id: string }
        | { kind: "chat"; chat_id: string; message_id: string }
        | { kind: "project_chat"; message_id: string };
    }
  ) {
    if (!this.ownedProject(projectId, ownerId)) return null;
    let content: string | undefined;
    if (input.source.kind === "work") {
      const row = this.sqlite
        .prepare(
          `SELECT a.content FROM work_artifact_versions a
        JOIN manager_work w ON w.id=a.work_id AND w.project_id=a.project_id
        JOIN projects p ON p.id=a.project_id
        WHERE a.id=? AND a.project_id=? AND p.owner_id=? AND w.owner_id=?
          AND a.published=1 AND json_extract(w.state_json,'$.status')='completed'`
        )
        .get(input.source.work_artifact_id, projectId, ownerId, ownerId) as
        { content: string } | undefined;
      content = row?.content;
    } else if (input.source.kind === "chat") {
      const row = this.sqlite
        .prepare(
          `SELECT m.content FROM general_chat_messages m
        JOIN general_chats c ON c.id=m.chat_id
        WHERE m.id=? AND m.chat_id=? AND m.owner_id=? AND c.owner_id=?
        AND m.role='assistant' AND m.status='completed' AND m.content_type='text'`
        )
        .get(input.source.message_id, input.source.chat_id, ownerId, ownerId) as
        { content: string } | undefined;
      content = row?.content;
    } else {
      const row = this.sqlite
        .prepare(
          `SELECT m.content FROM messages m JOIN projects p ON p.id=m.project_id
        WHERE m.id=? AND m.project_id=? AND p.owner_id=? AND m.role='assistant'
          AND m.status='completed' AND m.content_type='text'`
        )
        .get(input.source.message_id, projectId, ownerId) as { content: string } | undefined;
      content = row?.content;
    }
    if (content === undefined) return null;
    if (canvasBytes(content) > CANVAS_MAX_IMPORT_BYTES)
      throw new CanvasLimitError("CANVAS_IMPORT_TOO_LARGE");
    return this.create(projectId, ownerId, {
      title: input.title,
      format: input.format,
      content,
      source: input.source,
      ...(input.source.kind === "chat"
        ? {
            idempotency_id:
              "chat-" +
              hash(
                JSON.stringify([ownerId, projectId, input.source.chat_id, input.source.message_id])
              )
          }
        : {})
    });
  }
  /** Bounded, resumable privacy stream; caller must consume every page before reporting success. */
  privacyExport(
    ownerId: string,
    cursor: string | null = null
  ): {
    items: Array<{ artifact: CanvasArtifact; revision: CanvasRevision }>;
    next_cursor: string | null;
  } {
    const parts = cursor?.split(":") ?? ["", "0"];
    if (
      parts.length !== 2 ||
      !Number.isSafeInteger(Number(parts[1])) ||
      Number(parts[1]) < 0 ||
      parts[0]!.length > 128
    )
      throw new CanvasLimitError("CANVAS_PRIVACY_BAD_CURSOR");
    const cursorArtifactId = parts[0]!;
    const cursorVersion = Number(parts[1]);
    const rows = this.sqlite
      .prepare(
        `SELECT a.id,a.project_id,a.title,a.format,a.current_version,
      a.created_at,a.updated_at,r.version AS revision_version,r.title AS revision_title,
      r.format AS revision_format,r.content,r.sha256,r.source_json,r.created_at AS revision_created_at
      FROM canvas_artifacts a JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id
      JOIN canvas_revisions r ON r.artifact_id=a.id WHERE a.owner_id=?
      AND (a.id>? OR (a.id=? AND r.version>?))
      ORDER BY a.id ASC,r.version ASC LIMIT 33`
      )
      .all(ownerId, cursorArtifactId, cursorArtifactId, cursorVersion) as Array<
      ArtifactRow & {
        revision_version: number;
        revision_title: string;
        revision_format: CanvasFormat;
        content: string;
        sha256: string;
        source_json: string;
        revision_created_at: string;
      }
    >;
    const items: Array<{ artifact: CanvasArtifact; revision: CanvasRevision }> = [];
    let bytes = 0,
      last = cursor;
    for (const row of rows) {
      if (items.length >= 32) break;
      const cost =
        canvasBytes(row.content) + canvasBytes(row.title) + canvasBytes(row.revision_title) + 512;
      if (bytes + cost > 4 * 1024 * 1024) {
        if (items.length === 0) throw new CanvasLimitError("CANVAS_PRIVACY_EXPORT_BOUNDED");
        break;
      }
      bytes += cost;
      items.push({
        artifact: artifact(row),
        revision: {
          artifact_id: row.id,
          version: row.revision_version,
          title: row.revision_title,
          format: row.revision_format,
          content: row.content,
          sha256: row.sha256,
          source: JSON.parse(row.source_json) as CanvasSource,
          created_at: row.revision_created_at
        }
      });
      last = `${row.id}:${row.revision_version}`;
    }
    return { items, next_cursor: rows.length > items.length ? last : null };
  }
  privacyDelete(ownerId: string): { artifacts: number; revisions: number } {
    const revisions = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM canvas_revisions r
      JOIN canvas_artifacts a ON a.id=r.artifact_id
      JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id
      WHERE a.owner_id=?`
      )
      .get(ownerId) as { n: number };
    const result = this.sqlite
      .prepare(
        `DELETE FROM canvas_artifacts WHERE owner_id=?
      AND project_id IN (SELECT id FROM projects WHERE owner_id=?)`
      )
      .run(ownerId, ownerId);
    return { artifacts: Number(result.changes), revisions: revisions.n };
  }
}
