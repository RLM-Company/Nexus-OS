import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { MembershipError, type ProjectMembershipStore } from "@cosmora/db";

const scope = Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 128 }) });
const member = Type.Object({ account_id: Type.String({ minLength: 1, maxLength: 128 }) });

export function registerProjectMembershipRoutes(
  app: FastifyInstance,
  store: ProjectMembershipStore,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  app.register((routes) => {
    routes.setValidatorCompiler(TypeBoxValidatorCompiler);
    const base = "/api/v1/projects/:projectId/members";
    routes.addHook("onSend", async (request, reply, payload) => {
      if (request.routeOptions.url?.startsWith(base))
        reply.header("Cache-Control", "private, no-store");
      return payload;
    });

    routes.get(`${base}`, { schema: { params: scope } }, (req, reply) => {
      const params = req.params as { projectId: string };
      try {
        return store.members(params.projectId, identityFor(req).owner_id);
      } catch (error) {
        if (error instanceof MembershipError)
          return reply.code(error.code === "NOT_FOUND" ? 404 : 409).send({
            error: { code: error.code }
          });
        throw error;
      }
    });

    routes.post(
      `${base}/invite`,
      {
        schema: {
          params: scope,
          body: Type.Object({
            account_id: Type.String({ minLength: 1, maxLength: 128 }),
            role: Type.Union([Type.Literal("editor"), Type.Literal("viewer")])
          })
        }
      },
      (req, reply) => {
        const params = req.params as { projectId: string };
        try {
          return store.invite(params.projectId, identityFor(req).owner_id, req.body);
        } catch (error) {
          if (error instanceof MembershipError)
            return reply.code(error.code === "NOT_FOUND" ? 404 : 409).send({
              error: { code: error.code }
            });
          throw error;
        }
      }
    );

    routes.post(`${base}/accept`, { schema: { params: scope } }, (req, reply) => {
      const params = req.params as { projectId: string };
      try {
        return store.accept(params.projectId, identityFor(req).owner_id);
      } catch (error) {
        if (error instanceof MembershipError)
          return reply.code(error.code === "NOT_FOUND" ? 404 : 409).send({
            error: { code: error.code }
          });
        throw error;
      }
    });

    routes.delete(
      `${base}/:account_id`,
      { schema: { params: Type.Intersect([scope, member]) } },
      (req, reply) => {
        const params = req.params as { projectId: string; account_id: string };
        try {
          const owner = identityFor(req).owner_id;
          if (owner === params.account_id) store.leave(params.projectId, owner);
          else store.revoke(params.projectId, owner, params.account_id);
        return { ok: true };
      } catch (error) {
        if (error instanceof MembershipError)
          return reply.code(error.code === "NOT_FOUND" ? 404 : 409).send({
            error: { code: error.code }
          });
        throw error;
      }
    });
  });
}
