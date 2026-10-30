import {
  ContextMemoryCreateSchema,
  ContextMemoryUpdateSchema,
  ContextMemorySettingsInputSchema,
  type ContextMemoryInput,
  type ContextMemorySettingsInput,
  type IdentityContext,
  type MemoryTarget
} from "@cosmora/contracts";
import { ContextMemoryError, type ContextMemoryStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";

const id = Type.String({ minLength: 1, maxLength: 128 });
const entryParams = Type.Object({ id }, { additionalProperties: false });
const targetParams = Type.Object(
  {
    kind: Type.Union([Type.Literal("chat"), Type.Literal("project")]),
    targetId: id
  },
  { additionalProperties: false }
);
type TargetParams = { kind: MemoryTarget["kind"]; targetId: string };
const target = (p: TargetParams): MemoryTarget => ({ kind: p.kind, id: p.targetId });

export function registerContextMemoryRoutes(
  app: FastifyInstance,
  store: ContextMemoryStore,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  app.register((routes) => {
    routes.setValidatorCompiler(TypeBoxValidatorCompiler);
    routes.addHook("onRequest", (_req, reply, done) => {
      reply.header("Cache-Control", "private, no-store");
      done();
    });
    routes.setErrorHandler((error, _req, reply) => {
      if (error instanceof ContextMemoryError)
        return reply.code(error.status).send({ error: { code: error.code, message: error.code } });
      // Preserve the parent's authentication, validation and database error handling.
      throw error;
    });
    const owner = (r: FastifyRequest) => identityFor(r).owner_id;
    routes.get<{ Querystring: { q?: string; offset?: number } }>(
      "/api/v1/memory",
      {
        schema: {
          querystring: Type.Object(
            {
              q: Type.Optional(Type.String({ maxLength: 160 })),
              offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 }))
            },
            { additionalProperties: false }
          )
        }
      },
      (r) => store.list(owner(r), r.query.offset, r.query.q)
    );
    routes.post<{ Body: ContextMemoryInput & { client_creation_id?: string } }>(
      "/api/v1/memory",
      {
        schema: { body: ContextMemoryCreateSchema }
      },
      (r, reply) => {
        const { client_creation_id, ...input } = r.body;
        return reply.code(201).send(store.create(input, owner(r), client_creation_id));
      }
    );
    routes.get<{ Params: { id: string } }>(
      "/api/v1/memory/:id",
      {
        schema: { params: entryParams }
      },
      (r, reply) =>
        store.get(r.params.id, owner(r)) ??
        reply.code(404).send({ error: { code: "MEMORY_NOT_FOUND" } })
    );
    routes.put<{ Params: { id: string }; Body: ContextMemoryInput & { expected_version: number } }>(
      "/api/v1/memory/:id",
      {
        schema: { params: entryParams, body: ContextMemoryUpdateSchema }
      },
      (r) => {
        const { expected_version, ...input } = r.body;
        return store.update(r.params.id, expected_version, input, owner(r));
      }
    );
    routes.delete<{ Params: { id: string }; Body: { expected_version: number } }>(
      "/api/v1/memory/:id",
      {
        schema: {
          params: entryParams,
          body: Type.Object(
            {
              expected_version: Type.Integer({ minimum: 1, maximum: 1_000_000 })
            },
            { additionalProperties: false }
          )
        }
      },
      (r) => store.forget(r.params.id, r.body.expected_version, owner(r))
    );
    routes.get<{ Params: { id: string } }>(
      "/api/v1/memory/:id/versions",
      {
        schema: { params: entryParams }
      },
      (r) => ({ items: store.versions(r.params.id, owner(r)) })
    );
    const base = "/api/v1/memory/targets/:kind/:targetId";
    routes.get<{ Params: TargetParams }>(
      base + "/settings",
      {
        schema: { params: targetParams }
      },
      (r) => store.settings(target(r.params), owner(r))
    );
    routes.put<{ Params: TargetParams; Body: ContextMemorySettingsInput }>(
      base + "/settings",
      {
        schema: { params: targetParams, body: ContextMemorySettingsInputSchema }
      },
      (r) => store.updateSettings(target(r.params), r.body, owner(r))
    );
    routes.post<{ Params: TargetParams; Body: { query: string; budget_bytes?: number } }>(
      base + "/context",
      {
        schema: {
          params: targetParams,
          body: Type.Object(
            {
              query: Type.String({ maxLength: 100_000 }),
              budget_bytes: Type.Optional(Type.Integer({ minimum: 1000, maximum: 12000 }))
            },
            { additionalProperties: false }
          )
        }
      },
      (r) => store.resolve(target(r.params), owner(r), r.body.query, [], r.body.budget_bytes)
    );
    routes.get<{ Params: TargetParams; Querystring: { reference: string; offset?: number } }>(
      base + "/source",
      {
        schema: {
          params: targetParams,
          querystring: Type.Object(
            {
              reference: Type.String({ minLength: 3, maxLength: 132 }),
              offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 }))
            },
            { additionalProperties: false }
          )
        }
      },
      (r) => store.sourceFor(target(r.params), owner(r), r.query.reference, r.query.offset)
    );
    return Promise.resolve();
  });
}
