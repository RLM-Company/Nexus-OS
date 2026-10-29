import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CreateComputerSessionSchema,
  ComputerStepSchema,
  AuthorizeComputerActionSchema,
  ComputerDecisionSchema,
  ComputerSessionAcceptanceSchema,
  type IdentityContext
} from "@cosmora/contracts";
import { ComputerControlError, type ComputerControlService } from "./service.js";

export function registerComputerControlRoutes(
  app: FastifyInstance,
  service: ComputerControlService,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const root = "/api/v1/projects/:projectId/computer-sessions";
  const projectParams = Type.Object(
    { projectId: Type.String({ minLength: 1, maxLength: 160 }) },
    { additionalProperties: false }
  );
  const sessionParams = Type.Object(
    { ...projectParams.properties, id: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false }
  );
  const headers = Type.Object({
    "x-kosmora-computer-token": Type.String({
      minLength: 43,
      maxLength: 43,
      pattern: "^[A-Za-z0-9_-]+$"
    })
  });
  const safe = async <T>(
    reply: FastifyReply,
    operation: () => T | Promise<T>
  ): Promise<T | void> => {
    try {
      return await operation();
    } catch (error) {
      reply.code(error instanceof ComputerControlError ? error.status : 503).send({
        error: {
          code: error instanceof ComputerControlError ? error.code : "COMPUTER_RUNTIME_UNAVAILABLE"
        }
      });
    }
  };
  typed.post(
    root,
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: projectParams,
        body: CreateComputerSessionSchema,
        response: { 200: ComputerSessionAcceptanceSchema }
      }
    },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const identity = identityFor(r);
      return safe(reply, () =>
        service.create(identity.owner_id, identity.actor_id, r.params.projectId, r.body)
      );
    }
  );
  typed.post(
    root + "/:id/step",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: sessionParams,
        headers,
        body: ComputerStepSchema,
        response: { 200: ComputerDecisionSchema }
      }
    },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      return safe(reply, () =>
        service.next(
          identityFor(r).owner_id,
          r.params.projectId,
          r.params.id,
          r.headers["x-kosmora-computer-token"],
          r.body
        )
      );
    }
  );
  typed.delete(
    root + "/:id",
    { validatorCompiler: TypeBoxValidatorCompiler, schema: { params: sessionParams, headers } },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      return safe(reply, () =>
        service.end(
          identityFor(r).owner_id,
          r.params.projectId,
          r.params.id,
          r.headers["x-kosmora-computer-token"]
        )
      );
    }
  );
  typed.post(
    root + "/:id/authorize-action",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params: sessionParams, headers, body: AuthorizeComputerActionSchema }
    },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      return safe(reply, () =>
        service.authorize(
          identityFor(r).owner_id,
          r.params.projectId,
          r.params.id,
          r.headers["x-kosmora-computer-token"],
          r.body
        )
      );
    }
  );
}
