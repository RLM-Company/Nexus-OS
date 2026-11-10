import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import {
  compactHistoryByTopicsAndChanges,
  restoreCompactedTopicDetails,
  type CompactionMessageInput,
  type TopicCompactionCapsule
} from "../../../packages/db/src/history-compaction-topic-analyzer.ts";
import {
  ProfileCandidateReconciler,
  type ExtractedProfileCandidate
} from "../../../packages/db/src/profile-candidate-reconciler.ts";
import {
  VpsChatHistoryMigrator,
  type VpsChatMigrationBundle
} from "../../../packages/db/src/vps-chat-history-migrator.ts";

export interface RegisterMemoryAdvancedCompactionRoutesOptions {
  sqlite: DatabaseSync;
  resolveOwnerId?: (req: FastifyRequest) => string | null;
}

export async function registerMemoryAdvancedCompactionRoutes(
  app: FastifyInstance,
  options: RegisterMemoryAdvancedCompactionRoutesOptions
): Promise<void> {
  const reconciler = new ProfileCandidateReconciler(options.sqlite);
  const vpsMigrator = new VpsChatHistoryMigrator(options.sqlite);

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

  app.post("/api/context-memory/compaction/topics", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const body = (req.body ?? {}) as {
      enabled?: boolean;
      messages?: CompactionMessageInput[];
      keepRecentCount?: number;
      maxCapsuleBytes?: number;
      manualSummaryPresent?: boolean;
    };
    const result = compactHistoryByTopicsAndChanges({
      enabled: body.enabled ?? true,
      messages: Array.isArray(body.messages) ? body.messages : [],
      keepRecentCount: body.keepRecentCount,
      maxCapsuleBytes: body.maxCapsuleBytes,
      manualSummaryPresent: body.manualSummaryPresent
    });
    return reply.code(200).send(result);
  });

  app.post("/api/context-memory/compaction/restore-details", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const body = (req.body ?? {}) as {
      chatId?: string;
      capsule?: TopicCompactionCapsule;
    };
    if (!body.chatId || !body.capsule) {
      return reply.code(400).send({ error: "INVALID_REQUEST", message: "chatId and capsule required" });
    }
    const restored = restoreCompactedTopicDetails(
      options.sqlite,
      ownerId,
      body.chatId,
      body.capsule
    );
    return reply.code(200).send({ items: restored });
  });

  app.post("/api/context-memory/profile-candidates/scan", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const body = (req.body ?? {}) as {
      permittedChatIds?: string[];
      permittedProjectIds?: string[];
    };
    const report = reconciler.scanAuthorizedChatCandidates(ownerId, {
      permittedChatIds: body.permittedChatIds,
      permittedProjectIds: body.permittedProjectIds
    });
    return reply.code(200).send(report);
  });

  app.post("/api/context-memory/profile-candidates/promote", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const body = (req.body ?? {}) as {
      candidate?: ExtractedProfileCandidate;
      resolution?: "replace_existing" | "keep_both";
      pinned?: boolean;
    };
    if (!body.candidate) {
      return reply.code(400).send({ error: "INVALID_REQUEST", message: "candidate required" });
    }
    const promoted = reconciler.promoteCandidateToProfile({
      ownerId,
      candidate: body.candidate,
      resolution: body.resolution,
      pinned: body.pinned
    });
    return reply.code(200).send(promoted);
  });

  app.delete("/api/context-memory/entries/:entryId/with-exception", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const { entryId } = req.params as { entryId: string };
    const res = reconciler.deleteMemoryWithAutoExtractException(ownerId, entryId);
    return reply.code(res.deleted ? 200 : 404).send(res);
  });

  app.get("/api/vps-recovery/chat-bundle", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const query = (req.query ?? {}) as { maxBatchSize?: string };
    const maxBatchSize = query.maxBatchSize ? Number(query.maxBatchSize) : 150;
    const bundle = vpsMigrator.exportOwnerHistoryBundle(ownerId, maxBatchSize);
    return reply.code(200).send(bundle);
  });

  app.post("/api/vps-recovery/chat-bundle/restore", async (req, reply) => {
    const ownerId = getOwner(req, reply);
    if (!ownerId) return;
    const bundle = req.body as VpsChatMigrationBundle;
    if (!bundle || bundle.ownerId !== ownerId) {
      return reply.code(403).send({ error: "OWNER_MISMATCH", message: "Bundle ownerId mismatch" });
    }
    const summary = vpsMigrator.restoreOwnerHistoryBundle(bundle);
    return reply.code(200).send(summary);
  });
}
