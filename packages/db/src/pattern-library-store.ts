import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  AgentFunctionDefinitionSchema,
  BehaviorPatternSchema,
  type AgentFunctionDefinition,
  type BehaviorPattern,
  type BehaviorPatternTestStatus,
  type IdentityContext
} from "@cosmora/contracts";
import { Value } from "typebox/value";

type SqlRow = Record<string, unknown>;
type PatternLibraryIdentity = Pick<IdentityContext, "owner_id" | "actor_id">;

export interface PatternLibraryStoreOptions {
  now?: () => number;
  id?: () => string;
}

export interface CreateAgentFunctionInput {
  project_id: string | null;
  name: string;
  description: string;
  result_contract: string;
}

export interface CreateAgentFunctionVersionInput {
  name: string;
  description: string;
  result_contract: string;
}

export interface CreateBehaviorPatternInput {
  project_id: string | null;
  name: string;
  description: string;
  instructions: string;
  allowed_function_ids: string[];
  known_limitations: string[];
  test_status: BehaviorPatternTestStatus;
}

export interface CreateBehaviorPatternVersionInput {
  name: string;
  description: string;
  instructions: string;
  allowed_function_ids: string[];
  known_limitations: string[];
  test_status: BehaviorPatternTestStatus;
}

export class PatternLibraryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternLibraryValidationError";
  }
}

export class PatternLibraryNotFoundError extends Error {
  constructor(message = "Pattern library object was not found") {
    super(message);
    this.name = "PatternLibraryNotFoundError";
  }
}

export class PatternLibraryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternLibraryConflictError";
  }
}

export class PatternLibraryCorruptDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternLibraryCorruptDataError";
  }
}

const FUNCTION_CREATE_KEYS = new Set(["project_id", "name", "description", "result_contract"]);
const FUNCTION_VERSION_KEYS = new Set(["name", "description", "result_contract"]);
const PATTERN_CREATE_KEYS = new Set([
  "project_id",
  "name",
  "description",
  "instructions",
  "allowed_function_ids",
  "known_limitations",
  "test_status"
]);
const PATTERN_VERSION_KEYS = new Set([
  "name",
  "description",
  "instructions",
  "allowed_function_ids",
  "known_limitations",
  "test_status"
]);

const assertExactKeys = (value: object, allowed: ReadonlySet<string>, label: string): void => {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new PatternLibraryValidationError(
      `${label} contains unsupported fields: ${unexpected.sort().join(", ")}`
    );
  }
};

const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);

const parseStringArray = (value: unknown, field: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("not a string array");
    }
    return parsed.map((item: unknown) => String(item));
  } catch (error) {
    throw new PatternLibraryCorruptDataError(`Stored ${field} is invalid JSON: ${String(error)}`);
  }
};

const asFunction = (row: SqlRow): AgentFunctionDefinition => {
  const value: AgentFunctionDefinition = {
    function_id: String(row.function_id),
    version: Number(row.version),
    scope: row.scope as AgentFunctionDefinition["scope"],
    owner_id: nullableText(row.owner_id),
    project_id: nullableText(row.project_id),
    name: String(row.name),
    description: String(row.description),
    result_contract: String(row.result_contract),
    created_by_actor_id: String(row.created_by_actor_id),
    created_at: String(row.created_at)
  };
  if (!Value.Check(AgentFunctionDefinitionSchema, value)) {
    throw new PatternLibraryCorruptDataError("Stored agent function violates its contract");
  }
  return value;
};

const asPattern = (row: SqlRow): BehaviorPattern => {
  const value: BehaviorPattern = {
    pattern_id: String(row.pattern_id),
    version: Number(row.version),
    scope: row.scope as BehaviorPattern["scope"],
    owner_id: nullableText(row.owner_id),
    project_id: nullableText(row.project_id),
    name: String(row.name),
    description: String(row.description),
    instructions: String(row.instructions),
    allowed_function_ids: parseStringArray(row.allowed_function_ids_json, "allowed_function_ids"),
    known_limitations: parseStringArray(row.known_limitations_json, "known_limitations"),
    test_status: row.test_status as BehaviorPatternTestStatus,
    created_by_actor_id: String(row.created_by_actor_id),
    created_at: String(row.created_at),
    archived_at: nullableText(row.archived_at)
  };
  if (!Value.Check(BehaviorPatternSchema, value)) {
    throw new PatternLibraryCorruptDataError("Stored behavior pattern violates its contract");
  }
  return value;
};

