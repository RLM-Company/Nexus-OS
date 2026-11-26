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
  type StarsMissionStore
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";

export function registerStarsMissionRoutes({
  app,
  store,
  identityFor
}: {
  app: FastifyInstance;
  store: StarsMissionStore;
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

  app.get(base, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return { items: store.list(identityFor(request).owner_id) };
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
      try {
        return store.save(next, owner, current.version);
      } catch (error) {
        if (error instanceof StarsMissionStoreConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );
}
