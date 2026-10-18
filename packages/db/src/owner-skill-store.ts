import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type SkillDraft = { name: string; summary: string; instructions: string };
export type SavedSkill = {
  id: string;
  owner_id: string;
  name: string;
  summary: string;
  current_version: number;
  created_at: string;
  updated_at: string;
};
export type SkillRevision = SkillDraft & { version: number; created_at: string };
export class OwnerSkillError extends Error {
  constructor(
    readonly code:
      | "INVALID_SKILL"
      | "NOT_FOUND"
      | "VERSION_CONFLICT"
      | "LIMIT_REACHED"
      | "OWNER_DATA_FENCED"
      | "REQUEST_CONFLICT"
      | "CREATION_DELETED"
  ) {
    super(code);
  }
}

const clean = (value: unknown, max: number): string => {
  if (typeof value !== "string") throw new OwnerSkillError("INVALID_SKILL");
  const text = value.trim();
  if (
    !text ||
    text.length > max ||
    [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  )
    throw new OwnerSkillError("INVALID_SKILL");
  return text;
};
const validate = (draft: SkillDraft): SkillDraft => ({
  name: clean(draft?.name, 80),
  summary: clean(draft?.summary, 240),
  instructions: clean(draft?.instructions, 20_000)
});

/** Private, inert instruction documents. No execution, permission grant or tool binding. */
export class OwnerSkillStore {
  constructor(
    private readonly sql: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  private fenced(owner: string) {
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner)
    )
      throw new OwnerSkillError("OWNER_DATA_FENCED");
  }
  private transaction<T>(owner: string, action: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.fenced(owner);
      const result = action();
      this.sql.exec("COMMIT");
      return result;
    } catch (cause) {
      this.sql.exec("ROLLBACK");
      throw cause;
    }
  }
  list(owner: string): SavedSkill[] {
    return this.sql
      .prepare(
        "SELECT * FROM owner_skills WHERE owner_id=? ORDER BY updated_at DESC,id DESC LIMIT 50"
      )
      .all(owner) as unknown as SavedSkill[];
  }
  get(owner: string, id: string): { skill: SavedSkill; versions: SkillRevision[] } {
    const skill = this.sql
      .prepare("SELECT * FROM owner_skills WHERE owner_id=? AND id=?")
      .get(owner, id) as SavedSkill | undefined;
    if (!skill) throw new OwnerSkillError("NOT_FOUND");
    const versions = this.sql
      .prepare(
        "SELECT version,name,summary,instructions,created_at FROM owner_skill_versions WHERE owner_id=? AND skill_id=? ORDER BY version DESC"
      )
      .all(owner, id) as unknown as SkillRevision[];
    return { skill, versions };
  }
  private requestId(value: string): void {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))
      throw new OwnerSkillError("INVALID_SKILL");
  }
  /** Null means no accepted write; a tombstone is a terminal result, never permission to recreate. */
  creation(owner: string, requestId: string): SavedSkill | null {
    this.requestId(requestId);
    this.fenced(owner);
    const receipt = this.sql
      .prepare("SELECT skill_id FROM owner_skill_creations WHERE owner_id=? AND request_id=?")
      .get(owner, requestId) as { skill_id: string | null } | undefined;
    if (!receipt) return null;
    if (!receipt.skill_id) throw new OwnerSkillError("CREATION_DELETED");
    return this.get(owner, receipt.skill_id).skill;
  }
  create(owner: string, input: SkillDraft, requestId?: string): SavedSkill {
    const draft = validate(input);
    if (requestId !== undefined) this.requestId(requestId);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([draft.name, draft.summary, draft.instructions]))
      .digest("hex");
    return this.transaction(owner, () => {
      if (requestId !== undefined) {
        const receipt = this.sql
          .prepare(
            "SELECT skill_id,draft_sha256 FROM owner_skill_creations WHERE owner_id=? AND request_id=?"
          )
          .get(owner, requestId) as { skill_id: string | null; draft_sha256: string } | undefined;
        if (receipt) {
          if (receipt.draft_sha256 !== fingerprint) throw new OwnerSkillError("REQUEST_CONFLICT");
          if (!receipt.skill_id) throw new OwnerSkillError("CREATION_DELETED");
          return this.get(owner, receipt.skill_id).skill;
        }
        const count = this.sql
          .prepare("SELECT COUNT(*) n FROM owner_skill_creations WHERE owner_id=?")
          .get(owner) as { n: number };
        if (count.n >= 1000) throw new OwnerSkillError("LIMIT_REACHED");
      }
      if (this.list(owner).length >= 50) throw new OwnerSkillError("LIMIT_REACHED");
      const id = randomUUID(),
        at = this.now();
      this.sql
        .prepare(
          "INSERT INTO owner_skills(id,owner_id,name,summary,current_version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)"
        )
        .run(id, owner, draft.name, draft.summary, at, at);
      this.sql
        .prepare(
          "INSERT INTO owner_skill_versions(skill_id,owner_id,version,name,summary,instructions,created_at) VALUES(?,?,1,?,?,?,?)"
        )
        .run(id, owner, draft.name, draft.summary, draft.instructions, at);
      if (requestId !== undefined)
        this.sql
          .prepare(
            "INSERT INTO owner_skill_creations(owner_id,request_id,draft_sha256,skill_id,created_at) VALUES(?,?,?,?,?)"
          )
          .run(owner, requestId, fingerprint, id, at);
      return this.get(owner, id).skill;
    });
  }
  update(owner: string, id: string, expectedVersion: number, input: SkillDraft): SavedSkill {
    const draft = validate(input);
    return this.transaction(owner, () => this.append(owner, id, expectedVersion, draft));
  }
  restore(owner: string, id: string, expectedVersion: number, sourceVersion: number): SavedSkill {
    return this.transaction(owner, () => {
      const old = this.sql
        .prepare(
          "SELECT name,summary,instructions FROM owner_skill_versions WHERE owner_id=? AND skill_id=? AND version=?"
        )
        .get(owner, id, sourceVersion) as SkillDraft | undefined;
      if (!old) throw new OwnerSkillError("NOT_FOUND");
      return this.append(owner, id, expectedVersion, old);
    });
  }
  private append(
    owner: string,
    id: string,
    expectedVersion: number,
    draft: SkillDraft
  ): SavedSkill {
    const current = this.get(owner, id).skill;
    if (!Number.isSafeInteger(expectedVersion) || current.current_version !== expectedVersion)
      throw new OwnerSkillError("VERSION_CONFLICT");
    if (current.current_version >= 20) throw new OwnerSkillError("LIMIT_REACHED");
    const version = current.current_version + 1,
      at = this.now();
    this.sql
      .prepare(
        "UPDATE owner_skills SET name=?,summary=?,current_version=?,updated_at=? WHERE owner_id=? AND id=? AND current_version=?"
      )
      .run(draft.name, draft.summary, version, at, owner, id, expectedVersion);
    this.sql
      .prepare(
        "INSERT INTO owner_skill_versions(skill_id,owner_id,version,name,summary,instructions,created_at) VALUES(?,?,?,?,?,?,?)"
      )
      .run(id, owner, version, draft.name, draft.summary, draft.instructions, at);
    return this.get(owner, id).skill;
  }
  delete(owner: string, id: string, expectedVersion: number): void {
    this.transaction(owner, () => {
      const current = this.get(owner, id).skill;
      if (current.current_version !== expectedVersion)
        throw new OwnerSkillError("VERSION_CONFLICT");
      this.sql.prepare("DELETE FROM owner_skills WHERE owner_id=? AND id=?").run(owner, id);
    });
  }
}
