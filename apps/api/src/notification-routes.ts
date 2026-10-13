import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { NotificationError, type NotificationStore } from "@cosmora/db";

export function registerNotificationRoutes(
  app: FastifyInstance,
  store: NotificationStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  const base = "/api/v1/notifications";
  const error = (
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    cause: unknown
  ) => {
    if (!(cause instanceof NotificationError)) throw cause;
    const status =
      cause.code === "NOT_FOUND" ? 404 : cause.code === "OWNER_DATA_FENCED" ? 423 : 400;
    return reply.code(status).send({ error: { code: cause.code } });
  };
  app.get(base, (request) => store.list(identityFor(request).owner_id));
  app.get(`${base}/preferences`, (request) => store.preferences(identityFor(request).owner_id));
  app.put<{
    Body: {
      in_app_enabled: boolean;
      browser_enabled: boolean;
      quiet_from: string | null;
      quiet_until: string | null;
      time_zone: string;
    };
  }>(
    `${base}/preferences`,
    {
      schema: {
        body: Type.Object(
          {
            in_app_enabled: Type.Boolean(),
            browser_enabled: Type.Boolean(),
            quiet_from: Type.Union([
              Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }),
              Type.Null()
            ]),
            quiet_until: Type.Union([
              Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }),
              Type.Null()
            ]),
            time_zone: Type.String({ minLength: 1, maxLength: 64 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return store.savePreferences(identityFor(request).owner_id, request.body);
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
  app.post<{ Body: { ids: string[] } }>(
    `${base}/read`,
    {
      schema: {
        body: Type.Object(
          {
            ids: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
              minItems: 1,
              maxItems: 100,
              uniqueItems: true
            })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return { marked: store.mark(identityFor(request).owner_id, request.body.ids) };
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
}
