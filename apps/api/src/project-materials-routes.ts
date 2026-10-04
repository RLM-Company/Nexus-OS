import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import {
  ChatTextAttachmentSchema,
  isValidChatAttachments,
  attachmentContextSize,
  type ChatTextAttachment,
  type IdentityContext
} from "@cosmora/contracts";
import { IdempotencyConflictError, type ProjectStore } from "@cosmora/db";

export function registerProjectMaterialsRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  const path = "/api/v1/projects/:projectId/materials";
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }) },
    { additionalProperties: false }
  );
  type Params = { projectId: string };
  app.get<{ Params: Params }>(
    path,
    { schema: { params } },
    (request, reply) =>
      store.getMaterials(request.params.projectId, identityFor(request).owner_id) ??
      reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } })
  );
  app.put<{
    Params: Params;
    Body: { version: number; instructions: string; attachments: ChatTextAttachment[] };
  }>(
    path,
    {
      schema: {
        params,
        body: Type.Object(
          {
            version: Type.Integer({ minimum: 0 }),
            instructions: Type.String({ maxLength: 4000 }),
            attachments: Type.Array(ChatTextAttachmentSchema, { maxItems: 4 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      const { instructions, attachments } = request.body;
      if (
        !isValidChatAttachments(attachments) ||
        new TextEncoder().encode(instructions).length +
          attachments.reduce((sum, file) => sum + attachmentContextSize(file), 0) >
          24000
      )
        return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
      try {
        return (
          store.setMaterials(
            request.params.projectId,
            identityFor(request).owner_id,
            request.body
          ) ?? reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } })
        );
      } catch (error) {
        if (error instanceof IdempotencyConflictError)
          return reply.code(409).send({ error: { code: "CONFLICT" } });
        throw error;
      }
    }
  );
}
