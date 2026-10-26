import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
export type LibraryPage = { page: number | null; text: string };
export type LibraryChunk = {
  ordinal: number;
  page: number | null;
  line_start: number;
  line_end: number;
  content: string;
};
const LIMITS = {
  fileBytes: 20_000_000,
  textCharacters: 2_000_000,
  pdfPages: 500,
  chunksPerFile: 5_000,
  filesPerProject: 100,
  bytesPerProject: 100_000_000
} as const;

export type DocumentFormat = "pdf" | "docx" | "txt" | "csv";
export type DocumentStatus = "processing" | "ready" | "failed";
export type LibraryFile = {
  id: string;
  project_id: string;
  name: string;
  format: DocumentFormat;
  bytes: number;
  status: DocumentStatus;
  error_code: string | null;
  characters: number;
  chunks: number;
  created_at: string;
  updated_at: string;
};
export type LibraryHitRow = LibraryChunk & {
  chunk_id: number;
  file_id: string;
  name: string;
};

export class DocumentLibraryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID_FILE" | "QUOTA_EXCEEDED" | "INVALID_INDEX" | "CONFLICT"
  ) {
    super(code);
  }
}

export class DocumentLibraryStore {
  constructor(private readonly sqlite: DatabaseSync) {}

  private ownedProject(projectId: string, ownerId: string): boolean {
    return !!this.sqlite
      .prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?")
      .get(projectId, ownerId);
  }

  list(projectId: string, ownerId: string): LibraryFile[] {
    if (!this.ownedProject(projectId, ownerId)) throw new DocumentLibraryError("NOT_FOUND");
    return this.sqlite
      .prepare(
        `SELECT id,project_id,name,format,bytes,status,error_code,characters,chunks,created_at,updated_at
      FROM document_library_files WHERE project_id=? AND owner_id=? ORDER BY created_at DESC`
      )
      .all(projectId, ownerId) as LibraryFile[];
  }

  get(projectId: string, ownerId: string, id: string): LibraryFile | null {
    return (
      (this.sqlite
        .prepare(
          `SELECT id,project_id,name,format,bytes,status,error_code,characters,chunks,created_at,updated_at
      FROM document_library_files WHERE id=? AND project_id=? AND owner_id=?`
        )
        .get(id, projectId, ownerId) as LibraryFile | undefined) ?? null
    );
  }

