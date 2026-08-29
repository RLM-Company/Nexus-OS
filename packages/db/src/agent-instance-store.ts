import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  AgentInstanceSchema,
  type AgentBlueprint,
  type AgentInstance,
  type IdentityContext,
  type VersionedAgentReference
} from "@cosmora/contracts";
import { Value } from "typebox/value";
import { AgentBlueprintStore } from "./agent-blueprint-store.js";

type SqlRow = Record<string, unknown>;
type AgentInstanceIdentity = Pick<IdentityContext, "owner_id" | "actor_id">;

export interface AgentDelegationDecision {
  allowed: boolean;
  reasons: string[];
}

export type AgentDelegationValidator = (
  parent: AgentBlueprint,
  child: AgentBlueprint,
  evaluatedAt: string
) => AgentDelegationDecision;

export interface AgentInstanceStoreOptions {
  now?: () => number;
  id?: () => string;
  delegationValidator?: AgentDelegationValidator;
}

export interface ProposeRootAgentInput {
  project_id: string;
  blueprint_ref: VersionedAgentReference;
}

export interface ProposeDelegatedAgentInput extends ProposeRootAgentInput {
  parent_instance_id: string;
}

export class AgentInstanceNotFoundError extends Error {
  constructor() {
    super("Agent instance or blueprint was not found");
    this.name = "AgentInstanceNotFoundError";
  }
}

export class AgentInstanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInstanceValidationError";
  }
}

export class AgentInstanceDelegationError extends Error {
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(`Delegated agent proposal was denied: ${reasons.join(" ")}`);
    this.name = "AgentInstanceDelegationError";
    this.reasons = reasons;
  }
}

const ROOT_KEYS = new Set(["project_id", "blueprint_ref"]);
const DELEGATED_KEYS = new Set(["project_id", "blueprint_ref", "parent_instance_id"]);

const assertExactKeys = (value: object, allowed: ReadonlySet<string>): void => {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new AgentInstanceValidationError(
      `Agent proposal contains unsupported fields: ${unexpected.sort().join(", ")}`
    );
  }
};

const INSTANCE_COLUMNS = `instance_id, owner_id, project_id, blueprint_id, blueprint_version,
  parent_instance_id, status, created_at, updated_at, closed_at`;

export class AgentInstanceStore {
  readonly #sqlite: DatabaseSync;
  readonly #blueprints: AgentBlueprintStore;
  readonly #now: () => number;
  readonly #id: () => string;
  readonly #delegationValidator: AgentDelegationValidator | undefined;

  constructor(sqlite: DatabaseSync, options: AgentInstanceStoreOptions = {}) {
    this.#sqlite = sqlite;
    this.#blueprints = new AgentBlueprintStore(sqlite, options.now ? { now: options.now } : {});
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
    this.#delegationValidator = options.delegationValidator;
  }

  proposeRoot(identity: AgentInstanceIdentity, input: ProposeRootAgentInput): AgentInstance {
    assertExactKeys(input, ROOT_KEYS);
    const timestamp = this.#timestamp();
    const blueprint = this.#loadBlueprint(identity, input.project_id, input.blueprint_ref);
    this.#assertUnexpired(blueprint, timestamp);
    return this.#insertProposal(identity, blueprint, null, timestamp);
  }

  proposeDelegated(
    identity: AgentInstanceIdentity,
    input: ProposeDelegatedAgentInput
  ): AgentInstance {
    assertExactKeys(input, DELEGATED_KEYS);
    return this.#transaction(() => {
      const timestamp = this.#timestamp();
      const parentRow = this.#getOwnedRow(
        identity.owner_id,
        input.project_id,
        input.parent_instance_id
      );
      if (!parentRow) throw new AgentInstanceNotFoundError();
      const parent = this.#resolve(identity, parentRow);
      this.#assertUnexpired(parent.blueprint, timestamp);
      const childBlueprint = this.#loadBlueprint(identity, input.project_id, input.blueprint_ref);
      this.#assertUnexpired(childBlueprint, timestamp);

