import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import type { GoogleDriveController } from "./google-drive-controller.js";

const callbackBodySchema = {
  type: "object",
  required: ["state", "code"],
  additionalProperties: false,
  properties: {
    state: { type: "string", minLength: 8, maxLength: 256 },
    code: { type: "string", minLength: 4, maxLength: 2048 }
  }
} as const;

const callbackQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    state: { type: "string", minLength: 8, maxLength: 256 },
    code: { type: "string", minLength: 4, maxLength: 2048 },
    error: { type: "string", maxLength: 128 }
  }
} as const;

const createBackupBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    backup_set_id: { type: "string", minLength: 6, maxLength: 64 }
  }
} as const;

const archiveParamsSchema = {
  type: "object",
  required: ["archiveId"],
  additionalProperties: false,
  properties: {
    archiveId: { type: "string", minLength: 4, maxLength: 128 }
  }
} as const;

const restoreBodySchema = {
  type: "object",
  required: ["backup_set_id"],
  additionalProperties: false,
  properties: {
    backup_set_id: { type: "string", minLength: 6, maxLength: 64 }
  }
} as const;

const noCache = (reply: { header(name: string, value: string): unknown }) => {
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
};

function requireOwnerSession(
  request: FastifyRequest,
  identityFor: (req: FastifyRequest) => IdentityContext
): { ownerId: string; sessionId: string } {
  const identity = identityFor(request);
  if (!identity || identity.actor.kind !== "owner" || !identity.owner_id) {
    throw new Error("OWNER_AUTH_REQUIRED");
  }
  const rec = identity as unknown as Record<string, unknown>;
  const sessionId =
    typeof rec.session_id === "string" && rec.session_id.length > 0
      ? rec.session_id
      : `owner_session:${identity.owner_id}`;
  return {
    ownerId: identity.owner_id,
    sessionId
  };
}

function statusForDriveError(code: string): number {
  if (
    code === "OWNER_AUTH_REQUIRED" ||
    code === "DRIVE_AUTH_CONTEXT_REQUIRED" ||
    code === "DRIVE_OAUTH_SESSION_MISMATCH"
  ) {
    return 403;
  }
  if (
    code === "DRIVE_OAUTH_STATE_INVALID" ||
    code === "DRIVE_OAUTH_CODE_REQUIRED" ||
    code === "DRIVE_OAUTH_CODE_REPLAYED" ||
    code === "INVALID_DRIVE_OFFSET" ||
    code === "INVALID_BACKUP_SET_ID" ||
    code.startsWith("DRIVE_RESTORE_")
  ) {
    return 400;
  }
  if (code === "DRIVE_ARCHIVE_NOT_FOUND") {
    return 404;
  }
  if (
    code === "DRIVE_ALREADY_CONNECTED" ||
    code === "DRIVE_NOT_CONNECTED" ||
    code === "DRIVE_DISCONNECTED" ||
    code === "DRIVE_CONNECT_EXPIRED" ||
    code === "DRIVE_FOLDER_BUSY" ||
    code === "DRIVE_ARCHIVE_BUSY" ||
    code === "DRIVE_ARCHIVE_EXISTS" ||
    code === "DRIVE_BACKUP_SET_INCOMPLETE" ||
    code === "DRIVE_RETRY_BYTES_REQUIRED" ||
    code === "OWNER_DATA_FENCED"
  ) {
    return 409;
  }
  return 503;
}