const FUNCTION_COLUMNS = `function_id, version, scope, owner_id, project_id, name, description,
  result_contract, created_by_actor_id, created_at`;
const PATTERN_COLUMNS = `pattern_id, version, scope, owner_id, project_id, name, description,
  instructions, allowed_function_ids_json, known_limitations_json, test_status,
  created_by_actor_id, created_at, archived_at`;

export class PatternLibraryStore {
  readonly #sqlite: DatabaseSync;
  readonly #now: () => number;
  readonly #id: () => string;

  constructor(sqlite: DatabaseSync, options: PatternLibraryStoreOptions = {}) {
    this.#sqlite = sqlite;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
  }

  createFunction(
    identity: PatternLibraryIdentity,
    input: CreateAgentFunctionInput
  ): AgentFunctionDefinition {
    assertExactKeys(input, FUNCTION_CREATE_KEYS, "Agent function");
    this.#assertProjectBinding(identity.owner_id, input.project_id);
    const candidate: AgentFunctionDefinition = {
      function_id: this.#id(),
      version: 1,
      scope: input.project_id === null ? "owner" : "project",
      owner_id: identity.owner_id,
      project_id: input.project_id,
      name: input.name,
      description: input.description,
      result_contract: input.result_contract,
      created_by_actor_id: identity.actor_id,
      created_at: this.#timestamp()
    };
    this.#assertFunction(candidate);
    this.#insertFunction(candidate);
    return candidate;
  }

