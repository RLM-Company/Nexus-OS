import { randomUUID } from "node:crypto";
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
export type Presentation = PresentationSummary & { slides: PresentationSlide[] };
type Row = Omit<PresentationSummary, "slide_count"> & { slides_json: string };

export class PresentationError extends Error {
  constructor(
    readonly code:
      "NOT_FOUND" | "INVALID_DECK" | "LIMIT_EXCEEDED" | "CONFLICT" | "OWNER_DATA_FENCED"
  ) {
    super(code);
  }
}

const validateTitle = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max && !value.includes("\u0000");
export function validatePresentation(input: unknown): asserts input is {
  title: string;
  theme: PresentationTheme;
  slides: PresentationSlide[];
} {
  if (!input || typeof input !== "object") throw new PresentationError("INVALID_DECK");
  const value = input as Record<string, unknown>;
  if (
    !validateTitle(value.title) ||
    !["paper", "night", "ocean"].includes(String(value.theme)) ||
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
      !["title", "content", "two-column", "quote"].includes(String(slide.layout)) ||
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
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.writable(owner);
      const count = this.sql
        .prepare("SELECT COUNT(*) AS n FROM presentations WHERE owner_id=?")
        .get(owner)!;
      if (Number(count.n) >= 40) throw new PresentationError("LIMIT_EXCEEDED");
      const at = this.now();
      const id = randomUUID();
      const slides: PresentationSlide[] = [
        { id: randomUUID(), layout: "title", title: title.trim(), body: "", aside: "", notes: "" }
      ];
      this.sql
        .prepare(
          "INSERT INTO presentations(id,owner_id,title,theme,slides_json,version,created_at,updated_at) VALUES(?,?,?,'paper',?,1,?,?)"
        )
        .run(id, owner, title.trim(), JSON.stringify(slides), at, at);
      this.sql.exec("COMMIT");
      return {
        id,
        title: title.trim(),
        theme: "paper",
        version: 1,
        slide_count: 1,
        slides,
        created_at: at,
        updated_at: at
      };
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }

  save(owner: string, id: string, expectedVersion: number, input: unknown): Presentation {
    validatePresentation(input);
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
      const at = this.now();
      this.sql
        .prepare(
          "UPDATE presentations SET title=?,theme=?,slides_json=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?"
        )
        .run(
          input.title.trim(),
          input.theme,
          JSON.stringify(input.slides),
          at,
          owner,
          id,
          expectedVersion
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
