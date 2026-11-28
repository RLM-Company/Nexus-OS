import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import {
  ChatTextAttachmentSchema,
  isValidChatAttachments,
  attachmentContextSize,
  type ChatTextAttachment,
  type IdentityContext
} from "@cosmora/contracts";
import {
  IdempotencyConflictError,
  ProjectMaterialsFencedError,
  type ProjectMembershipStore,
  type ProjectStore
} from "@cosmora/db";
import { projectAccess } from "./project-access.js";

export function registerProjectMaterialsRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  identityFor: (request: FastifyRequest) => IdentityContext,
  membership?: ProjectMembershipStore
) {
  const path = "/api/v1/projects/:projectId/materials";
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }) },
    { additionalProperties: false }
  );
  type Params = { projectId: string };
  app.get<{ Params: Params }>(path, { schema: { params } }, (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const access = projectAccess(
      membership,
      request.params.projectId,
      identityFor(request).owner_id
    );
    return (
      (access && store.getMaterials(access.projectId, access.ownerId)) ??
      reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } })
    );
  });
  app.get<{ Params: Params & { index: string } }>(
    path + "/files/:index",
    {
      schema: {
        params: Type.Object({ ...params.properties, index: Type.String({ pattern: "^[0-3]$" }) })
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const access = projectAccess(
        membership,
        request.params.projectId,
        identityFor(request).owner_id
      );
      const file =
        access &&
        store.getMaterials(access.projectId, access.ownerId)?.attachments[
          Number(request.params.index)
        ];
      if (!file) return reply.code(404).send({ error: { code: "FILE_NOT_FOUND" } });
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          "attachment; filename*=UTF-8''" +
            encodeURIComponent(file.name).replace(
              /['()*]/g,
              (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase()
            )
        )
        .type("text/plain; charset=utf-8")
        .send(file.content);
    }
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
      const access = projectAccess(
        membership,
        request.params.projectId,
        identityFor(request).owner_id,
        "editor"
      );
      if (!access) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
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
            access.ownerId,
            request.body,
            identityFor(request).actor_id
          ) ?? reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } })
        );
      } catch (error) {
        if (error instanceof ProjectMaterialsFencedError)
          return reply.code(409).send({ error: { code: error.message } });
        if (error instanceof IdempotencyConflictError)
          return reply.code(409).send({ error: { code: "CONFLICT" } });
        throw error;
      }
    }
  );
}
