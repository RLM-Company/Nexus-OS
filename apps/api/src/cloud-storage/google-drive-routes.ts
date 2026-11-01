import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { GoogleDriveConnectionView, IdentityContext } from "@cosmora/contracts";
import { DriveStorageError } from "./google-drive.js";
import type { GoogleDriveRuntime } from "./google-drive-runtime.js";

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
      counts = runtime?.store.archiveCounts(ownerId);
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
      const status = validation
        ? 400
        : code === "DRIVE_NOT_CONFIGURED"
          ? 503
          : ["DRIVE_AUTH_BUSY", "DRIVE_OWNER_BUSY", "DRIVE_BUSY"].includes(code)
            ? 429
            : ["OWNER_DATA_FENCED", "DRIVE_CONNECTION_CHANGED", "DRIVE_GRANT_CHANGED"].includes(
                  code
                )
              ? 409
              : ["DRIVE_AUTH_FAILED", "DRIVE_AUTH_INVALID_GRANT"].includes(code)
                ? 400
                : 502;
      return reply.code(status).send({ error: { code } });
    });
    const connection = () => {
      if (!runtime?.connection) throw new DriveStorageError("DRIVE_NOT_CONFIGURED");
      return runtime.connection;
    };
    const empty = { schema: { body: Type.Object({}, { additionalProperties: false }) } };
    routes.get(DRIVE_ROUTE, (r) => view(identityFor(r).owner_id));
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
      if (runtime?.connection) await runtime.connection.disconnect(owner);
      else runtime?.store.disconnect(owner);
      return view(owner);
    });
    routes.post(DRIVE_ROUTE + "/check", empty, async (r) => {
      await connection().check(identityFor(r).owner_id);
      return view(identityFor(r).owner_id);
    });
    routes.post(DRIVE_ROUTE + "/retry-folder", empty, async (r) => {
      await connection().retryFolder(identityFor(r).owner_id);
      return view(identityFor(r).owner_id);
    });
  });
}
