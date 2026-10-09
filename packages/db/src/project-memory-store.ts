import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ProjectMemoryEntry,
  ProjectMemoryInput,
  ProjectMemorySnapshot
} from "@cosmora/contracts";
import { ProjectMemoryInputSchema } from "@cosmora/contracts";
import { Value } from "typebox/value";

export class ProjectMemoryConflict extends Error {}
type Row = {
  id: string;
  project_id: string;
  version: number;
  title: string;
  content: string;
  source_json: string;
  pinned: number;
  created_at: string;
  updated_at: string;
};
const decode = (row: Row): ProjectMemoryEntry => ({
  id: row.id,
  project_id: row.project_id,
  version: row.version,
  title: row.title,
  content: row.content,
  source: JSON.parse(row.source_json) as ProjectMemoryInput["source"],
  pinned: Boolean(row.pinned),
  created_at: row.created_at,
  updated_at: row.updated_at
});

export class ProjectMemoryStore {
  constructor(private readonly sqlite: DatabaseSync) {}
  private owned(projectId: string, ownerId: string, active = false): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT id FROM projects WHERE id = ? AND owner_id = ?" +
            (active ? " AND status = 'ACTIVE'" : "")
        )
        .get(projectId, ownerId)
    );
  }
  list(projectId: string, ownerId: string, query = ""): ProjectMemoryEntry[] {
    if (!this.owned(projectId, ownerId)) return [];
    const needle = query.normalize("NFKC").toLocaleLowerCase().slice(0, 200);
    return (
      this.sqlite
        .prepare(
          "SELECT * FROM project_memory WHERE project_id = ? AND owner_id = ? AND forgotten = 0 ORDER BY pinned DESC, updated_at DESC, id ASC LIMIT 200"
        )
        .all(projectId, ownerId) as Row[]
    )
      .map(decode)
      .filter(
        (e) =>
          !needle ||
          (e.title + "\n" + e.content + "\n" + e.source.reference)
            .normalize("NFKC")
            .toLocaleLowerCase()
            .includes(needle)
      );
  }
  get(projectId: string, ownerId: string, id: string): ProjectMemoryEntry | null {
    if (!this.owned(projectId, ownerId)) return null;
    const row = this.sqlite
      .prepare(
        "SELECT * FROM project_memory WHERE id = ? AND project_id = ? AND owner_id = ? AND forgotten = 0"
      )
      .get(id, projectId, ownerId) as Row | undefined;
    return row ? decode(row) : null;
  }
  create(projectId: string, ownerId: string, input: ProjectMemoryInput): ProjectMemoryEntry | null {
    if (!this.owned(projectId, ownerId, true)) return null;
    this.validate(input);
    this.validateSource(projectId, ownerId, input);
    if (this.list(projectId, ownerId).length >= 200)
      throw new ProjectMemoryConflict("MEMORY_LIMIT");
    const at = new Date().toISOString(),
      id = randomUUID();
    this.sqlite
      .prepare(
        "INSERT INTO project_memory (id, project_id, owner_id, version, title, content, source_json, pinned, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        projectId,
        ownerId,
        input.title,
        input.content,
        JSON.stringify(input.source),
        Number(input.pinned),
        at,
        at
      );
    return this.get(projectId, ownerId, id);
  }
  update(
    projectId: string,
    ownerId: string,
    id: string,
    version: number,
    input: ProjectMemoryInput
  ): ProjectMemoryEntry | null {
    if (!this.get(projectId, ownerId, id)) return null;
    if (!this.owned(projectId, ownerId, true)) throw new ProjectMemoryConflict("PROJECT_INACTIVE");
    this.validate(input);
    this.validateSource(projectId, ownerId, input);
    const result = this.sqlite
      .prepare(
        "UPDATE project_memory SET version = version + 1, title = ?, content = ?, source_json = ?, pinned = ?, updated_at = ? WHERE id = ? AND project_id = ? AND owner_id = ? AND version = ? AND forgotten = 0"
      )
      .run(
        input.title,
        input.content,
        JSON.stringify(input.source),
        Number(input.pinned),
        new Date().toISOString(),
        id,
        projectId,
        ownerId,
        version
      );
    if (!result.changes) throw new ProjectMemoryConflict("STALE_MEMORY");
    return this.get(projectId, ownerId, id);
  }
  control(
    projectId: string,
    ownerId: string,
    id: string,
    version: number,
    action: "pin" | "unpin" | "forget"
  ): ProjectMemoryEntry | { forgotten: true } | null {
    const previous = this.get(projectId, ownerId, id);
    if (!previous) return null;
    if (action !== "forget")
      return this.update(projectId, ownerId, id, version, {
        title: previous.title,
        content: previous.content,
        source: previous.source,
        pinned: action === "pin"
      });
    const result = this.sqlite
      .prepare(
        "UPDATE project_memory SET version = version + 1, forgotten = 1, pinned = 0, title = '', content = '', source_json = '{}', updated_at = ? WHERE id = ? AND project_id = ? AND owner_id = ? AND version = ? AND forgotten = 0"
      )
      .run(new Date().toISOString(), id, projectId, ownerId, version);
    if (!result.changes) throw new ProjectMemoryConflict("STALE_MEMORY");
    return { forgotten: true };
  }
  snapshot(projectId: string, ownerId: string): ProjectMemorySnapshot {
    const entries = this.list(projectId, ownerId),
      items: ProjectMemoryEntry[] = [];
    let chars = 0;
    for (const e of entries) {
      const cost = JSON.stringify(e).length;
      if (items.length >= 12 || chars + cost > 8000) continue;
      items.push(e);
      chars += cost;
    }
    return { items, omitted: entries.length - items.length };
  }
  // Snapshots preserve accepted context; explicit forget removes it from every subsequent dispatch.
  visibleSnapshot(
    projectId: string,
    ownerId: string,
    snapshot?: ProjectMemorySnapshot
  ): ProjectMemorySnapshot {
    const items =
      snapshot?.items.filter(
        (e) => e.project_id === projectId && this.get(projectId, ownerId, e.id)
      ) ?? [];
    return { items, omitted: snapshot?.omitted ?? 0 };
  }
  private validateSource(projectId: string, ownerId: string, input: ProjectMemoryInput): void {
    if (
      input.source.kind === "artifact" &&
      !this.sqlite
        .prepare(
          "SELECT a.id FROM work_artifact_versions a JOIN projects p ON p.id = a.project_id JOIN manager_work w ON w.id = a.work_id WHERE a.id = ? AND a.project_id = ? AND p.owner_id = ? AND a.published = 1 AND json_extract(w.state_json, '$.status') = 'completed'"
        )
        .get(input.source.reference, projectId, ownerId)
    )
      throw new ProjectMemoryConflict("MEMORY_SOURCE_NOT_FOUND");
  }
  private validate(input: ProjectMemoryInput): void {
    if (!Value.Check(ProjectMemoryInputSchema, input))
      throw new ProjectMemoryConflict("INVALID_MEMORY");
  }
}
