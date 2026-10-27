import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ManagerWork, WorkArtifactVersion, WorkCheckpointRecord } from "@cosmora/contracts";

type ArtifactRow = Omit<WorkArtifactVersion, "published"> & { content: string; published: number };
const metadata = (row: Omit<ArtifactRow, "content">): WorkArtifactVersion => ({
  id: row.id,
  project_id: row.project_id,
  work_id: row.work_id,
  name: row.name,
  version: row.version,
  sha256: row.sha256,
  bytes: row.bytes,
  published: Boolean(row.published),
  created_at: row.created_at
});
export class WorkRuntimeStore {
  constructor(private readonly sqlite: DatabaseSync) {}
  /** Called in the same transaction as work state saves. No provider replay/permission restoration. */
  checkpoint(work: ManagerWork): void {
    const checkpoint: WorkCheckpointRecord = {
      work_id: work.id,
      version: work.version,
      stage: work.stage,
      status: work.status,
      inflight_run_id: work.inflight_run_id,
      model_requests: work.model_requests,
      reserved_input_tokens: work.reserved_input_tokens,
      reserved_output_tokens: work.reserved_output_tokens,
      error_code: work.error_code,
      at: work.updated_at,
      restores_permissions: false,
      ...(work.task_graph ? { tasks: work.task_graph.tasks } : {})
    };
    this.sqlite
      .prepare("INSERT INTO work_checkpoints (work_id, version, state_json) VALUES (?, ?, ?)")
      .run(work.id, work.version, JSON.stringify(checkpoint));
    for (const file of work.draft?.files ?? []) {
      const previous = this.sqlite
        .prepare("SELECT sha256 FROM work_artifact_versions WHERE work_id = ? AND name = ?")
        .get(work.id, file.name) as { sha256: string } | undefined;
      const hash = createHash("sha256").update(file.content).digest("hex");
      if (previous) {
        if (previous.sha256 !== hash) throw new Error("IMMUTABLE_ARTIFACT_CONFLICT");
        continue;
      }
      const version = this.sqlite
        .prepare(
          "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM work_artifact_versions WHERE project_id = ? AND name = ?"
        )
        .get(work.project_id, file.name) as { next: number };
      this.sqlite
        .prepare(
          "INSERT INTO work_artifact_versions (id, project_id, work_id, name, version, content, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          randomUUID(),
          work.project_id,
          work.id,
          file.name,
          version.next,
          file.content,
          hash,
          Buffer.byteLength(file.content),
          work.updated_at
        );
    }
  }
  markPublished(workId: string): void {
    this.sqlite
      .prepare("UPDATE work_artifact_versions SET published = 1 WHERE work_id = ?")
      .run(workId);
  }
  checkpoints(projectId: string, ownerId: string, workId: string): WorkCheckpointRecord[] {
    return (
      this.sqlite
        .prepare(
          "SELECT c.state_json FROM work_checkpoints c JOIN manager_work w ON w.id = c.work_id JOIN projects p ON p.id = w.project_id WHERE c.work_id = ? AND w.project_id = ? AND w.owner_id = ? AND p.owner_id = ? ORDER BY c.version DESC LIMIT 100"
        )
        .all(workId, projectId, ownerId, ownerId) as { state_json: string }[]
    ).map((row) => JSON.parse(row.state_json) as WorkCheckpointRecord);
  }
  artifacts(projectId: string, ownerId: string, workId?: string): WorkArtifactVersion[] {
    return (
      this.sqlite
        .prepare(
          "SELECT a.id,a.project_id,a.work_id,a.name,a.version,a.sha256,a.bytes,a.published,a.created_at FROM work_artifact_versions a JOIN manager_work w ON w.id = a.work_id JOIN projects p ON p.id = a.project_id WHERE a.project_id = ? AND w.owner_id = ? AND p.owner_id = ?" +
            (workId ? " AND a.work_id = ?" : "") +
            " ORDER BY a.rowid DESC LIMIT 100"
        )
        .all(projectId, ownerId, ownerId, ...(workId ? [workId] : [])) as ArtifactRow[]
    ).map(metadata);
  }
  /** Metadata only; avoids loading file bodies before the caller applies its scan budget. */
  publishedArtifacts(projectId: string, ownerId: string): WorkArtifactVersion[] {
    return (
      this.sqlite
        .prepare(
          `SELECT a.id,a.project_id,a.work_id,a.name,a.version,a.sha256,a.bytes,a.published,a.created_at
       FROM work_artifact_versions a JOIN manager_work w ON w.id=a.work_id
       JOIN projects p ON p.id=a.project_id
       WHERE a.project_id=? AND w.owner_id=? AND p.owner_id=? AND a.published=1
       AND json_extract(w.state_json,'$.status')='completed' ORDER BY a.rowid DESC LIMIT 101`
        )
        .all(projectId, ownerId, ownerId) as Omit<ArtifactRow, "content">[]
    ).map(metadata);
  }
  artifact(
    projectId: string,
    ownerId: string,
    id: string
  ): { metadata: WorkArtifactVersion; content: string } | null {
    const row = this.sqlite
      .prepare(
        "SELECT a.* FROM work_artifact_versions a JOIN manager_work w ON w.id = a.work_id JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND a.project_id = ? AND w.owner_id = ? AND p.owner_id = ? AND a.published = 1 AND json_extract(w.state_json, '$.status') = 'completed'"
      )
      .get(id, projectId, ownerId, ownerId) as ArtifactRow | undefined;
    return row ? { metadata: metadata(row), content: row.content } : null;
  }
}
