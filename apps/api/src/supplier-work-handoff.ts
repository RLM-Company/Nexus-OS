import { createHash } from "node:crypto";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import {
  CreateSupplierWorkHandoffSchema,
  EntityIdSchema,
  type CreateSupplierWorkHandoff,
  type IdentityContext,
  type SupplierWorkHandoff
} from "@cosmora/contracts";
import {
  ManagerWorkConflict,
  type GeneralChatStore,
  type ManagerWorkStore,
  type ProjectStore
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";

export function registerSupplierWorkHandoff({
  app,
  store,
  projects,
  chats,
  identityFor
}: {
  app: FastifyInstance;
  store: ManagerWorkStore;
  projects: ProjectStore;
  chats: GeneralChatStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  app.post<{ Params: { projectId: string }; Body: CreateSupplierWorkHandoff }>(
    "/api/v1/projects/:projectId/work/supplier-handoff",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: Type.Object({ projectId: EntityIdSchema }),
        body: CreateSupplierWorkHandoffSchema
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const { owner_id: owner, actor_id: actor } = identityFor(request);
      const { projectId } = request.params;
      const selection = request.body;
      const project = projects.getProject(projectId, owner);
      const chat = chats.getChat(selection.chat_id, owner);
      if (!project || !chat || chat.mode !== "kosmora" || chat.confidential)
        return reply.code(404).send({ error: "SUPPLIER_SOURCE_NOT_FOUND" });
      if (chat.project_id && chat.project_id !== projectId)
        return reply.code(404).send({ error: "SUPPLIER_SOURCE_NOT_FOUND" });
      const message = chats.getMessage(chat.id, selection.message_id, owner);
      if (message?.role !== "user" || message.status !== "completed")
        return reply.code(404).send({ error: "SUPPLIER_SOURCE_NOT_FOUND" });

      const indexes = selection.attachment_indexes.slice().sort((a, b) => a - b);
      let goal: string;
      const inputs: SupplierWorkHandoff["inputs"] = [];
      try {
        if (indexes.length === 0) {
          JSON.parse(message.content);
          goal = message.content;
        } else {
          const requirements: unknown[] = [];
          const offers: unknown[] = [];
          for (const index of indexes) {
            const file = message.attachments?.[index];
            if (!file || !("content" in file) || !/\.json$/i.test(file.name)) throw Error();
            const part = JSON.parse(file.content) as {
              requirements?: unknown;
              offers?: unknown;
            } | null;
            if (
              !part ||
              typeof part !== "object" ||
              Array.isArray(part) ||
              Object.keys(part).some((key) => key !== "requirements" && key !== "offers") ||
              (!part.requirements && !part.offers)
            )
              throw Error();
            if (part.requirements !== undefined) {
              if (!Array.isArray(part.requirements)) throw Error();
              requirements.push(...(part.requirements as unknown[]));
            }
            if (part.offers !== undefined) {
              if (!Array.isArray(part.offers)) throw Error();
              offers.push(...(part.offers as unknown[]));
            }
            inputs.push({
              name: file.name,
              sha256: createHash("sha256").update(file.content).digest("hex")
            });
          }
          goal = JSON.stringify({ requirements, offers });
        }
        if (goal.length > 8000 || !goal.trim()) throw Error();
      } catch {
        return reply.code(400).send({ error: "INVALID_SUPPLIER_SOURCE" });
      }
      try {
        const result = store.create(
          projectId,
          owner,
          actor,
          {
            client_request_id: selection.client_request_id,
            goal,
            worker_role: "analyst",
            output_contract: { kind: "supplier_comparison" }
          },
          false,
          undefined,
          {
            chat_id: chat.id,
            message_id: message.id,
            message: message.content,
            attachment_indexes: indexes,
            materials_version: selection.materials_version,
            inputs
          }
        );
        return result
          ? reply.code(201).send(result)
          : reply.code(409).send({ error: "PROJECT_INACTIVE" });
      } catch (cause) {
        if (cause instanceof ManagerWorkConflict)
          return reply.code(409).send({ error: cause.message });
        throw cause;
      }
    }
  );
}
