import { randomUUID } from "node:crypto";
import type {
  PresentationWorkReference,
  PresentationWorkSource
} from "@cosmora/contracts/presentation-package";
import type { DatabaseSync } from "node:sqlite";

export type SlideLayout = "title" | "content" | "two-column" | "quote";
export type PresentationTheme = "paper" | "night" | "ocean";
export type PresentationSlide = {
  id: string;
  layout: SlideLayout;
  title: string;
  body: string;
  aside: string;
  notes: string;
};
export type PresentationSummary = {
  id: string;
  title: string;
  theme: PresentationTheme;
  version: number;
  slide_count: number;
  created_at: string;
  updated_at: string;
};
export type Presentation = PresentationSummary & {
  slides: PresentationSlide[];
  work_source: PresentationWorkSource | null;
};
export type PresentationContent = Pick<Presentation, "title" | "theme" | "slides">;
export type PresentationRevisionSummary = {
  version: number;
  title: string;
  theme: PresentationTheme;
  slide_count: number;
  source: "create" | "save" | "import" | "restore" | "migration";
  source_version: number | null;
  created_at: string;
};
export type PresentationRevision = PresentationRevisionSummary & { slides: PresentationSlide[] };
type RevisionRow = Omit<PresentationRevision, "slides" | "slide_count"> & { slides_json: string };
type Row = Omit<PresentationSummary, "slide_count"> & { slides_json: string };
export const PRESENTATION_VERSION_LIMIT = 20;

export class PresentationError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_DECK"
      | "LIMIT_EXCEEDED"
      | "CONFLICT"
      | "OWNER_DATA_FENCED"
      | "IMPORT_DELETED"
  ) {
    super(code);
  }
}

const validateTitle = (value: unknown): value is string =>
  text(value, 160) && value.trim().length > 0 && value.length <= 160;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  !Array.from(value).some((c) => {
    const n = c.charCodeAt(0);
    return (
      (n < 32 && n !== 9 && n !== 10 && n !== 13) ||
      n === 0xfffe ||
      n === 0xffff ||
      (n >= 0xd800 && n <= 0xdfff && c.length === 1)
    );
  });
export function validatePresentation(input: unknown): asserts input is {
  title: string;
  theme: PresentationTheme;
  slides: PresentationSlide[];
} {
  if (!input || typeof input !== "object") throw new PresentationError("INVALID_DECK");
  const value = input as Record<string, unknown>;
  if (
    !validateTitle(value.title) ||
    typeof value.theme !== "string" ||
    !["paper", "night", "ocean"].includes(value.theme) ||
    !Array.isArray(value.slides) ||
    value.slides.length < 1 ||
    value.slides.length > 50
  )
    throw new PresentationError("INVALID_DECK");
  const ids = new Set<string>();
  for (const raw of value.slides) {
    if (!raw || typeof raw !== "object") throw new PresentationError("INVALID_DECK");
    const slide = raw as Record<string, unknown>;
    if (
      typeof slide.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/u.test(slide.id) ||
      ids.has(slide.id) ||
      typeof slide.layout !== "string" ||
      !["title", "content", "two-column", "quote"].includes(slide.layout) ||
      !text(slide.title, 180) ||
      !text(slide.body, 4000) ||
      !text(slide.aside, 4000) ||
      !text(slide.notes, 4000)
    )
      throw new PresentationError("INVALID_DECK");
    ids.add(slide.id);
  }
  if (Buffer.byteLength(JSON.stringify(value.slides), "utf8") > 300_000)
    throw new PresentationError("LIMIT_EXCEEDED");
}

