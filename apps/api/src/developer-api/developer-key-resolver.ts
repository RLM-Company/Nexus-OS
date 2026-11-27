import type { FastifyRequest } from "fastify";
import type { DeveloperApiStore } from "@cosmora/db";
import type { IdentityContext } from "@cosmora/contracts";
import type { RequestIdentityResolver } from "../identity.js";

// Match Fastify's registered route, never a user-controlled URL prefix/query.
// New endpoints must explicitly opt in to client-key authentication.
const CLIENT_ROUTES = new Set([
  "POST /api/v1/developer/v1/chat/completions",
  "POST /api/v1/developer/v1/chat/completions/:requestId/cancel",
  "GET /api/v1/developer/v1/usage",
  "POST /api/v1/developer/v1/tasks",
  "GET /api/v1/developer/v1/tasks",
  "GET /api/v1/developer/v1/tasks/:taskId",
  "POST /api/v1/developer/v1/tasks/:taskId/cancel",
  "POST /api/v1/developer/v1/webhooks",
  "GET /api/v1/developer/v1/webhooks",
  "DELETE /api/v1/developer/v1/webhooks/:webhookId"
]);

/**
 * Client credentials only authenticate explicitly listed external routes, whose
 * handlers enforce key scopes. They never authenticate internal owner routes or
 * key administration. Session tokens use the existing session resolver.
 */
export function createDeveloperIdentityResolver(
  keys: DeveloperApiStore,
  sessions: RequestIdentityResolver,
  now = () => new Date()
): RequestIdentityResolver {
  return {
    async resolve(request: FastifyRequest): Promise<IdentityContext | null> {
      const header = request.headers.authorization;
      if (typeof header !== "string" || !/^Bearer\s+cdev_/iu.test(header))
        return sessions.resolve(request);
      if (
        !/^Bearer cdev_[A-Za-z0-9_-]+$/u.test(header) ||
        !CLIENT_ROUTES.has(`${request.method} ${request.routeOptions.url}`)
      )
        return null;
      const key = keys.resolve(header.slice("Bearer ".length), now());
      return {
        owner_id: key.owner_id,
        actor_id: key.key_id,
        actor_kind: "owner",
        session_id: "developer:" + key.key_id,
        assurance: "local",
        authenticated_at: now().toISOString(),
        expires_at: new Date(now().getTime() + 60_000).toISOString()
      };
    }
  };
}
