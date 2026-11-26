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
  StarsMissionConflict as StarsMissionStoreConflict,
  type AgentTeamRunStore,
  type StarsMissionStore,
  type StoredStarsMission
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { bindStarsTeam, starsTeamStatus } from "./stars-team-adapter.js";

export function registerStarsMissionRoutes({
  app,
  store,
  teamRuns,
  identityFor
}: {
  app: FastifyInstance;
  store: StarsMissionStore;
  teamRuns?: AgentTeamRunStore;
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

  app.get(base, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const identity = identityFor(request);
    return {
      items: store
        .list(identity.owner_id)
        .map((m) =>
          withTeamBinding(
            m as unknown as Record<string, unknown>,
            identity.owner_id,
            identity.actor_id
          )
        )
    };
  });

  app.get<{ Params: { id: string } }>(base + "/:id", { schema: { params } }, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const mission = store.get(request.params.id, identityFor(request).owner_id);
    if (!mission) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
    return mission;
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
