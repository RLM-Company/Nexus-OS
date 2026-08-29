import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  AgentBlueprintSchema,
  type AgentBlueprint,
  type AgentGrant,
  type AgentMemoryScope,
  type IdentityContext,
  type VersionedAgentReference
} from "@cosmora/contracts";
import { Value } from "typebox/value";
import { PatternLibraryStore } from "./pattern-library-store.js";

type SqlRow = Record<string, unknown>;
type BlueprintIdentity = Pick<IdentityContext, "owner_id" | "actor_id">;

export interface AgentBlueprintStoreOptions {
  now?: () => number;
  id?: () => string;
}

export interface CreateAgentBlueprintInput {
  project_id: string;
  function_ref: VersionedAgentReference;
  behavior_pattern_ref: VersionedAgentReference;
  model_profile_ref: VersionedAgentReference;
  grant: AgentGrant;
  memory_scope: AgentMemoryScope;
  task_contract: string;
  start_condition: string;
  close_conditions: string[];
}

export type CreateAgentBlueprintVersionInput = Omit<CreateAgentBlueprintInput, "project_id">;

export class AgentBlueprintValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentBlueprintValidationError";
  }
}

export class AgentBlueprintNotFoundError extends Error {
  constructor() {
    super("Agent blueprint was not found");
    this.name = "AgentBlueprintNotFoundError";
  }
}

export class AgentBlueprintConflictError extends Error {
  constructor() {
    super("Agent blueprint version changed");
    this.name = "AgentBlueprintConflictError";
  }
}

const CREATE_KEYS = new Set([
  "project_id",
  "function_ref",
  "behavior_pattern_ref",
  "model_profile_ref",
  "grant",
  "memory_scope",
  "task_contract",
  "start_condition",
  "close_conditions"
]);
const VERSION_KEYS = new Set([...CREATE_KEYS].filter((key) => key !== "project_id"));

const assertExactKeys = (value: object, allowed: ReadonlySet<string>): void => {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new AgentBlueprintValidationError(
      `Agent blueprint contains unsupported fields: ${unexpected.sort().join(", ")}`
    );
  }
};

const parseJson = (value: unknown, field: string): unknown => {
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    throw new AgentBlueprintValidationError(`Stored agent blueprint ${field} is corrupt`);
  }
};

const asBlueprint = (row: SqlRow): AgentBlueprint => {
  const value = {
    blueprint_id: String(row.blueprint_id),
    version: Number(row.version),
    owner_id: String(row.owner_id),
    project_id: String(row.project_id),
    function_ref: {
      id: String(row.function_id),
      version: Number(row.function_version)
    },
    behavior_pattern_ref: {
      id: String(row.pattern_id),
      version: Number(row.pattern_version)
    },
    model_profile_ref: {
      id: String(row.model_profile_id),
      version: Number(row.model_profile_version)
    },
    grant: parseJson(row.grant_json, "grant"),
    memory_scope: parseJson(row.memory_scope_json, "memory_scope"),
    task_contract: String(row.task_contract),
    start_condition: String(row.start_condition),
    close_conditions: parseJson(row.close_conditions_json, "close_conditions"),
    created_by_actor_id: String(row.created_by_actor_id),
    created_at: String(row.created_at)
  };
  if (!Value.Check(AgentBlueprintSchema, value)) {
    throw new AgentBlueprintValidationError("Stored agent blueprint violates its contract");
  }
  return value;
};

const BLUEPRINT_COLUMNS = `blueprint_id, version, owner_id, project_id, function_id,
  function_version, pattern_id, pattern_version, model_profile_id, model_profile_version,
  grant_json, memory_scope_json, task_contract, start_condition, close_conditions_json,
  created_by_actor_id, created_at`;

export class AgentBlueprintStore {
  readonly #sqlite: DatabaseSync;
  readonly #patterns: PatternLibraryStore;
  readonly #now: () => number;
  readonly #id: () => string;

  constructor(sqlite: DatabaseSync, options: AgentBlueprintStoreOptions = {}) {
    this.#sqlite = sqlite;
    this.#patterns = new PatternLibraryStore(sqlite, options.now ? { now: options.now } : {});
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
  }

  createBlueprint(identity: BlueprintIdentity, input: CreateAgentBlueprintInput): AgentBlueprint {
    assertExactKeys(input, CREATE_KEYS);
    const timestamp = this.#timestamp();
    const detached = structuredClone(input);
    const candidate: AgentBlueprint = {
      blueprint_id: this.#id(),
      version: 1,
      owner_id: identity.owner_id,
      ...detached,
      created_by_actor_id: identity.actor_id,
      created_at: timestamp
    };
    this.#validateComposition(identity, candidate, timestamp);
    this.#insert(candidate);
    return candidate;
  }

