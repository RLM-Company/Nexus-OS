import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { GoogleDriveConnectionView, IdentityContext } from "@cosmora/contracts";
import { DRIVE_OFFICE_FILE_MAX_BYTES, DRIVE_OFFICE_FILE_MAX_NAME } from "@cosmora/contracts";
import { DriveStorageError } from "./google-drive.js";
import type { GoogleDriveRuntime } from "./google-drive-runtime.js";
import { selectedOfficeFile, snapshotHash } from "./google-drive-snapshot.js";

export const DRIVE_ROUTE = "/api/v1/storage/drive";
export const safeDriveLogUrl = (url: string) =>
  url.startsWith(DRIVE_ROUTE) ? url.split("?", 1)[0]! : url;
export function registerGoogleDriveRoutes(
  app: FastifyInstance,
  runtime: GoogleDriveRuntime | undefined,
  origin: string,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  origin = new URL(origin).origin;
  const view = (ownerId: string): GoogleDriveConnectionView => {
    const row = runtime?.store.status(ownerId),
      counts = runtime?.bundleStore.counts(ownerId);
    return {
      configured: Boolean(runtime?.connection),
      state: !runtime?.connection
        ? "unavailable"
        : !row?.connection_id
          ? "disconnected"
          : row.folder_state === "ready"
            ? "connected"
            : "preparing",
      can_disconnect: Boolean(row?.connection_id),
      can_retry: Boolean(runtime?.connection && row?.folder_state === "uncertain"),
      archive_count: counts?.total ?? 0,
      pending_count: counts?.pending ?? 0
    };
  };
  app.register((routes) => {
    routes.setValidatorCompiler(TypeBoxValidatorCompiler);
    routes.addHook("onRequest", (request, reply, done) => {
      reply
        .header("Cache-Control", "private, no-store")
        .header("Referrer-Policy", "no-referrer")
        .header("X-Content-Type-Options", "nosniff");
      if (request.method !== "GET" && request.headers.origin !== origin) {
        void reply.code(403).send({ error: { code: "DRIVE_ORIGIN_DENIED" } });
        return;
      }
      done();
    });
    routes.setErrorHandler((error, _request, reply) => {
      const e = error instanceof DriveStorageError ? error : null;
      const validation = typeof error === "object" && error !== null && "validation" in error;
      const code = e?.code ?? (validation ? "DRIVE_INVALID_REQUEST" : "DRIVE_REQUEST_FAILED");
      const conflict = new Set([
        "OWNER_DATA_FENCED",
        "DRIVE_CONNECTION_CHANGED",
        "DRIVE_GRANT_CHANGED",
        "RESTORE_STALE",
        "BACKUP_INCOMPLETE",
        "BACKUP_CACHE_UNAVAILABLE",
        "BACKUP_INVALID_PART",
        "DRIVE_FOLDER_NOT_READY",
        "DRIVE_OPERATION_CONFLICT",
        "DRIVE_ARCHIVE_CHANGED",
        "DRIVE_FOLDER_CHANGED",
        "DRIVE_LEASE_CHANGED",
        "DRIVE_ARCHIVE_BUSY",
        "DRIVE_FOLDER_BUSY"
      ]).has(code);
      const status =
        code === "BACKUP_NOT_FOUND"
          ? 404
          : ["BACKUP_TOO_LARGE", "BACKUP_CACHE_FULL", "BACKUP_JOURNAL_FULL"].includes(code)
            ? 413
            : code === "BACKUP_BUSY"
              ? 429
              : [
                    "BACKUP_INVALID",
                    "BACKUP_INVALID_SELECTION",
                    "BACKUP_INVALID_OFFICE_FILE",
                    "BACKUP_EMPTY"
                  ].includes(code)
                ? 400
                : conflict
                  ? 409
                  : validation
                    ? 400
                    : code === "DRIVE_NOT_CONFIGURED"
                      ? 503
                      : ["DRIVE_AUTH_BUSY", "DRIVE_OWNER_BUSY", "DRIVE_BUSY"].includes(code)
                        ? 429
                        : ["DRIVE_AUTH_FAILED", "DRIVE_AUTH_INVALID_GRANT"].includes(code)
                          ? 400
                          : 502;
      return reply.code(status).send({ error: { code } });
    });
    const connection = () => {
      if (!runtime?.connection) throw new DriveStorageError("DRIVE_NOT_CONFIGURED");
      return runtime.connection;
    };
    const bundles = () => {
      if (!runtime?.bundles) throw new DriveStorageError("DRIVE_NOT_CONFIGURED");
      return runtime.bundles;
    };
    const empty = { schema: { body: Type.Object({}, { additionalProperties: false }) } };
    routes.get(DRIVE_ROUTE, (r) => view(identityFor(r).owner_id));
    routes.get(DRIVE_ROUTE + "/link", (r) => {
      if (!runtime) throw new DriveStorageError("DRIVE_NOT_CONFIGURED");
      const row = runtime.store.status(identityFor(r).owner_id);
      if (
        !row?.folder_id ||
        row.folder_state !== "ready" ||
        !/^[A-Za-z0-9_-]{5,200}$/.test(row.folder_id)
      )
        throw new DriveStorageError("DRIVE_FOLDER_NOT_READY");
      return {
        url: `https://drive.google.com/drive/folders/${encodeURIComponent(row.folder_id)}`
      };
    });
    routes.post(DRIVE_ROUTE + "/connect", empty, (r) => connection().begin(identityFor(r)));
    routes.get<{ Querystring: { state?: string; code?: string; error?: string } }>(
      DRIVE_ROUTE + "/callback",
      {
        schema: {
          querystring: Type.Object({
            state: Type.Optional(Type.String({ maxLength: 43 })),
            code: Type.Optional(Type.String({ maxLength: 2048 })),
            error: Type.Optional(Type.String({ maxLength: 128 }))
          })
        }
      },
      (r, reply) => {
        const target =
          runtime?.connection?.callback(identityFor(r), r.query) ??
          `${origin}/personal-settings#drive_result=failed`;
        return reply.code(303).header("Location", target).send();
      }
    );
    routes.post<{ Body: { state: string; proof: string; code?: string; denied?: boolean } }>(
      DRIVE_ROUTE + "/finish",
      {
        schema: {
          body: Type.Union([
            Type.Object(
              {
                state: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
                proof: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
                code: Type.String({ minLength: 1, maxLength: 2048 })
              },
              { additionalProperties: false }
            ),
            Type.Object(
              {
                state: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
                proof: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
                denied: Type.Literal(true)
              },
              { additionalProperties: false }
            )
          ])
        }
      },
      async (r) => {
        const result = await connection().finish(identityFor(r), r.body);
        return { result: result.state, ...view(identityFor(r).owner_id) };
      }
    );
    routes.post(DRIVE_ROUTE + "/disconnect", empty, async (r) => {
      const owner = identityFor(r).owner_id;
      if (runtime?.connection)
        await Promise.all([
          runtime.connection.disconnect(owner),
          runtime.bundles?.waitForOwner(owner)
        ]);
      else runtime?.store.disconnect(owner);
      return view(owner);
    });
    routes.post(DRIVE_ROUTE + "/check", empty, async (r) => {
      await connection().check(identityFor(r).owner_id);
      return view(identityFor(r).owner_id);
    });
    const uuid = Type.String({ pattern: "^[a-f0-9-]{36}$" });
    const params = Type.Object({ id: uuid }, { additionalProperties: false });
    routes.get<{ Querystring: { offset?: number } }>(
      DRIVE_ROUTE + "/backups",
      {
        schema: {
          querystring: Type.Object(
            { offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })) },
            { additionalProperties: false }
          )
        }
      },
      (r) => {
        const items = runtime?.bundleStore.list(identityFor(r).owner_id, r.query.offset) ?? [];
        return { items, has_more: items.length === 100 };
      }
    );
    routes.get(
      DRIVE_ROUTE + "/sources",
      (r) =>
        runtime?.bundleStore.sources(identityFor(r).owner_id) ?? {
          items: [],
          chats: [],
          files: [],
          file_selection: false
        }
    );
    routes.post<{
      Body: {
        operation_id: string;
        chat_ids?: string[];
        file_ids?: string[];
        include_results: boolean;
        office_file?: { name: string; bytes: string };
      };
    }>(
      DRIVE_ROUTE + "/backups",
      {
        bodyLimit: 3_250_000,
        schema: {
          body: Type.Object(
            {
              operation_id: uuid,
              chat_ids: Type.Optional(
                Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 2000 })
              ),
              file_ids: Type.Optional(
                Type.Array(Type.String({ pattern: "^(kosmora|user)_[a-f0-9]{32}$" }), {
                  maxItems: 2000
                })
              ),
              include_results: Type.Boolean(),
              office_file: Type.Optional(
                Type.Object(
                  {
                    name: Type.String({ minLength: 1, maxLength: DRIVE_OFFICE_FILE_MAX_NAME }),
                    bytes: Type.String({
                      minLength: 4,
                      maxLength: Math.ceil(DRIVE_OFFICE_FILE_MAX_BYTES / 3) * 4
                    })
                  },
                  { additionalProperties: false }
                )
              )
            },
            { additionalProperties: false }
          )
        }
      },
      (r) =>
        bundles().save(identityFor(r).owner_id, r.body.operation_id, {
          include_results: r.body.include_results,
          ...(r.body.chat_ids ? { chat_ids: r.body.chat_ids } : {}),
          ...(r.body.file_ids ? { file_ids: r.body.file_ids } : {}),
          ...(r.body.office_file
            ? { office_file: selectedOfficeFile(r.body.office_file.name, r.body.office_file.bytes) }
            : {})
        })
    );
    for (const action of ["retry", "preview", "discard", "cancel-preview"] as const)
      routes.post<{ Params: { id: string } }>(
        DRIVE_ROUTE + "/backups/:id/" + action,
        { schema: { params, body: Type.Object({}, { additionalProperties: false }) } },
        (r) => {
          const owner = identityFor(r).owner_id;
          if (
            (action === "discard" || action === "cancel-preview") &&
            runtime &&
            !runtime.bundles
          ) {
            runtime.bundleStore.clearLocal(owner, r.params.id, action === "discard");
            return { cleared: true };
          }
          const service = bundles();
          return action === "retry"
            ? service.retry(owner, r.params.id)
            : action === "preview"
              ? service.preview(owner, r.params.id)
              : action === "discard"
                ? service.discard(owner, r.params.id)
                : service.cancelPreview(owner, r.params.id);
        }
      );
    routes.post<{ Params: { id: string }; Body: { token: string; operation_id: string } }>(
      DRIVE_ROUTE + "/backups/:id/restore",
      {
        schema: {
          params,
          body: Type.Object(
            { token: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }), operation_id: uuid },
            { additionalProperties: false }
          )
        }
      },
      (r) =>
        bundles().restore(identityFor(r).owner_id, r.params.id, r.body.token, r.body.operation_id)
    );
    routes.get<{ Querystring: { offset?: number } }>(
      DRIVE_ROUTE + "/restored-files",
      {
        schema: {
          querystring: Type.Object(
            { offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })) },
            { additionalProperties: false }
          )
        }
      },
      (r) => {
        const items = runtime?.bundleStore.files(identityFor(r).owner_id, r.query.offset) ?? [];
        return { items, has_more: items.length === 200 };
      }
    );
    routes.get<{ Params: { id: string } }>(
      DRIVE_ROUTE + "/restored-files/:id/office",
      { schema: { params } },
      (r) => {
        const file = runtime?.bundleStore.file(identityFor(r).owner_id, r.params.id);
        if (!(file?.content instanceof Uint8Array)) throw new DriveStorageError("BACKUP_NOT_FOUND");
        const bytes = Buffer.from(file.content);
        if (bytes.length > DRIVE_OFFICE_FILE_MAX_BYTES || snapshotHash(bytes) !== file.sha256)
          throw new DriveStorageError("BACKUP_INVALID");
        return {
          name: file.name,
          bytes: bytes.toString("base64"),
          version: "sha256:" + file.sha256
        };
      }
    );
    routes.get<{ Params: { id: string } }>(
      DRIVE_ROUTE + "/restored-files/:id",
      { schema: { params } },
      (r, reply) => {
        const file = runtime?.bundleStore.file(identityFor(r).owner_id, r.params.id);
        if (!file) throw new DriveStorageError("BACKUP_NOT_FOUND");
        return reply
          .header("Content-Type", "application/octet-stream")
          .header("Content-Security-Policy", "default-src 'none'; sandbox")
          .header(
            "Content-Disposition",
            `attachment; filename="kosmora-result.txt"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`
          )
          .send(
            typeof file.content === "string"
              ? Buffer.from(file.content, "utf8")
              : Buffer.from(file.content)
          );
      }
    );
    routes.post(DRIVE_ROUTE + "/retry-folder", empty, async (r) => {
      await connection().retryFolder(identityFor(r).owner_id);
      return view(identityFor(r).owner_id);
    });
  });
}