  stage(projectId: string, ownerId: string, name: string, bytes: Buffer): LibraryFile {
    const format = name.toLowerCase().split(".").at(-1) as DocumentFormat;
    if (
      !/^[^/\\]{1,180}\.(pdf|docx|csv|txt)$/i.test(name) ||
      Array.from(name).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }) ||
      !["pdf", "docx", "csv", "txt"].includes(format) ||
      bytes.length < 1 ||
      bytes.length > LIMITS.fileBytes
    )
      throw new DocumentLibraryError("INVALID_FILE");
    if (format === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new DocumentLibraryError("INVALID_FILE");
    if (format === "docx" && bytes.subarray(0, 4).toString("hex") !== "504b0304")
      throw new DocumentLibraryError("INVALID_FILE");
    if (format === "txt" || format === "csv") {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new DocumentLibraryError("INVALID_FILE");
      }
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (!this.ownedProject(projectId, ownerId)) throw new DocumentLibraryError("NOT_FOUND");
      const count = this.sqlite
        .prepare(
          `SELECT count(*) AS count,coalesce(sum(bytes),0) AS total
        FROM document_library_files WHERE project_id=? AND owner_id=?`
        )
        .get(projectId, ownerId)!;
      if (
        Number(count.count) >= LIMITS.filesPerProject ||
        Number(count.total) + bytes.length > LIMITS.bytesPerProject
      )
        throw new DocumentLibraryError("QUOTA_EXCEEDED");
      const id = randomUUID();
      const at = new Date().toISOString();
      const mediaType = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt: "text/plain; charset=utf-8",
        csv: "text/csv; charset=utf-8"
      }[format];
      this.sqlite
        .prepare(
          `INSERT INTO document_library_files
        (id,project_id,owner_id,name,format,media_type,bytes,original,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          projectId,
          ownerId,
          name,
          format,
          mediaType,
          bytes.length,
          bytes,
          "processing",
          at,
          at
        );
      this.sqlite.exec("COMMIT");
      return this.get(projectId, ownerId, id)!;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  /** Retry a failed extraction IN PLACE; quota and original bytes remain unchanged. */
  retry(projectId: string, ownerId: string, id: string): LibraryFile {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(projectId, ownerId, id);
      if (!current) throw new DocumentLibraryError("NOT_FOUND");
      if (current.status !== "failed") throw new DocumentLibraryError("CONFLICT");
      this.sqlite.prepare(`DELETE FROM document_library_chunks WHERE file_id=?`).run(id);
      this.sqlite
        .prepare(
          `UPDATE document_library_files SET status='processing',error_code=NULL,
        characters=0,chunks=0,updated_at=? WHERE id=? AND project_id=? AND owner_id=?`
        )
        .run(new Date().toISOString(), id, projectId, ownerId);
      this.sqlite.exec("COMMIT");
      return this.get(projectId, ownerId, id)!;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  cancelIndex(projectId: string, ownerId: string, id: string): boolean {
    return (
      Number(
        this.sqlite
          .prepare(
            `UPDATE document_library_files SET status='failed',error_code='CANCELLED',
      updated_at=? WHERE id=? AND project_id=? AND owner_id=? AND status='processing'`
          )
          .run(new Date().toISOString(), id, projectId, ownerId).changes
      ) === 1
    );
  }

  complete(
    projectId: string,
    ownerId: string,
    id: string,
    pages: LibraryPage[],
    chunks: LibraryChunk[]
  ): LibraryFile {
    if (
      !pages.length ||
      pages.length > LIMITS.pdfPages ||
      pages.some((part) => typeof part.text !== "string") ||
      pages.reduce((sum, page) => sum + page.text.length, 0) > LIMITS.textCharacters
    )
      throw new DocumentLibraryError("INVALID_INDEX");
    if (
      !chunks.length ||
      chunks.length > LIMITS.chunksPerFile ||
      chunks.some(
        (chunk, i) =>
          chunk.ordinal !== i ||
          chunk.content.length > 1_600 ||
          !chunk.content.trim() ||
          chunk.line_start < 1 ||
          chunk.line_end < chunk.line_start ||
          !Number.isInteger(chunk.line_start) ||
          !Number.isInteger(chunk.line_end)
      )
    )
      throw new DocumentLibraryError("INVALID_INDEX");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(projectId, ownerId, id);
      if (!current) throw new DocumentLibraryError("NOT_FOUND");
      if (current.status !== "processing") throw new DocumentLibraryError("CONFLICT");
      if (
        (current.format === "pdf" && pages.some((p) => p.page === null)) ||
        (current.format !== "pdf" && pages.some((p) => p.page !== null)) ||
        (current.format === "pdf" && pages.some((p, i) => p.page !== i + 1))
      )
        throw new DocumentLibraryError("INVALID_INDEX");
      const insert = this.sqlite.prepare(`INSERT INTO document_library_chunks
        (file_id,ordinal,page,line_start,line_end,content) VALUES (?,?,?,?,?,?)`);
      const fts = this.sqlite.prepare(
        "INSERT INTO document_library_fts(rowid, content) VALUES (?,?)"
      );
      for (const chunk of chunks) {
        const row = insert.run(
          id,
          chunk.ordinal,
          chunk.page,
          chunk.line_start,
          chunk.line_end,
          chunk.content
        );
        fts.run(
          Number(row.lastInsertRowid),
          chunk.content.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
        );
      }
      this.sqlite
        .prepare(
          `UPDATE document_library_files SET status='ready', error_code=NULL,
        characters=?, chunks=?, updated_at=? WHERE id=?`
        )
        .run(
          pages.reduce((sum, page) => sum + page.text.length, 0),
          chunks.length,
          new Date().toISOString(),
          id
        );
      this.sqlite.exec("COMMIT");
      return this.get(projectId, ownerId, id)!;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  fail(projectId: string, ownerId: string, id: string): void {
    this.sqlite
      .prepare(
        `UPDATE document_library_files SET status='failed',error_code='EXTRACTION_FAILED',
      updated_at=? WHERE id=? AND project_id=? AND owner_id=? AND status='processing'`
      )
      .run(new Date().toISOString(), id, projectId, ownerId);
  }

  remove(projectId: string, ownerId: string, id: string): boolean {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const file = this.get(projectId, ownerId, id);
      if (!file) {
        this.sqlite.exec("ROLLBACK");
        return false;
      }
      this.sqlite
        .prepare("DELETE FROM document_library_files WHERE id=? AND project_id=? AND owner_id=?")
        .run(id, projectId, ownerId);
      this.sqlite.exec("COMMIT");
      return true;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  original(
    projectId: string,
    ownerId: string,
    id: string
  ): { bytes: Buffer; name: string; media_type: string } | null {
    const row = this.sqlite
      .prepare(
        `SELECT original AS bytes,name,media_type FROM document_library_files
      WHERE id=? AND project_id=? AND owner_id=?`
      )
      .get(id, projectId, ownerId) as
      { bytes: Uint8Array; name: string; media_type: string } | undefined;
    return row ? { ...row, bytes: Buffer.from(row.bytes) } : null;
  }

  chunk(projectId: string, ownerId: string, fileId: string, chunkId: number): LibraryHitRow | null {
    return (
      (this.sqlite
        .prepare(
          `SELECT c.id AS chunk_id,c.file_id,c.ordinal,c.page,c.line_start,c.line_end,c.content,f.name
       FROM document_library_chunks c JOIN document_library_files f ON f.id=c.file_id
       JOIN projects p ON p.id=f.project_id AND p.owner_id=f.owner_id
       WHERE c.id=? AND f.id=? AND f.project_id=? AND f.owner_id=? AND f.status='ready'`
        )
        .get(chunkId, fileId, projectId, ownerId) as LibraryHitRow | undefined) ?? null
    );
  }
  search(
    projectId: string,
    ownerId: string,
    terms: string[],
    fileIds: string[] = []
  ): LibraryHitRow[] {
    if (!this.ownedProject(projectId, ownerId)) throw new DocumentLibraryError("NOT_FOUND");
    if (!terms.length) return [];
    const match = terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" OR ");
    const filesClause = fileIds.length ? ` AND f.id IN (${fileIds.map(() => "?").join(",")})` : "";
    return this.sqlite
      .prepare(
        `SELECT c.id AS chunk_id,c.file_id,c.ordinal,c.page,
      c.line_start,c.line_end,c.content,f.name
      FROM document_library_fts
      JOIN document_library_chunks c ON c.id=document_library_fts.rowid
      JOIN document_library_files f ON f.id=c.file_id
      WHERE document_library_fts MATCH ? AND f.project_id=? AND f.owner_id=? AND f.status='ready'
      ${filesClause} ORDER BY bm25(document_library_fts), c.id LIMIT 1200`
      )
      .all(match, projectId, ownerId, ...fileIds) as LibraryHitRow[];
  }
}