  createBlueprintVersion(
    identity: BlueprintIdentity,
    blueprintId: string,
    input: CreateAgentBlueprintVersionInput,
    expectedVersion?: number
  ): AgentBlueprint {
    assertExactKeys(input, VERSION_KEYS);
    return this.#transaction(() => {
      const latest = this.#getLatestOwned(identity.owner_id, blueprintId);
      if (!latest) throw new AgentBlueprintNotFoundError();
      if (expectedVersion !== undefined && latest.version !== expectedVersion) {
        throw new AgentBlueprintConflictError();
      }
      const timestamp = this.#timestamp();
      const detached = structuredClone(input);
      const candidate: AgentBlueprint = {
        ...latest,
        ...detached,
        version: latest.version + 1,
        created_by_actor_id: identity.actor_id,
        created_at: timestamp
      };
      this.#validateComposition(identity, candidate, timestamp);
      this.#insert(candidate);
      return candidate;
    });
  }

  getBlueprint(
    identity: BlueprintIdentity,
    blueprintId: string,
    version: number,
    projectId: string
  ): AgentBlueprint | null {
    if (!this.#ownsProject(identity.owner_id, projectId)) return null;
    const row = this.#sqlite
      .prepare(
        `SELECT ${BLUEPRINT_COLUMNS} FROM agent_blueprints
         WHERE blueprint_id = ? AND version = ? AND owner_id = ? AND project_id = ?`
      )
      .get(blueprintId, version, identity.owner_id, projectId) as SqlRow | undefined;
    return row ? asBlueprint(row) : null;
  }

  listBlueprints(identity: BlueprintIdentity, projectId: string): AgentBlueprint[] {
    if (!this.#ownsProject(identity.owner_id, projectId)) return [];
    return this.#sqlite
      .prepare(
        `WITH owned AS (
           SELECT ${BLUEPRINT_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY blueprint_id ORDER BY version DESC) AS rank
           FROM agent_blueprints WHERE owner_id = ? AND project_id = ?
         )
         SELECT ${BLUEPRINT_COLUMNS} FROM owned WHERE rank = 1
         ORDER BY created_at DESC, blueprint_id`
      )
      .all(identity.owner_id, projectId)
      .map((row) => asBlueprint(row));
  }

  #validateComposition(
    identity: BlueprintIdentity,
    blueprint: AgentBlueprint,
    evaluatedAt: string
  ): void {
    if (!Value.Check(AgentBlueprintSchema, blueprint)) {
      throw new AgentBlueprintValidationError("Agent blueprint violates its contract");
    }
    if (!this.#ownsProject(identity.owner_id, blueprint.project_id)) {
      throw new AgentBlueprintNotFoundError();
    }
    if (blueprint.grant.project_id !== blueprint.project_id) {
      throw new AgentBlueprintValidationError("Agent grant is bound to another project");
    }
    const expiry = Date.parse(blueprint.grant.valid_until);
    if (!Number.isFinite(expiry) || expiry <= Date.parse(evaluatedAt)) {
      throw new AgentBlueprintValidationError("Agent grant must expire in the future");
    }

    const agentFunction = this.#patterns.getFunction(
      identity,
      blueprint.function_ref.id,
      blueprint.function_ref.version,
      blueprint.project_id
    );
    const pattern = this.#patterns.getPattern(
      identity,
      blueprint.behavior_pattern_ref.id,
      blueprint.behavior_pattern_ref.version,
      blueprint.project_id
    );
    const latestPattern = this.#patterns
      .listPatterns(identity, blueprint.project_id, true)
      .find((item) => item.pattern_id === blueprint.behavior_pattern_ref.id);
    if (!agentFunction || !pattern || !latestPattern) {
      throw new AgentBlueprintValidationError(
        "Agent function or behavior pattern is not visible in this project"
      );
    }
    if (pattern.archived_at !== null || latestPattern.archived_at !== null) {
      throw new AgentBlueprintValidationError("Archived behavior patterns cannot be composed");
    }
    if (!pattern.allowed_function_ids.includes(agentFunction.function_id)) {
      throw new AgentBlueprintValidationError(
        "Behavior pattern is not compatible with the selected function"
      );
    }
  }

  #getLatestOwned(ownerId: string, blueprintId: string): AgentBlueprint | null {
    const row = this.#sqlite
      .prepare(
        `SELECT ${BLUEPRINT_COLUMNS} FROM agent_blueprints
         WHERE blueprint_id = ? AND owner_id = ? ORDER BY version DESC LIMIT 1`
      )
      .get(blueprintId, ownerId) as SqlRow | undefined;
    return row ? asBlueprint(row) : null;
  }

  #ownsProject(ownerId: string, projectId: string): boolean {
    return Boolean(
      this.#sqlite
        .prepare("SELECT 1 AS ok FROM projects WHERE id = ? AND owner_id = ?")
        .get(projectId, ownerId)
    );
  }

  #insert(value: AgentBlueprint): void {
    this.#sqlite
      .prepare(
        `INSERT INTO agent_blueprints
          (blueprint_id, version, owner_id, project_id, function_id, function_version,
           pattern_id, pattern_version, model_profile_id, model_profile_version, grant_json,
           memory_scope_json, task_contract, start_condition, close_conditions_json,
           created_by_actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        value.blueprint_id,
        value.version,
        value.owner_id,
        value.project_id,
        value.function_ref.id,
        value.function_ref.version,
        value.behavior_pattern_ref.id,
        value.behavior_pattern_ref.version,
        value.model_profile_ref.id,
        value.model_profile_ref.version,
        JSON.stringify(value.grant),
        JSON.stringify(value.memory_scope),
        value.task_contract,
        value.start_condition,
        JSON.stringify(value.close_conditions),
        value.created_by_actor_id,
        value.created_at
      );
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new AgentBlueprintValidationError("Invalid store clock");
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
