import type { FastifyRequest } from "fastify";
import type { DeveloperApiStore } from "@cosmora/db";
import type { IdentityContext } from "@cosmora/contracts";
import type { RequestIdentityResolver } from "../identity.js";

/**
 * Developer-key Bearer resolver. Returns an owner-bound identity so the existing
 * owner gate applies; `actor_id` identifies the key for correlation only.
 * Session tokens keep working through the delegated resolver.
 */
export function createDeveloperIdentityResolver(
  keys: DeveloperApiStore,
  sessions: RequestIdentityResolver,
  now = () => new Date()
): RequestIdentityResolver {
  return {
    async resolve(request: FastifyRequest): Promise<IdentityContext | null> {
      const header = request.headers.authorization;
      if (typeof header !== "string" || !/^Bearer cdev_[A-Za-z0-9_-]+$/u.test(header))
        return sessions.resolve(request);
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