      if (!this.#delegationValidator) {
        throw new AgentInstanceDelegationError([
          "No Policy Engine delegation validator is configured."
        ]);
      }
      const decision = this.#delegationValidator(parent.blueprint, childBlueprint, timestamp);
      if (!decision.allowed || decision.reasons.length > 0) {
        throw new AgentInstanceDelegationError(
          decision.reasons.length > 0 ? decision.reasons : ["Policy Engine denied delegation."]
        );
      }
      return this.#insertProposal(identity, childBlueprint, input.parent_instance_id, timestamp);
    });
  }

  getInstance(
    identity: AgentInstanceIdentity,
    projectId: string,
    instanceId: string
  ): AgentInstance | null {
    const row = this.#getOwnedRow(identity.owner_id, projectId, instanceId);
    return row ? this.#resolve(identity, row) : null;
  }

  listInstances(identity: AgentInstanceIdentity, projectId: string): AgentInstance[] {
    return this.#sqlite
      .prepare(
        `SELECT ${INSTANCE_COLUMNS} FROM agent_instances
         WHERE owner_id = ? AND project_id = ? ORDER BY created_at, instance_id`
      )
      .all(identity.owner_id, projectId)
      .map((row) => this.#resolve(identity, row));
  }

  #loadBlueprint(
    identity: AgentInstanceIdentity,
    projectId: string,
    reference: VersionedAgentReference
  ): AgentBlueprint {
    const blueprint = this.#blueprints.getBlueprint(
      identity,
      reference.id,
      reference.version,
      projectId
    );
    if (!blueprint) throw new AgentInstanceNotFoundError();
    return blueprint;
  }

  #assertUnexpired(blueprint: AgentBlueprint, evaluatedAt: string): void {
    if (Date.parse(blueprint.grant.valid_until) <= Date.parse(evaluatedAt)) {
      throw new AgentInstanceValidationError("Expired blueprints cannot be proposed");
    }
  }

  #getOwnedRow(ownerId: string, projectId: string, instanceId: string): SqlRow | undefined {
    return this.#sqlite
      .prepare(
        `SELECT ${INSTANCE_COLUMNS} FROM agent_instances
         WHERE instance_id = ? AND owner_id = ? AND project_id = ?`
      )
      .get(instanceId, ownerId, projectId);
  }

  #resolve(identity: AgentInstanceIdentity, row: SqlRow): AgentInstance {
    const blueprint = this.#blueprints.getBlueprint(
      identity,
      String(row.blueprint_id),
      Number(row.blueprint_version),
      String(row.project_id)
    );
    if (!blueprint) {
      throw new AgentInstanceValidationError("Stored agent instance has no visible blueprint");
    }
    const value = {
      instance_id: String(row.instance_id),
      blueprint,
      parent_instance_id:
        typeof row.parent_instance_id === "string" ? row.parent_instance_id : null,
      status: row.status,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      closed_at: typeof row.closed_at === "string" ? row.closed_at : null
    };
    if (!Value.Check(AgentInstanceSchema, value)) {
      throw new AgentInstanceValidationError("Stored agent instance violates its contract");
    }
    return value;
  }

  #insertProposal(
    identity: AgentInstanceIdentity,
    blueprint: AgentBlueprint,
    parentInstanceId: string | null,
    timestamp: string
  ): AgentInstance {
    const instanceId = this.#id();
    this.#sqlite
      .prepare(
        `INSERT INTO agent_instances
          (instance_id, owner_id, project_id, blueprint_id, blueprint_version,
           parent_instance_id, status, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, NULL)`
      )
      .run(
        instanceId,
        identity.owner_id,
        blueprint.project_id,
        blueprint.blueprint_id,
        blueprint.version,
        parentInstanceId,
        timestamp,
        timestamp
      );
    return this.getInstance(identity, blueprint.project_id, instanceId) as AgentInstance;
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new AgentInstanceValidationError("Invalid store clock");
    return new Date(now).toISOString();
  }

  #transaction<T>(work: () => T): T {
    if (this.#sqlite.isTransaction) return work();
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
