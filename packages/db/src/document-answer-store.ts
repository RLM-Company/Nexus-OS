import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryHitRow } from "./document-library-store.js";

export type AnswerSource = Pick<
  LibraryHitRow,
  "chunk_id" | "file_id" | "name" | "page" | "line_start" | "line_end" | "content"
> & { ref: string };
export type DocumentAnswer = {
  id: string;
  project_id: string;
  owner_id: string;
  question: string;
  selected_file_ids: string[];
  sources: AnswerSource[];
  answer: string | null;
  citations: string[];
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error_code: string | null;
  created_at: string;
  updated_at: string;
};
export class DocumentAnswerError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_SOURCES" | "QUIESCED") {
    super(code);
  }
}
const json = <T>(value: string): T => JSON.parse(value) as T;
const asAnswer = (row: Record<string, unknown>): DocumentAnswer => ({
  id: String(row.id),
  project_id: String(row.project_id),
  owner_id: String(row.owner_id),
  question: String(row.question),
  selected_file_ids: json<string[]>(String(row.selected_files_json)),
  sources: json<AnswerSource[]>(String(row.sources_json)),
  answer: row.answer_text as string | null,
  citations: json<string[]>(String(row.citations_json)),
  status: row.status as DocumentAnswer["status"],
  error_code: row.error_code as string | null,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});