export class PresentationStore {
  constructor(
    private readonly sql: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  private writable(owner: string): void {
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner)
    )
      throw new PresentationError("OWNER_DATA_FENCED");
  }

  private view(row: Row): Presentation {
    const slides = JSON.parse(row.slides_json) as PresentationSlide[];
    return {
      id: row.id,
      title: row.title,
      theme: row.theme,
      version: row.version,
      slide_count: slides.length,
      slides,
      work_source: this.workSource(row.id),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  list(owner: string): PresentationSummary[] {
    const rows = this.sql
      .prepare(
        "SELECT id,title,theme,version,slides_json,created_at,updated_at FROM presentations WHERE owner_id=? ORDER BY updated_at DESC LIMIT 40"
      )
      .all(owner) as unknown as Row[];
    return rows.map(({ slides_json, ...row }) => ({
      ...row,
      slide_count: (JSON.parse(slides_json) as unknown[]).length
    }));
  }

  get(owner: string, id: string): Presentation {
    const row = this.sql
      .prepare(
        "SELECT id,title,theme,version,slides_json,created_at,updated_at FROM presentations WHERE owner_id=? AND id=?"
      )
      .get(owner, id) as Row | undefined;
    if (!row) throw new PresentationError("NOT_FOUND");
    return this.view(row);
  }

  create(owner: string, title: string): Presentation {
    if (!validateTitle(title)) throw new PresentationError("INVALID_DECK");
    return this.createContent(
      owner,
      {
        title: title.trim(),
        theme: "paper",
        slides: [
          { id: randomUUID(), layout: "title", title: title.trim(), body: "", aside: "", notes: "" }
        ]
      },
      "create"
    );
  }

  import(owner: string, input: unknown): Presentation {
    validatePresentation(input);
    return this.createContent(
      owner,
      {
        title: input.title.trim(),
        theme: input.theme,
        slides: input.slides.map((slide) => ({
          id: randomUUID(),
          layout: slide.layout,
          title: slide.title,
          body: slide.body,
          aside: slide.aside,
          notes: slide.notes
        }))
      },
      "import"
    );
  }

  private workSource(id: string): PresentationWorkSource | null {
    const row = this.sql
      .prepare("SELECT source_json FROM presentation_work_imports WHERE presentation_id=?")
      .get(id) as { source_json: string } | undefined;
    return row ? (JSON.parse(row.source_json) as PresentationWorkSource) : null;
  }

  importedWork(owner: string, source: PresentationWorkReference): Presentation | null {
    const key = JSON.stringify([
      source.project_id,
      source.work_id,
      source.artifact_id,
      source.version,
      source.sha256
    ]);
    const row = this.sql
      .prepare(
        "SELECT presentation_id FROM presentation_work_imports WHERE owner_id=? AND source_key=?"
      )
      .get(owner, key) as { presentation_id: string | null } | undefined;
    if (!row) return null;
    if (!row.presentation_id) throw new PresentationError("IMPORT_DELETED");
    return this.get(owner, row.presentation_id);
  }

  /** One immutable artifact imports once. A lost response never creates another deck. */
  importWork(owner: string, input: unknown, source: PresentationWorkSource): Presentation {
    validatePresentation(input);
    const key = JSON.stringify([
      source.project_id,
      source.work_id,
      source.artifact_id,
      source.version,
      source.sha256
    ]);
    return this.createContent(
      owner,
      {
        title: input.title.trim(),
        theme: input.theme,
        slides: input.slides.map((slide) => ({ ...slide, id: randomUUID() }))
      },
      "import",
      { key, source }
    );
  }

  private checkpoint(
    owner: string,
    id: string,
    version: number,
    content: PresentationContent,
    source: PresentationRevisionSummary["source"],
    sourceVersion: number | null,
    at: string
  ): void {
    this.sql
      .prepare(
        "INSERT INTO presentation_versions(presentation_id,owner_id,version,title,theme,slides_json,source,source_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
      )
      .run(
        id,
        owner,
        version,
        content.title.trim(),
        content.theme,
        JSON.stringify(content.slides),
        source,
        sourceVersion,
        at
      );
    this.sql
      .prepare(
        "DELETE FROM presentation_versions WHERE owner_id=? AND presentation_id=? AND version NOT IN (SELECT version FROM presentation_versions WHERE owner_id=? AND presentation_id=? ORDER BY version DESC LIMIT ?)"
      )
      .run(owner, id, owner, id, PRESENTATION_VERSION_LIMIT);
  }

  private createContent(
    owner: string,
    input: PresentationContent,
    source: "create" | "import",
    workImport?: { key: string; source: PresentationWorkSource }
  ): Presentation {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.writable(owner);
      if (workImport) {
        const prior = this.sql
          .prepare(
            "SELECT presentation_id FROM presentation_work_imports WHERE owner_id=? AND source_key=?"
          )
          .get(owner, workImport.key) as { presentation_id: string | null } | undefined;
        if (prior) {
          if (!prior.presentation_id) throw new PresentationError("IMPORT_DELETED");
          const existing = this.get(owner, prior.presentation_id);
          this.sql.exec("COMMIT");
          return existing;
        }
        const receipts = this.sql
          .prepare("SELECT COUNT(*) n FROM presentation_work_imports WHERE owner_id=?")
          .get(owner)!;
        if (Number(receipts.n) >= 1000) throw new PresentationError("LIMIT_EXCEEDED");
      }
      const count = this.sql
        .prepare("SELECT COUNT(*) AS n FROM presentations WHERE owner_id=?")
        .get(owner)!;
      if (Number(count.n) >= 40) throw new PresentationError("LIMIT_EXCEEDED");
      const at = this.now();
      const id = randomUUID();
      this.sql
        .prepare(
          "INSERT INTO presentations(id,owner_id,title,theme,slides_json,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)"
        )
        .run(id, owner, input.title.trim(), input.theme, JSON.stringify(input.slides), at, at);
      this.checkpoint(owner, id, 1, input, source, null, at);
      if (workImport)
        this.sql
          .prepare(
            "INSERT INTO presentation_work_imports(owner_id,source_key,presentation_id,source_json,created_at) VALUES(?,?,?,?,?)"
          )
          .run(owner, workImport.key, id, JSON.stringify(workImport.source), at);
      this.sql.exec("COMMIT");
      return this.get(owner, id);
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }

  save(owner: string, id: string, expectedVersion: number, input: unknown): Presentation {
    validatePresentation(input);
    return this.update(owner, id, expectedVersion, input, null);
  }

  versions(owner: string, id: string): PresentationRevisionSummary[] {
    this.get(owner, id);
    const rows = this.sql
      .prepare(
        "SELECT version,title,theme,slides_json,source,source_version,created_at FROM presentation_versions WHERE owner_id=? AND presentation_id=? ORDER BY version DESC LIMIT ?"
      )
      .all(owner, id, PRESENTATION_VERSION_LIMIT) as unknown as RevisionRow[];
    return rows.map(({ slides_json, ...row }) => ({
      ...row,
      slide_count: (JSON.parse(slides_json) as unknown[]).length
    }));
  }

  revision(owner: string, id: string, version: number): PresentationRevision {
    if (!Number.isSafeInteger(version) || version < 1) throw new PresentationError("INVALID_DECK");
    const row = this.sql
      .prepare(
        "SELECT version,title,theme,slides_json,source,source_version,created_at FROM presentation_versions WHERE owner_id=? AND presentation_id=? AND version=?"
      )
      .get(owner, id, version) as RevisionRow | undefined;
    if (!row) throw new PresentationError("NOT_FOUND");
    const { slides_json, ...summary } = row;
    const slides = JSON.parse(slides_json) as PresentationSlide[];
    return { ...summary, slides, slide_count: slides.length };
  }

  restore(owner: string, id: string, expectedVersion: number, sourceVersion: number): Presentation {
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1)
      throw new PresentationError("INVALID_DECK");
    return this.update(owner, id, expectedVersion, null, sourceVersion);
  }

  private update(
    owner: string,
    id: string,
    expectedVersion: number,
    input: PresentationContent | null,
    sourceVersion: number | null
  ): Presentation {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new PresentationError("INVALID_DECK");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.writable(owner);
      const current = this.sql
        .prepare("SELECT version FROM presentations WHERE owner_id=? AND id=?")
        .get(owner, id) as { version: number } | undefined;
      if (!current) throw new PresentationError("NOT_FOUND");
      if (current.version !== expectedVersion) throw new PresentationError("CONFLICT");
      const content = sourceVersion === null ? input! : this.revision(owner, id, sourceVersion);
      const at = this.now();
      this.sql
        .prepare(
          "UPDATE presentations SET title=?,theme=?,slides_json=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?"
        )
        .run(
          content.title.trim(),
          content.theme,
          JSON.stringify(content.slides),
          at,
          owner,
          id,
          expectedVersion
        );
      this.checkpoint(
        owner,
        id,
        expectedVersion + 1,
        content,
        sourceVersion === null ? "save" : "restore",
        sourceVersion,
        at
      );
      this.sql.exec("COMMIT");
      return this.get(owner, id);
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }

  delete(owner: string, id: string, expectedVersion: number): void {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new PresentationError("INVALID_DECK");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.writable(owner);
      const row = this.sql
        .prepare("SELECT version FROM presentations WHERE owner_id=? AND id=?")
        .get(owner, id) as { version: number } | undefined;
      if (!row) throw new PresentationError("NOT_FOUND");
      if (row.version !== expectedVersion) throw new PresentationError("CONFLICT");
      this.sql.prepare("DELETE FROM presentations WHERE owner_id=? AND id=?").run(owner, id);
      this.sql.exec("COMMIT");
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }
}