export function registerGoogleDriveRoutes(
  app: FastifyInstance,
  controller: GoogleDriveController,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  app.get("/api/v1/personal-settings/google-drive/status", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerSession(request, identityFor);
      const query = (request.query ?? {}) as { offset?: string };
      const offset = query.offset !== undefined ? Number(query.offset) : 0;
      return controller.overview(ownerId, offset);
    } catch (error) {
      const code = error instanceof Error ? error.message : "DRIVE_STATUS_FAILED";
      return reply.status(statusForDriveError(code)).send({
        error: { code, message: "Не удалось получить статус Google Drive." }
      });
    }
  });

  app.post("/api/v1/personal-settings/google-drive/connect/start", async (request, reply) => {
    noCache(reply);
    try {
      const session = requireOwnerSession(request, identityFor);
      const { authorizationUrl, state } = controller.startOAuthConnect(session);
      return {
        authorization_url: authorizationUrl,
        state
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "DRIVE_CONNECT_START_FAILED";
      return reply.status(statusForDriveError(code)).send({
        error: { code, message: "Не удалось начать подключение Google Drive." }
      });
    }
  });

  // Never log query parameters containing authorization code or state on callback
  app.get(
    "/api/v1/personal-settings/google-drive/connect/callback",
    {
      config: { logLevel: "silent" },
      schema: { querystring: callbackQuerySchema }
    },
    async (request, reply) => {
      noCache(reply);
      try {
        const session = requireOwnerSession(request, identityFor);
        const query = request.query as { state?: string; code?: string; error?: string };
        if (query.error) {
          return reply.status(400).send({
            error: {
              code: "DRIVE_OAUTH_DENIED",
              message: "Подключение Google Drive было отклонено пользователем."
            }
          });
        }
        if (!query.state || !query.code) {
          return reply.status(400).send({
            error: {
              code: "DRIVE_OAUTH_CODE_REQUIRED",
              message: "Отсутствует код авторизации или параметр state."
            }
          });
        }
        return await controller.finishOAuthCallback(session, {
          state: query.state,
          code: query.code
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_OAUTH_CALLBACK_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось завершить подключение Google Drive." }
        });
      }
    }
  );

  app.post(
    "/api/v1/personal-settings/google-drive/connect/callback",
    {
      config: { logLevel: "silent" },
      schema: { body: callbackBodySchema }
    },
    async (request, reply) => {
      noCache(reply);
      try {
        const session = requireOwnerSession(request, identityFor);
        const body = request.body as { state: string; code: string };
        return await controller.finishOAuthCallback(session, body);
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_OAUTH_CALLBACK_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось завершить подключение Google Drive." }
        });
      }
    }
  );

  app.post("/api/v1/personal-settings/google-drive/disconnect", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerSession(request, identityFor);
      return await controller.disconnect(ownerId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "DRIVE_DISCONNECT_FAILED";
      return reply.status(statusForDriveError(code)).send({
        error: { code, message: "Не удалось отключить Google Drive." }
      });
    }
  });

  app.post("/api/v1/personal-settings/google-drive/folder/retry", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerSession(request, identityFor);
      return await controller.retryFolder(ownerId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "DRIVE_FOLDER_RETRY_FAILED";
      return reply.status(statusForDriveError(code)).send({
        error: { code, message: "Не удалось проверить или создать папку Kosmora на Google Drive." }
      });
    }
  });

  app.post(
    "/api/v1/personal-settings/google-drive/backups",
    { schema: { body: createBackupBodySchema } },
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerSession(request, identityFor);
        const body = (request.body ?? {}) as { backup_set_id?: string };
        const result = await controller.createBackupCopy(
          ownerId,
          body.backup_set_id ? { backupSetId: body.backup_set_id } : {}
        );
        return reply.status(result.backupSet.complete ? 200 : 202).send(result);
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_BACKUP_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось сохранить архивную копию на Google Drive." }
        });
      }
    }
  );

  app.post(
    "/api/v1/personal-settings/google-drive/backups/:archiveId/retry",
    { schema: { params: archiveParamsSchema } },
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerSession(request, identityFor);
        const { archiveId } = request.params as { archiveId: string };
        const archive = await controller.retryArchiveUpload(ownerId, archiveId);
        return { archive, overview: controller.overview(ownerId) };
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_RETRY_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось повторить отправку части архива." }
        });
      }
    }
  );

  app.post(
    "/api/v1/personal-settings/google-drive/backups/:archiveId/reconcile",
    { schema: { params: archiveParamsSchema } },
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerSession(request, identityFor);
        const { archiveId } = request.params as { archiveId: string };
        const archive = await controller.reconcileArchive(ownerId, archiveId);
        return { archive, overview: controller.overview(ownerId) };
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_RECONCILE_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось сверить состояние архива на Google Drive." }
        });
      }
    }
  );

  app.post(
    "/api/v1/personal-settings/google-drive/restore/preview",
    { schema: { body: restoreBodySchema } },
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerSession(request, identityFor);
        const { backup_set_id: backupSetId } = request.body as { backup_set_id: string };
        return await controller.previewRestoreFromDrive(ownerId, backupSetId);
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_RESTORE_PREVIEW_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось подготовить предпросмотр восстановления." }
        });
      }
    }
  );

  app.post(
    "/api/v1/personal-settings/google-drive/restore",
    { schema: { body: restoreBodySchema } },
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerSession(request, identityFor);
        const { backup_set_id: backupSetId } = request.body as { backup_set_id: string };
        return await controller.executeRestoreFromDrive(ownerId, backupSetId);
      } catch (error) {
        const code = error instanceof Error ? error.message : "DRIVE_RESTORE_FAILED";
        return reply.status(statusForDriveError(code)).send({
          error: { code, message: "Не удалось выполнить транзакционное восстановление архива." }
        });
      }
    }
  );
}