export class DocumentAnswerStore {
  constructor(private readonly sqlite: DatabaseSync) {}
  list(projectId: string, ownerId: string): DocumentAnswer[] {
    this.assertProject(projectId, ownerId);
    return (
      this.sqlite
        .prepare(
          `SELECT * FROM document_answer_runs WHERE project_id=? AND owner_id=?
      ORDER BY created_at DESC LIMIT 40`
        )
        .all(projectId, ownerId) as Record<string, unknown>[]
    ).map(asAnswer);
  }
  get(projectId: string, ownerId: string, id: string): DocumentAnswer | null {
    const row = this.sqlite
      .prepare(
        `SELECT * FROM document_answer_runs
      WHERE id=? AND project_id=? AND owner_id=?`
      )
      .get(id, projectId, ownerId);
    return row ? asAnswer(row) : null;
  }
  assertProject(projectId: string, ownerId: string): void {
    if (
      !this.sqlite
        .prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?")
        .get(projectId, ownerId)
    )
      throw new DocumentAnswerError("NOT_FOUND");
  }
  create(
    projectId: string,
    ownerId: string,
    question: string,
    fileIds: string[],
    sources: AnswerSource[]
  ): DocumentAnswer {
    if (
      !fileIds.length ||
      fileIds.length > 20 ||
      !sources.length ||
      sources.length > 8 ||
      sources.some((source, i) => source.ref !== `S${i + 1}` || !fileIds.includes(source.file_id))
    )
      throw new DocumentAnswerError("INVALID_SOURCES");
    const id = randomUUID();
    const at = new Date().toISOString();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.assertProject(projectId, ownerId);
      // Revalidate every selected chunk at creation time (search results are not trusted).
      for (const source of sources) {
        const row = this.sqlite
          .prepare(
            `SELECT c.id, c.content, c.page, c.line_start,c.line_end, f.name
          FROM document_library_chunks c JOIN document_library_files f ON f.id=c.file_id
          WHERE c.id=? AND c.file_id=? AND f.project_id=? AND f.owner_id=? AND f.status='ready'`
          )
          .get(source.chunk_id, source.file_id, projectId, ownerId);
        if (
          !row ||
          row.content !== source.content ||
          row.name !== source.name ||
          row.page !== source.page ||
          row.line_start !== source.line_start ||
          row.line_end !== source.line_end
        )
          throw new DocumentAnswerError("INVALID_SOURCES");
      }
      this.sqlite
        .prepare(
          `INSERT INTO document_answer_runs
        (id,project_id,owner_id,question,selected_files_json,sources_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'queued',?,?)`
        )
        .run(
          id,
          projectId,
          ownerId,
          question,
          JSON.stringify(fileIds),
          JSON.stringify(sources),
          at,
          at
        );
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return this.get(projectId, ownerId, id)!;
  }
  transition(
    projectId: string,
    ownerId: string,
    id: string,
    from: DocumentAnswer["status"],
    to: DocumentAnswer["status"],
    output: { answer?: string; citations?: string[]; error?: string } = {}
  ): boolean {
    return (
      Number(
        this.sqlite
          .prepare(
            `UPDATE document_answer_runs SET status=?, answer_text=COALESCE(?,answer_text),
      citations_json=COALESCE(?,citations_json), error_code=?,updated_at=?
      WHERE id=? AND project_id=? AND owner_id=? AND status=?
        AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=?)`
          )
          .run(
            to,
            output.answer ?? null,
            output.citations ? JSON.stringify(output.citations) : null,
            output.error ?? null,
            new Date().toISOString(),
            id,
            projectId,
            ownerId,
            from,
            projectId,
            ownerId
          ).changes
      ) === 1
    );
  }
  cancel(projectId: string, ownerId: string, id: string): boolean {
    return (
      Number(
        this.sqlite
          .prepare(
            `UPDATE document_answer_runs SET status='cancelled',error_code='CANCELLED',updated_at=?
      WHERE id=? AND project_id=? AND owner_id=? AND status IN ('queued','running')`
          )
          .run(new Date().toISOString(), id, projectId, ownerId).changes
      ) === 1
    );
  }
  /** Never automatically re-dispatch an in-flight request after a process crash. Holds belong to canonical ledger. */
  recoverInterrupted(): number {
    return Number(
      this.sqlite
        .prepare(
          `UPDATE document_answer_runs SET status='failed',
      error_code=CASE WHEN status='running' THEN 'INTERRUPTED_UNCERTAIN' ELSE 'INTERRUPTED_BEFORE_DISPATCH' END,
      updated_at=? WHERE status IN ('running','queued')`
        )
        .run(new Date().toISOString()).changes
    );
  }
  exportOwner(ownerId: string): {
    manifest: Array<Record<string, unknown>>;
    files: Array<Record<string, unknown>>;
    chunks: Array<Record<string, unknown>>;
    answers: DocumentAnswer[];
  } {
    const originals = this.sqlite
      .prepare(
        `SELECT f.id,f.project_id,f.name,f.media_type,f.bytes,f.original
      FROM document_library_files f JOIN projects p ON p.id=f.project_id
      WHERE f.owner_id=? AND p.owner_id=? ORDER BY f.project_id,f.id`
      )
      .iterate(ownerId, ownerId);
    const manifest: Array<Record<string, unknown>> = [];
    for (const original of originals)
      manifest.push({
        id: original.id,
        project_id: original.project_id,
        name: original.name,
        media_type: original.media_type,
        bytes: original.bytes,
        sha256: createHash("sha256")
          .update(original.original as Uint8Array)
          .digest("hex"),
        // Link must be fetched while authenticated, before destructive deletion.
        authenticated_url: `/api/v1/projects/${encodeURIComponent(String(original.project_id))}/document-library/${encodeURIComponent(String(original.id))}/download`
      });
    const answers = (
      this.sqlite
        .prepare("SELECT * FROM document_answer_runs WHERE owner_id=? ORDER BY created_at")
        .all(ownerId) as Record<string, unknown>[]
    ).map(asAnswer);
    const files = this.sqlite
      .prepare(
        `SELECT f.id,f.project_id,f.owner_id,f.name,f.format,
      f.media_type,f.bytes,f.status,f.error_code,f.characters,f.chunks,f.created_at,f.updated_at
      FROM document_library_files f JOIN projects p ON p.id=f.project_id
      WHERE f.owner_id=? AND p.owner_id=? ORDER BY f.project_id,f.id`
      )
      .all(ownerId, ownerId);
    const chunks = this.sqlite
      .prepare(
        `SELECT c.file_id,c.ordinal,c.page,c.line_start,c.line_end,c.content
      FROM document_library_chunks c JOIN document_library_files f ON f.id=c.file_id
      JOIN projects p ON p.id=f.project_id
      WHERE f.owner_id=? AND p.owner_id=? ORDER BY c.file_id,c.ordinal`
      )
      .all(ownerId, ownerId);
    return { manifest, files, chunks, answers };
  }
  deleteOwner(ownerId: string): { originals: number; answers: number } {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const answers = this.sqlite
        .prepare(
          "DELETE FROM document_answer_runs WHERE owner_id=? AND project_id IN (SELECT id FROM projects WHERE owner_id=?)"
        )
        .run(ownerId, ownerId);
      const originals = this.sqlite
        .prepare(
          "DELETE FROM document_library_files WHERE owner_id=? AND project_id IN (SELECT id FROM projects WHERE owner_id=?)"
        )
        .run(ownerId, ownerId);
      this.sqlite.exec("COMMIT");
      return { originals: Number(originals.changes), answers: Number(answers.changes) };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
