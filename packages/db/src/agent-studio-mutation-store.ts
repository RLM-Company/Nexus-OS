import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { IdentityContext, VersionedAgentReference } from "@cosmora/contracts";

type MutationIdentity = Pick<IdentityContext, "owner_id" | "actor_id">;
type SqlRow = Record<string, unknown>;

export type AgentStudioCreateOperation = "function.create" | "pattern.create" | "blueprint.create";

export interface AgentStudioMutationStoreOptions {
  now?: () => number;
  id?: () => string;
}

export interface AgentStudioCreateMutation<T> {
  project_id: string;
  idempotency_key: string;
  operation: AgentStudioCreateOperation;
  request: unknown;
  execute: () => T;
  reference_of: (value: T) => VersionedAgentReference;
  resolve: (reference: VersionedAgentReference) => T | null;
}

export interface AgentStudioMutationResult<T> {
  value: T;
  replayed: boolean;
}

export class AgentStudioIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key is already bound to another Agent Studio create request");
    this.name = "AgentStudioIdempotencyConflictError";
  }
}

export class AgentStudioMutationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStudioMutationValidationError";
  }
}

export class AgentStudioMutationCorruptDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStudioMutationCorruptDataError";
  }
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new AgentStudioMutationValidationError("Create request is not canonical JSON");
};

const requestHash = (operation: AgentStudioCreateOperation, request: unknown): string =>
  createHash("sha256")
    .update(`${operation}\n${canonicalJson(request)}`, "utf8")
    .digest("hex");

export class AgentStudioMutationStore {
  readonly #sqlite: DatabaseSync;
  readonly #now: () => number;
  readonly #id: () => string;

  constructor(sqlite: DatabaseSync, options: AgentStudioMutationStoreOptions = {}) {
    this.#sqlite = sqlite;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
  }

  create<T>(
    identity: MutationIdentity,
    mutation: AgentStudioCreateMutation<T>
  ): AgentStudioMutationResult<T> {
    if (
      mutation.idempotency_key.length < 1 ||
      mutation.idempotency_key.length > 256 ||
      mutation.idempotency_key.trim() !== mutation.idempotency_key
    ) {
      throw new AgentStudioMutationValidationError("Invalid Agent Studio idempotency key");
    }
    const hash = requestHash(mutation.operation, mutation.request);
    return this.#transaction(() => {
      const existing = this.#sqlite
        .prepare(
          `SELECT operation_type, request_hash, result_id, result_version
           FROM agent_studio_mutations
           WHERE owner_id = ? AND project_id = ? AND idempotency_key = ?`
        )
        .get(identity.owner_id, mutation.project_id, mutation.idempotency_key) as
        SqlRow | undefined;
      if (existing) {
        if (existing.operation_type !== mutation.operation || existing.request_hash !== hash) {
          throw new AgentStudioIdempotencyConflictError();
        }
        const value = mutation.resolve({
          id: String(existing.result_id),
          version: Number(existing.result_version)
        });
        if (!value) {
          throw new AgentStudioMutationCorruptDataError(
            "Idempotent Agent Studio result reference is missing"
          );
        }
        return { value, replayed: true };
      }

      const value = mutation.execute();
      const reference = mutation.reference_of(value);
      if (!reference.id || !Number.isInteger(reference.version) || reference.version < 1) {
        throw new AgentStudioMutationValidationError("Create result reference is invalid");
      }
      this.#sqlite
        .prepare(
          `INSERT INTO agent_studio_mutations
            (mutation_id, owner_id, project_id, actor_id, idempotency_key, operation_type,
             request_hash, result_id, result_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this.#id(),
          identity.owner_id,
          mutation.project_id,
          identity.actor_id,
          mutation.idempotency_key,
          mutation.operation,
          hash,
          reference.id,
          reference.version,
          this.#timestamp()
        );
      return { value, replayed: false };
    });
  }

  #transaction<T>(callback: () => T): T {
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = callback();
      this.#sqlite.exec("COMMIT;");
      return result;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now)) {
      throw new AgentStudioMutationValidationError("Invalid Agent Studio mutation clock");
    }
    return new Date(now).toISOString();
  }
}
