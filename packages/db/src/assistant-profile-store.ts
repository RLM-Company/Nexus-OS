import type { DatabaseSync } from "node:sqlite";
import type { AssistantProfile, AssistantProfileSnapshot } from "@cosmora/contracts";
import { LOCAL_OWNER_ID } from "./project-store.js";

export class AssistantProfileConflictError extends Error {
  constructor() {
    super("Assistant profile version or idempotent payload changed");
    this.name = "AssistantProfileConflictError";
  }
}

export class AssistantProfileValidationError extends Error {
  constructor() {
    super("Assistant profile name and instructions must contain bounded non-whitespace text");
    this.name = "AssistantProfileValidationError";
  }
}

type ProfileRow = {
  id: unknown;
  name: unknown;
  instructions: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const asProfile = (row: ProfileRow): AssistantProfile => {
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.instructions !== "string" ||
    typeof row.version !== "number" ||
    !Number.isInteger(row.version) ||
    row.version < 1 ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new Error("Invalid assistant profile row");
  }
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

const columns = "id, name, instructions, version, created_at, updated_at";
const normalizedSnapshot = (input: AssistantProfileSnapshot): AssistantProfileSnapshot => {
  const name = input.name.trim();
  const instructions = input.instructions.trim();
  if (!name || !instructions || name.length > 80 || instructions.length > 4_000) {
    throw new AssistantProfileValidationError();
  }
  return { name, instructions };
};

export class AssistantProfileStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
  }

  list(ownerId = LOCAL_OWNER_ID): AssistantProfile[] {
    return (
      this.#sqlite
        .prepare(
          `SELECT ${columns} FROM assistant_profiles
         WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 50`
        )
        .all(ownerId) as unknown as ProfileRow[]
    ).map(asProfile);
  }

  get(profileId: string, ownerId = LOCAL_OWNER_ID): AssistantProfile | null {
    const row = this.#sqlite
      .prepare(`SELECT ${columns} FROM assistant_profiles WHERE id = ? AND owner_id = ?`)
      .get(profileId, ownerId) as unknown as ProfileRow | undefined;
    return row ? asProfile(row) : null;
  }

  create(
    profileId: string,
    input: AssistantProfileSnapshot,
    ownerId = LOCAL_OWNER_ID,
    timestamp = new Date().toISOString()
  ): { profile: AssistantProfile; duplicate: boolean } {
    const { name, instructions } = normalizedSnapshot(input);
    const existing = this.get(profileId, ownerId);
    if (existing) {
      if (existing.name !== name || existing.instructions !== instructions) {
        throw new AssistantProfileConflictError();
      }
      return { profile: existing, duplicate: true };
    }
    if (this.list(ownerId).length >= 50) {
      throw new AssistantProfileConflictError();
    }
    this.#sqlite
      .prepare(
        `INSERT INTO assistant_profiles
          (id, owner_id, name, instructions, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(profileId, ownerId, name, instructions, timestamp, timestamp);
    const profile = this.get(profileId, ownerId);
    if (!profile) throw new Error("Assistant profile was not persisted");
    return { profile, duplicate: false };
  }

  update(
    profileId: string,
    input: AssistantProfileSnapshot & { expected_version: number },
    ownerId = LOCAL_OWNER_ID,
    timestamp = new Date().toISOString()
  ): AssistantProfile | null {
    if (!this.get(profileId, ownerId)) return null;
    const normalized = normalizedSnapshot(input);
    const result = this.#sqlite
      .prepare(
        `UPDATE assistant_profiles
         SET name = ?, instructions = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND owner_id = ? AND version = ?`
      )
      .run(
        normalized.name,
        normalized.instructions,
        timestamp,
        profileId,
        ownerId,
        input.expected_version
      );
    if (Number(result.changes) !== 1) throw new AssistantProfileConflictError();
    return this.get(profileId, ownerId);
  }

  delete(profileId: string, expectedVersion: number, ownerId = LOCAL_OWNER_ID): boolean | null {
    if (!this.get(profileId, ownerId)) return null;
    const result = this.#sqlite
      .prepare("DELETE FROM assistant_profiles WHERE id = ? AND owner_id = ? AND version = ?")
      .run(profileId, ownerId, expectedVersion);
    if (Number(result.changes) !== 1) throw new AssistantProfileConflictError();
    return true;
  }
}
