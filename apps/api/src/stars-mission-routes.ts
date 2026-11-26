import { createHash } from "node:crypto";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import {
  CreateStarsMissionSchema,
  EntityIdSchema,
  StarsMissionEventSchema,
  type CreateStarsMission,
  type IdentityContext,
  type StarsMissionEvent
} from "@cosmora/contracts";
import { applyStarsMissionEvent, createStarsMission, StarsMissionConflict } from "@cosmora/core";
import {
  AgentTeamRunNotFoundError,
  AgentTeamRunValidationError,
  StarsMissionConflict as StarsMissionStoreConflict,
  WorkDagConflict,
  ManagerWorkConflict,
  type ProjectStore,
  type AgentTeamRunStore,
  type StarsMissionStore,
  type StoredStarsMission
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { bindStarsTeam, starsTeamStatus } from "./stars-team-adapter.js";
import type { WorkDagCoordinator } from "./work-dag-coordinator.js";

type MissionRun = {
  project_id: string;
  composition_id: string;
  graph_id: string;
  manager_node_id: string;
};

export function registerStarsMissionRoutes({
  app,
  store,
  teamRuns,
  projects,
  dag,
  identityFor
}: {
  app: FastifyInstance;
  store: StarsMissionStore;
  teamRuns?: AgentTeamRunStore;
  projects?: ProjectStore;
  dag?: WorkDagCoordinator;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const base = "/api/v1/stars/missions";
  const params = Type.Object({ id: EntityIdSchema });

  app.post<{ Body: CreateStarsMission }>(
    base,
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { body: CreateStarsMissionSchema }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = identityFor(request).owner_id;
      const id = "mission-" + request.body.client_request_id;
      const existing = store.get(id, owner);
      if (existing) return existing;
      const mission = createStarsMission({
        id,
        team_scope: request.body.team_scope,
        ...(request.body.goal !== undefined ? { goal: request.body.goal } : {})
      });
      return store.save(mission, owner, 0);
    }
  );

  const projectIdFor = (teamScope: string) => teamScope;

  const withTeamBinding = (
    mission: Record<string, unknown>,
    owner: string,
    actor: string
  ): Record<string, unknown> => {
    const stored = mission.team_binding as
      { composition_id?: string; project_id?: string } | undefined;
    if (!teamRuns || !stored?.composition_id || !stored.project_id) return mission;
    const live = teamRuns.parts(
      { owner_id: owner, actor_id: actor },
      stored.project_id,
      stored.composition_id
    );
    const merged = starsTeamStatus(live.parts, stored as Parameters<typeof starsTeamStatus>[1]);
    return { ...mission, team_binding: merged };
  };

  const withExecution = (mission: StoredStarsMission, owner: string) => {
    const run = mission.execution as MissionRun | undefined;
    if (!run) return mission;
    const graph = dag?.get(run.graph_id, owner, run.project_id);
    return {
      ...mission,
      runtime: graph
        ? {
            mode: graph.mode,
            status: graph.execution?.status ?? "awaiting_owner_run",
            reason: graph.execution?.reason ?? null,
            version: graph.version,
            nodes: graph.nodes.map(({ id, title, status, depends_on, artifacts, attempts }) => ({
              id,
              title,
              status,
              depends_on,
              artifact_count: artifacts.length,
              attempts: attempts.length
            }))
          }
        : null
    };
  };

  app.post<{
    Params: { id: string };
    Body: { expected_version: number; composition_id: string; manager_instance_id: string };
  }>(
    base + "/:id/execution",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            composition_id: Type.String({ pattern: "^[a-f0-9]{64}$" }),
            manager_instance_id: EntityIdSchema
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const identity = identityFor(request);
      const owner = identity.owner_id;
      const mission = store.get(request.params.id, owner);
      if (!mission || !projects?.getProject(mission.team_scope, owner))
        return reply.code(404).send({ error: "STARS_PROJECT_NOT_FOUND" });
      if (!dag || !teamRuns) return reply.code(503).send({ error: "STARS_EXECUTION_UNAVAILABLE" });
      const existing = mission.execution as
        (MissionRun & { manager_instance_id: string }) | undefined;
      const { expected_version, composition_id, manager_instance_id } = request.body;
      if (existing) {
        return existing.composition_id === composition_id &&
          existing.manager_instance_id === manager_instance_id
          ? withExecution(mission, owner)
          : reply.code(409).send({ error: "STARS_TEAM_ALREADY_BOUND" });
      }
      if (
        mission.version !== expected_version ||
        mission.stage !== "working" ||
        typeof mission.goal !== "string"
      )
        return reply.code(409).send({ error: "STARS_MISSION_NOT_READY" });
      try {
        const active = teamRuns.activate(identity, mission.team_scope, composition_id, {
          runKey: "stars:" + createHash("sha256").update(mission.id).digest("hex"),
          goal: mission.goal,
          managerInstance: manager_instance_id
        });
        const graph = dag.get(active.graph_id, owner, mission.team_scope);
        const managerNode = active.parts.find((part) => part.instance_id === manager_instance_id);
        if (
          !managerNode ||
          graph?.nodes.find((node) => node.id === managerNode.node_id)?.depends_on.length !== 2
        )
          return reply.code(409).send({ error: "STARS_TEAM_DOES_NOT_MATCH" });
        const execution = {
          project_id: mission.team_scope,
          composition_id,
          graph_id: active.graph_id,
          manager_node_id: managerNode.node_id,
          manager_instance_id
        };
        return withExecution(
          store.save(
            { ...mission, version: mission.version + 1, execution },
            owner,
            mission.version
          ),
          owner
        );
      } catch (error) {
        if (error instanceof AgentTeamRunNotFoundError)
          return reply.code(404).send({ error: "STARS_TEAM_NOT_FOUND" });
        if (error instanceof AgentTeamRunValidationError)
          return reply.code(409).send({ error: "STARS_TEAM_INVALID", message: error.message });
        if (
          error instanceof StarsMissionStoreConflict ||
          error instanceof WorkDagConflict ||
          error instanceof ManagerWorkConflict
        )
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );

  app.get(base, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const identity = identityFor(request);
    return {
      items: store
        .list(identity.owner_id)
        .map((m) =>
          withTeamBinding(withExecution(m, identity.owner_id), identity.owner_id, identity.actor_id)
        )
    };
  });

  app.get<{ Params: { id: string } }>(base + "/:id", { schema: { params } }, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const mission = store.get(request.params.id, identityFor(request).owner_id);
    if (!mission) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
    return withExecution(mission, identityFor(request).owner_id);
  });

  app.post<{ Params: { id: string }; Body: StarsMissionEvent }>(
    base + "/:id/events",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: StarsMissionEventSchema }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = identityFor(request).owner_id;
      const current = store.get(request.params.id, owner);
      if (!current) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
      if (current.execution) return reply.code(409).send({ error: "STARS_USE_WORK_PLAN" });
      if (request.body.expected_version !== current.version)
        return reply.code(409).send({ error: "STALE_MISSION_VERSION" });
      const { expected_version: _checked, ...event } = request.body;
      void _checked;
      let next;
      try {
        next = applyStarsMissionEvent(
          current as Parameters<typeof applyStarsMissionEvent>[0],
          event
        );
      } catch (error) {
        if (error instanceof StarsMissionConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
      const savedState = next as unknown as StoredStarsMission & Record<string, unknown>;
      if (event.type === "plan" && Array.isArray(savedState.agents)) {
        const missionId = typeof savedState.id === "string" ? savedState.id : "";
        const teamScope = typeof savedState.team_scope === "string" ? savedState.team_scope : "";
        const binding = bindStarsTeam(
          {
            id: missionId,
            team_scope: teamScope,
            agents: (savedState.agents as Array<{ id: string }>).map((a) => ({ id: a.id }))
          },
          projectIdFor(teamScope)
        );
        savedState.team_binding = binding;
      }
      try {
        return store.save(savedState, owner, current.version);
      } catch (error) {
        if (error instanceof StarsMissionStoreConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );
}