  createFunctionVersion(
    identity: PatternLibraryIdentity,
    functionId: string,
    input: CreateAgentFunctionVersionInput
  ): AgentFunctionDefinition {
    assertExactKeys(input, FUNCTION_VERSION_KEYS, "Agent function version");
    return this.#transaction(() => {
      const latest = this.#getLatestOwnedFunction(identity.owner_id, functionId);
      if (!latest) throw new PatternLibraryNotFoundError();
      this.#assertProjectBinding(identity.owner_id, latest.project_id);
      const candidate: AgentFunctionDefinition = {
        ...latest,
        ...input,
        version: latest.version + 1,
        created_by_actor_id: identity.actor_id,
        created_at: this.#timestamp()
      };
      this.#assertFunction(candidate);
      this.#insertFunction(candidate);
      return candidate;
    });
  }

  getFunction(
    identity: PatternLibraryIdentity,
    functionId: string,
    version: number,
    projectId: string | null = null
  ): AgentFunctionDefinition | null {
    this.#assertProjectBinding(identity.owner_id, projectId);
    const row = this.#sqlite
      .prepare(
        `SELECT ${FUNCTION_COLUMNS} FROM agent_function_definitions
         WHERE function_id = ? AND version = ? AND ${this.#visibilitySql(projectId)}`
      )
      .get(functionId, version, ...this.#visibilityValues(identity.owner_id, projectId)) as
      SqlRow | undefined;
    return row ? asFunction(row) : null;
  }

  listFunctions(
    identity: PatternLibraryIdentity,
    projectId: string | null = null
  ): AgentFunctionDefinition[] {
    this.#assertProjectBinding(identity.owner_id, projectId);
    return this.#sqlite
      .prepare(
        `WITH visible AS (
           SELECT ${FUNCTION_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY function_id ORDER BY version DESC) AS rank
           FROM agent_function_definitions WHERE ${this.#visibilitySql(projectId)}
         )
         SELECT ${FUNCTION_COLUMNS} FROM visible WHERE rank = 1 ORDER BY name, function_id`
      )
      .all(...this.#visibilityValues(identity.owner_id, projectId))
      .map((row) => asFunction(row));
  }

  createPattern(
    identity: PatternLibraryIdentity,
    input: CreateBehaviorPatternInput
  ): BehaviorPattern {
    assertExactKeys(input, PATTERN_CREATE_KEYS, "Behavior pattern");
    this.#assertProjectBinding(identity.owner_id, input.project_id);
    const candidate: BehaviorPattern = {
      pattern_id: this.#id(),
      version: 1,
      scope: input.project_id === null ? "owner" : "project",
      owner_id: identity.owner_id,
      project_id: input.project_id,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      allowed_function_ids: input.allowed_function_ids,
      known_limitations: input.known_limitations,
      test_status: input.test_status,
      created_by_actor_id: identity.actor_id,
      created_at: this.#timestamp(),
      archived_at: null
    };
    this.#assertPattern(candidate);
    this.#assertAllowedFunctions(identity, candidate.project_id, candidate.allowed_function_ids);
    this.#insertPattern(candidate);
    return candidate;
  }

  createPatternVersion(
    identity: PatternLibraryIdentity,
    patternId: string,
    input: CreateBehaviorPatternVersionInput
  ): BehaviorPattern {
    assertExactKeys(input, PATTERN_VERSION_KEYS, "Behavior pattern version");
    return this.#transaction(() => {
      const latest = this.#getLatestOwnedPattern(identity.owner_id, patternId);
      if (!latest) throw new PatternLibraryNotFoundError();
      if (latest.archived_at !== null) {
        throw new PatternLibraryConflictError("Archived patterns cannot be revised");
      }
      this.#assertProjectBinding(identity.owner_id, latest.project_id);
      const candidate: BehaviorPattern = {
        ...latest,
        ...input,
        version: latest.version + 1,
        created_by_actor_id: identity.actor_id,
        created_at: this.#timestamp()
      };
      this.#assertPattern(candidate);
      this.#assertAllowedFunctions(identity, candidate.project_id, candidate.allowed_function_ids);
      this.#insertPattern(candidate);
      return candidate;
    });
  }

  archivePattern(identity: PatternLibraryIdentity, patternId: string): BehaviorPattern {
    return this.#transaction(() => {
      const latest = this.#getLatestOwnedPattern(identity.owner_id, patternId);
      if (!latest) throw new PatternLibraryNotFoundError();
      if (latest.archived_at !== null) return latest;
      this.#assertProjectBinding(identity.owner_id, latest.project_id);
      const timestamp = this.#timestamp();
      const archived: BehaviorPattern = {
        ...latest,
        version: latest.version + 1,
        created_by_actor_id: identity.actor_id,
        created_at: timestamp,
        archived_at: timestamp
      };
      this.#assertPattern(archived);
      this.#insertPattern(archived);
      return archived;
    });
  }

  getPattern(
    identity: PatternLibraryIdentity,
    patternId: string,
    version: number,
    projectId: string | null = null
  ): BehaviorPattern | null {
    this.#assertProjectBinding(identity.owner_id, projectId);
    const row = this.#sqlite
      .prepare(
        `SELECT ${PATTERN_COLUMNS} FROM behavior_patterns
         WHERE pattern_id = ? AND version = ? AND ${this.#visibilitySql(projectId)}`
      )
      .get(patternId, version, ...this.#visibilityValues(identity.owner_id, projectId)) as
      SqlRow | undefined;
    return row ? asPattern(row) : null;
  }

  listPatterns(
    identity: PatternLibraryIdentity,
    projectId: string | null = null,
    includeArchived = false
  ): BehaviorPattern[] {
    this.#assertProjectBinding(identity.owner_id, projectId);
    const rows = this.#sqlite
      .prepare(
        `WITH visible AS (
           SELECT ${PATTERN_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY pattern_id ORDER BY version DESC) AS rank
           FROM behavior_patterns WHERE ${this.#visibilitySql(projectId)}
         )
         SELECT ${PATTERN_COLUMNS} FROM visible WHERE rank = 1 ORDER BY name, pattern_id`
      )
      .all(...this.#visibilityValues(identity.owner_id, projectId))
      .map((row) => asPattern(row));
    return includeArchived ? rows : rows.filter((pattern) => pattern.archived_at === null);
  }

  #getLatestOwnedFunction(ownerId: string, functionId: string): AgentFunctionDefinition | null {
    const row = this.#sqlite
      .prepare(
        `SELECT ${FUNCTION_COLUMNS} FROM agent_function_definitions
         WHERE function_id = ? AND owner_id = ? AND scope IN ('owner', 'project')
         ORDER BY version DESC LIMIT 1`
      )
      .get(functionId, ownerId) as SqlRow | undefined;
    return row ? asFunction(row) : null;
  }

  #getLatestOwnedPattern(ownerId: string, patternId: string): BehaviorPattern | null {
    const row = this.#sqlite
      .prepare(
        `SELECT ${PATTERN_COLUMNS} FROM behavior_patterns
         WHERE pattern_id = ? AND owner_id = ? AND scope IN ('owner', 'project')
         ORDER BY version DESC LIMIT 1`
      )
      .get(patternId, ownerId) as SqlRow | undefined;
    return row ? asPattern(row) : null;
  }

  #assertProjectBinding(ownerId: string, projectId: string | null): void {
    if (projectId === null) return;
    const row = this.#sqlite
      .prepare("SELECT 1 AS ok FROM projects WHERE id = ? AND owner_id = ?")
      .get(projectId, ownerId);
    if (!row) throw new PatternLibraryNotFoundError();
  }

  #assertAllowedFunctions(
    identity: PatternLibraryIdentity,
    projectId: string | null,
    functionIds: string[]
  ): void {
    for (const functionId of functionIds) {
      const row = this.#sqlite
        .prepare(
          `SELECT 1 AS ok FROM agent_function_definitions
           WHERE function_id = ? AND ${this.#visibilitySql(projectId)}
           ORDER BY version DESC LIMIT 1`
        )
        .get(functionId, ...this.#visibilityValues(identity.owner_id, projectId));
      if (!row) {
        throw new PatternLibraryValidationError(
          `Allowed function ${functionId} is not visible in the pattern scope`
        );
      }
    }
  }

  #visibilitySql(projectId: string | null): string {
    return projectId === null
      ? "(scope = 'product' OR (scope = 'owner' AND owner_id = ?))"
      : "(scope = 'product' OR (scope = 'owner' AND owner_id = ?) OR (scope = 'project' AND owner_id = ? AND project_id = ?))";
  }

  #visibilityValues(ownerId: string, projectId: string | null): string[] {
    return projectId === null ? [ownerId] : [ownerId, ownerId, projectId];
  }

  #assertFunction(value: AgentFunctionDefinition): void {
    if (!Value.Check(AgentFunctionDefinitionSchema, value)) {
      throw new PatternLibraryValidationError("Agent function violates its contract");
    }
  }

  #assertPattern(value: BehaviorPattern): void {
    if (!Value.Check(BehaviorPatternSchema, value)) {
      throw new PatternLibraryValidationError("Behavior pattern violates its contract");
    }
  }

  #insertFunction(value: AgentFunctionDefinition): void {
    this.#sqlite
      .prepare(
        `INSERT INTO agent_function_definitions
          (function_id, version, scope, owner_id, project_id, name, description, result_contract,
           created_by_actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        value.function_id,
        value.version,
        value.scope,
        value.owner_id,
        value.project_id,
        value.name,
        value.description,
        value.result_contract,
        value.created_by_actor_id,
        value.created_at
      );
  }

  #insertPattern(value: BehaviorPattern): void {
    this.#sqlite
      .prepare(
        `INSERT INTO behavior_patterns
          (pattern_id, version, scope, owner_id, project_id, name, description, instructions,
           allowed_function_ids_json, known_limitations_json, test_status, created_by_actor_id,
           created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        value.pattern_id,
        value.version,
        value.scope,
        value.owner_id,
        value.project_id,
        value.name,
        value.description,
        value.instructions,
        JSON.stringify(value.allowed_function_ids),
        JSON.stringify(value.known_limitations),
        value.test_status,
        value.created_by_actor_id,
        value.created_at,
        value.archived_at
      );
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new PatternLibraryValidationError("Invalid store clock");
    return new Date(now).toISOString();
  }

  #transaction<T>(work: () => T): T {
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.#sqlite.exec("COMMIT;");
      return result;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }
}
