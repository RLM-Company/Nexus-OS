import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import {
  ContextMemoryHybridSearch,
  buildResponseMemoryCitations,
  type HybridRecallOptions
} from "../../../packages/db/src/context-memory-hybrid-search.ts";
import { ContextMemoryNotesMigrator } from "../../../packages/db/src/context-memory-notes-migrator.ts";

export interface RegisterContextMemoryHybridRoutesOptions {
  sqlite: DatabaseSync;
  resolveOwnerId?: (req: FastifyRequest) => string | null;
}

export async function registerContextMemoryHybridRoutes(
  app: FastifyInstance,
  options: RegisterContextMemoryHybridRoutesOptions
): Promise<void> {
  const hybridSearch = new ContextMemoryHybridSearch(options.sqlite);
  const migrator = new ContextMemoryNotesMigrator(options.sqlite);

  const getOwner = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const ownerId =
      options.resolveOwnerId?.(req) ??
      (req.headers["x-kosmora-owner-id"] as string | undefined) ??
      null;
    if (!ownerId) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Owner session required" });
      return null;
    }
    return ownerId;
  };

  app.post("/api/context-memory/hybrid-recall", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const body = (req.body ?? {}) as Partial<HybridRecallOptions> & { responsePreviewText?: string };
    const bundle = hybridSearch.recall({
      ownerId,
      query: String(body.query ?? ""),
      targetKind: body.targetKind,
      targetId: body.targetId,
      chatId: body.chatId ?? null,
      projectId: body.projectId ?? null,
      includePersonal: body.includePersonal ?? true,
      permittedChatIds: Array.isArray(body.permittedChatIds) ? body.permittedChatIds : [],
      permittedProjectIds: Array.isArray(body.permittedProjectIds) ? body.permittedProjectIds : [],
      temporaryMode: Boolean(body.temporaryMode),
      maxItems: body.maxItems,
      maxBytes: body.maxBytes
    });

    const citations =
      typeof body.responsePreviewText === "string" && body.responsePreviewText.trim()
        ? buildResponseMemoryCitations(bundle.items, body.responsePreviewText)
        : [];

    return reply.code(200).send({
      ...bundle,
      citations
    });
  });

  app.post("/api/context-memory/migrate-legacy", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const result = migrator.migrateOwnerLegacyMemory(ownerId);
    return reply.code(200).send(result);
  });

  app.get("/api/context-memory/defaults", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    return reply.code(200).send(migrator.getOwnerDefaultRules(ownerId));
  });

  app.put("/api/context-memory/defaults", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = migrator.updateOwnerDefaultRules(ownerId, {
      defaultEnabled:
        typeof body.defaultEnabled === "boolean" ? body.defaultEnabled : undefined,
      defaultUsePersonal:
        typeof body.defaultUsePersonal === "boolean" ? body.defaultUsePersonal : undefined,
      defaultAutoExtract:
        typeof body.defaultAutoExtract === "boolean" ? body.defaultAutoExtract : undefined,
      defaultTemporaryMode:
        typeof body.defaultTemporaryMode === "boolean" ? body.defaultTemporaryMode : undefined
    });
    return reply.code(200).send(updated);
  });

  app.post("/api/context-memory/chats/:chatId/init-mode", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const { chatId } = req.params as { chatId: string };
    const body = (req.body ?? {}) as { temporaryMode?: boolean };
    const state = migrator.initializeNewChatMemorySettings(ownerId, chatId, {
      temporaryMode: typeof body.temporaryMode === "boolean" ? body.temporaryMode : undefined
    });
    return reply.code(200).send(state);
  });
}
