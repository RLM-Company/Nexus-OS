import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentBlueprint, AgentInstance } from "@cosmora/contracts";
import type { AgentBlueprintStore } from "./agent-blueprint-store.js";
import { AgentInstanceNotFoundError } from "./agent-instance-store.js";
import type { AgentInstanceIdentity, AgentInstanceStore } from "./agent-instance-store.js";

export interface AgentTeamStoreOptions {
  now?: () => number;
  blueprints: AgentBlueprintStore;
  instances: AgentInstanceStore;
}

export interface AgentTeamPlan {
  items: AgentInstance[];
  composition_id: string;
  confirmation_required: boolean;
}

export interface AgentTeamConfirmation {
  items: AgentInstance[];
  composition_id: string;
}

export class AgentTeamValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTeamValidationError";
  }
}

export class AgentTeamCompositionDriftError extends Error {
  constructor() {
    super("The stored team composition does not match its recorded blueprint roster");
    this.name = "AgentTeamCompositionDriftError";
  }
}

// A roster entry string "blueprint_id@version"; the composition id is the
// sha256 over the sorted roster lines, so equal blueprint sets share one id
// regardless of proposal order.
const rosterLine = (blueprint: AgentBlueprint): string =>
  `${blueprint.blueprint_id}@${blueprint.version}`;

const compositionIdOfLines = (lines: readonly string[]): string =>
  createHash("sha256")
    .update([...lines].sort().join("\n"), "utf8")
    .digest("hex");

const compositionIdOf = (roster: AgentBlueprint[]): string =>
  compositionIdOfLines(roster.map(rosterLine));

const asRosterJson = (roster: AgentBlueprint[]): string =>
  JSON.stringify(roster.map(rosterLine).sort());

export class AgentTeamStore {
  readonly #sqlite: DatabaseSync;
  readonly #now: () => number;
  readonly #blueprints: AgentBlueprintStore;
  readonly #instances: AgentInstanceStore;

  constructor(sqlite: DatabaseSync, options: AgentTeamStoreOptions) {
    this.#sqlite = sqlite;
    this.#now = options.now ?? Date.now;
    this.#blueprints = options.blueprints;
    this.#instances = options.instances;
  }

  // Propose (or reuse) the pending roster for the project's current blueprint
  // composition. No unexpired blueprint means the single-agent default:
  // nothing is proposed and nothing needs confirmation.
  plan(identity: AgentInstanceIdentity, projectId: string): AgentTeamPlan {
    const roster = this.#currentRoster(identity, projectId);
    if (roster.length === 0) {
      return { items: [], composition_id: "", confirmation_required: false };
    }
    const compositionId = compositionIdOf(roster);
    const items =
      this.#pendingRoster(identity, projectId, roster) ??
      this.#proposeRoster(identity, projectId, roster);
    return {
      items,
      composition_id: compositionId,
      confirmation_required: !this.compositionConfirmed(identity.owner_id, projectId, compositionId)
    };
  }

  // Resolve the plan result for an idempotent replay: the pending roster for
  // the recorded composition. Blueprint drift (composition no longer equals
  // the current blueprint set) is an honest conflict, not a stale echo.
  resolvePlan(
    identity: AgentInstanceIdentity,
    projectId: string,
    compositionId: string
  ): AgentTeamPlan | null {
    const roster = this.#currentRoster(identity, projectId);
    if (roster.length === 0 || compositionIdOf(roster) !== compositionId) return null;
    const items = this.#pendingRoster(identity, projectId, roster);
    if (!items) return null;
    return {
      items,
      composition_id: compositionId,
      confirmation_required: !this.compositionConfirmed(identity.owner_id, projectId, compositionId)
    };
  }

