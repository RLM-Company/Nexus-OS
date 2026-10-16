import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { WorkSkillError, type WorkSkillStore } from "@cosmora/db";
import { UpdateChatSkillsSchema, type IdentityContext } from "@cosmora/contracts";

export function registerWorkSkillRoutes(
  app: FastifyInstance,
  store: WorkSkillStore,
  identityFor: (r: FastifyRequest) => IdentityContext
) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const base = "/api/v1/projects/:projectId";
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1, maxLength: 160 }) },
    { additionalProperties: false }
  );
  const acceptedParams = Type.Object(
    {
      projectId: Type.String({ minLength: 1, maxLength: 160 }),
      id: Type.String({ minLength: 1, maxLength: 160 })
    },
    { additionalProperties: false }
  );
  typed.get(base + "/work-skills", { schema: { params } }, (r, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      return { selection: store.get(r.params.projectId, identityFor(r).owner_id) };
    } catch (e) {
      if (e instanceof WorkSkillError)
        return reply.code(e.status).send({ error: { message: e.message } });
      throw e;
    }
  });
  typed.put(
    base + "/work-skills",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: UpdateChatSkillsSchema }
    },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        return {
          selection: store.update(
            r.params.projectId,
            identityFor(r).owner_id,
            r.body.expected_version,
            r.body.items
          )
        };
      } catch (e) {
        if (e instanceof WorkSkillError)
          return reply.code(e.status).send({ error: { message: e.message } });
        throw e;
      }
    }
  );
  typed.get(base + "/work/:id/skills", { schema: { params: acceptedParams } }, (r, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const snapshot = store.forWork(r.params.id, identityFor(r).owner_id, r.params.projectId);
    return snapshot
      ? { snapshot }
      : reply.code(404).send({ error: { message: "Задача не найдена." } });
  });
  typed.get(base + "/work-dags/:id/skills", { schema: { params: acceptedParams } }, (r, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const snapshot = store.forPlan(r.params.id, identityFor(r).owner_id, r.params.projectId);
    return snapshot
      ? { snapshot }
      : reply.code(404).send({ error: { message: "План не найден." } });
  });
}
