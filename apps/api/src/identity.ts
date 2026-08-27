import type { IdentityContext } from "@cosmora/contracts";
import type { IdentityStore } from "@cosmora/db";
import type { FastifyRequest } from "fastify";

export interface RequestIdentityResolver {
  resolve(request: FastifyRequest): Promise<IdentityContext | null>;
}

export const LOCAL_DEVELOPMENT_IDENTITY: IdentityContext = Object.freeze({
  owner_id: "local-owner",
  actor_id: "local-owner",
  actor_kind: "owner",
  session_id: "local-development-session",
  assurance: "local",
  authenticated_at: "2026-08-27T00:00:00.000Z",
  expires_at: "9999-12-31T23:59:59.999Z"
});

export class StaticIdentityResolver implements RequestIdentityResolver {
  readonly #identity: IdentityContext;

  constructor(identity: IdentityContext) {
    this.#identity = Object.freeze({ ...identity });
  }

  resolve(_request: FastifyRequest): Promise<IdentityContext> {
    return Promise.resolve(this.#identity);
  }
}

export class BearerSessionIdentityResolver implements RequestIdentityResolver {
  readonly #identityStore: IdentityStore;

  constructor(identityStore: IdentityStore) {
    this.#identityStore = identityStore;
  }

  resolve(request: FastifyRequest): Promise<IdentityContext | null> {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string") return Promise.resolve(null);
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match?.[1]) return Promise.resolve(null);
    return Promise.resolve(this.#identityStore.resolveSession(match[1]));
  }
}