  // Confirm the roster the owner selected: every id must resolve to an owned,
  // parentless, still-proposed instance in this project; the confirmed
  // composition is the blueprint set of those instances. Confirming the same
  // set twice is a no-op (INSERT OR IGNORE).
  confirm(
    identity: AgentInstanceIdentity,
    projectId: string,
    instanceIds: readonly string[]
  ): AgentTeamConfirmation {
    return this.#transaction(() => {
      const items = instanceIds.map((instanceId) => {
        const instance = this.#instances.getInstance(identity, projectId, instanceId);
        if (!instance) throw new AgentInstanceNotFoundError();
        if (instance.parent_instance_id !== null) {
          throw new AgentTeamValidationError(
            "Delegated proposals are confirmed through their parent team roster"
          );
        }
        if (instance.status !== "proposed") {
          throw new AgentTeamValidationError("Only proposed instances can confirm a team roster");
        }
        return instance;
      });
      const roster = items.map((instance) => instance.blueprint);
      const evaluatedAt = this.#timestamp();
      for (const blueprint of roster) {
        if (Date.parse(blueprint.grant.valid_until) <= Date.parse(evaluatedAt)) {
          throw new AgentTeamValidationError("Expired blueprints cannot confirm a team roster");
        }
      }
      const compositionId = compositionIdOf(roster);
      this.#sqlite
        .prepare(
          `INSERT OR IGNORE INTO agent_team_compositions
            (owner_id, project_id, composition_id, blueprint_refs_json,
             confirmed_by_actor_id, confirmed_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          identity.owner_id,
          projectId,
          compositionId,
          asRosterJson(roster),
          identity.actor_id,
          evaluatedAt
        );
      return { items, composition_id: compositionId };
    });
  }

  // Resolve the confirm result for an idempotent replay: the recorded
  // composition is immutable history, so the replay serves the pending
  // proposals recorded in it. The row must still hash to its composition id
  // (integrity); blueprint drift does not invalidate a confirmed roster —
  // a changed roster plans a new composition instead.
  resolveConfirm(
    identity: AgentInstanceIdentity,
    projectId: string,
    compositionId: string
  ): AgentTeamConfirmation | null {
    const row = this.#sqlite
      .prepare(
        `SELECT blueprint_refs_json FROM agent_team_compositions
         WHERE owner_id = ? AND project_id = ? AND composition_id = ?`
      )
      .get(identity.owner_id, projectId, compositionId) as
      { blueprint_refs_json: string } | undefined;
    if (!row) return null;
    let recorded: unknown;
    try {
      recorded = JSON.parse(row.blueprint_refs_json);
    } catch {
      throw new AgentTeamCompositionDriftError();
    }
    if (
      !Array.isArray(recorded) ||
      recorded.some((line) => typeof line !== "string" || line.length === 0) ||
      compositionIdOfLines(recorded) !== compositionId
    ) {
      throw new AgentTeamCompositionDriftError();
    }
    const wanted = new Set(recorded as string[]);
    const items = this.#instances
      .listInstances(identity, projectId)
      .filter(
        (instance) =>
          instance.parent_instance_id === null &&
          instance.status === "proposed" &&
          wanted.has(rosterLine(instance.blueprint))
      );
    return { items, composition_id: compositionId };
  }

  compositionConfirmed(ownerId: string, projectId: string, compositionId: string): boolean {
    return (
      this.#sqlite
        .prepare(
          `SELECT 1 FROM agent_team_compositions
           WHERE owner_id = ? AND project_id = ? AND composition_id = ?`
        )
        .get(ownerId, projectId, compositionId) !== undefined
    );
  }

  // Latest-version, unexpired project blueprints in stable roster order.
  #currentRoster(identity: AgentInstanceIdentity, projectId: string): AgentBlueprint[] {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new AgentTeamValidationError("Invalid store clock");
    return this.#blueprints
      .listBlueprints(identity, projectId)
      .filter((blueprint) => Date.parse(blueprint.grant.valid_until) > now);
  }

  // Reuse the pending proposals for this roster: one earliest proposed
  // parentless instance per roster blueprint. Returns null when any blueprint
  // has no pending proposal yet.
  #pendingRoster(
    identity: AgentInstanceIdentity,
    projectId: string,
    roster: AgentBlueprint[]
  ): AgentInstance[] | null {
    const wanted = new Set(roster.map(rosterLine));
    const byRosterLine = new Map<string, AgentInstance>();
    for (const instance of this.#instances.listInstances(identity, projectId)) {
      if (instance.parent_instance_id !== null || instance.status !== "proposed") continue;
      const line = rosterLine(instance.blueprint);
      if (!wanted.has(line)) continue;
      const existing = byRosterLine.get(line);
      if (!existing || instance.created_at < existing.created_at) {
        byRosterLine.set(line, instance);
      }
    }
    if (byRosterLine.size < roster.length) return null;
    return roster
      .map((blueprint) => byRosterLine.get(rosterLine(blueprint)))
      .filter((instance): instance is AgentInstance => instance !== undefined);
  }

  #proposeRoster(
    identity: AgentInstanceIdentity,
    projectId: string,
    roster: AgentBlueprint[]
  ): AgentInstance[] {
    return roster.map((blueprint) =>
      this.#instances.proposeRoot(identity, {
        project_id: projectId,
        blueprint_ref: { id: blueprint.blueprint_id, version: blueprint.version }
      })
    );
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new AgentTeamValidationError("Invalid store clock");
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
