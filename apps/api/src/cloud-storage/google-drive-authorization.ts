import { createHash, randomBytes } from "node:crypto";
import { DRIVE_FILE_SCOPE, DriveStorageError, readBoundedDriveBody } from "./google-drive.js";

export interface DriveGrant {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: typeof DRIVE_FILE_SCOPE;
}
type Pending = { ownerId: string; sessionHash: string; verifier: string; at: number };
const tokenValue = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9._~+/-]{1,8190}={0,2}$/.test(v);
const hash = (v: string) => createHash("sha256").update(v).digest("base64url");
export function validDriveGrant(v: unknown): v is DriveGrant {
  if (!v || typeof v !== "object") return false;
  const g = v as Partial<DriveGrant>;
  return (
    tokenValue(g.accessToken) &&
    tokenValue(g.refreshToken) &&
    g.scope === DRIVE_FILE_SCOPE &&
    Number.isSafeInteger(g.expiresAt) &&
    g.expiresAt! > 0
  );
}

/** Dedicated Drive consent; never extends the Google sign-in flow's scopes.
 * Pending grants are short-lived and consumed once. A process restart invalidates
 * them; the user starts connection again. Tokens must only enter an encrypted
 * owner-bound server store, never an HTTP response or a model context.
 */
export class GoogleDriveAuthorization {
  readonly #pending = new Map<string, Pending>();
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;
  readonly #request: typeof fetch;
  readonly #now: () => number;
  constructor(
    config: { clientId: string; clientSecret: string; redirectUri: string },
    request: typeof fetch = fetch,
    now = Date.now
  ) {
    let uri: URL;
    try {
      uri = new URL(config.redirectUri);
    } catch {
      throw new DriveStorageError("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
    }
    if (
      uri.protocol !== "https:" ||
      uri.username ||
      uri.password ||
      uri.hash ||
      uri.search ||
      !config.clientId ||
      config.clientId.length > 512 ||
      !config.clientSecret ||
      config.clientSecret.length > 4096
    )
      throw new DriveStorageError("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
    this.#clientId = config.clientId;
    this.#clientSecret = config.clientSecret;
    this.#redirectUri = uri.href;
    this.#request = request;
    this.#now = now;
  }

  begin(ownerId: string, sessionId: string): { authorizationUrl: string; expiresAt: number } {
    if (!ownerId || ownerId.length > 128 || !sessionId || sessionId.length > 8192)
      throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    const at = this.#now();
    for (const [key, item] of this.#pending)
      if (at - item.at >= 600_000 || at < item.at) this.#pending.delete(key);
    // At most one pending flow per authenticated owner/session.
    const sessionHash = hash(sessionId);
    for (const [key, item] of this.#pending)
      if (item.ownerId === ownerId && item.sessionHash === sessionHash) this.#pending.delete(key);
    if (this.#pending.size >= 1024) throw new DriveStorageError("DRIVE_AUTH_BUSY");
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    this.#pending.set(hash(state), { ownerId, sessionHash, verifier, at });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: this.#redirectUri,
      response_type: "code",
      scope: DRIVE_FILE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: hash(verifier),
      code_challenge_method: "S256"
    }).toString();
    return { authorizationUrl: url.href, expiresAt: at + 600_000 };
  }

  async finish(input: {
    ownerId: string;
    sessionId: string;
    state: string;
    code: string;
  }): Promise<DriveGrant> {
    input = { ...input };
    if (
      !input.ownerId ||
      input.ownerId.length > 128 ||
      !input.sessionId ||
      input.sessionId.length > 8192 ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
      !input.code ||
      input.code.length > 2048
    )
      throw new DriveStorageError("DRIVE_AUTH_FAILED");
    const key = hash(input.state);
    const pending = this.#pending.get(key);
    if (
      !pending ||
      pending.ownerId !== input.ownerId ||
      pending.sessionHash !== hash(input.sessionId) ||
      this.#now() < pending.at ||
      this.#now() - pending.at >= 600_000
    )
      throw new DriveStorageError("DRIVE_AUTH_FAILED");
    this.#pending.delete(key); // Consume BEFORE contacting Google, including uncertain outcomes.
    return this.exchange({
      code: input.code,
      grant_type: "authorization_code",
      code_verifier: pending.verifier,
      redirect_uri: this.#redirectUri
    });
  }

  async refresh(grant: DriveGrant): Promise<DriveGrant> {
    grant = { ...grant };
    if (!validDriveGrant(grant)) throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    return this.exchange({ grant_type: "refresh_token", refresh_token: grant.refreshToken }, grant);
  }

  private async exchange(
    fields: Record<string, string>,
    previous?: DriveGrant
  ): Promise<DriveGrant> {
    let data: Record<string, unknown>;
    try {
      const response = await this.#request("https://oauth2.googleapis.com/token", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...fields,
          client_id: this.#clientId,
          client_secret: this.#clientSecret
        })
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error();
      }
      const value: unknown = JSON.parse(
        (await readBoundedDriveBody(response, 32_768)).toString("utf8")
      );
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
      data = value as Record<string, unknown>;
    } catch {
      throw new DriveStorageError("DRIVE_TOKEN_EXCHANGE_FAILED");
    }
    // Missing scope is allowed only on refresh of a previously validated narrow grant.
    if (
      (data.scope ?? previous?.scope) !== DRIVE_FILE_SCOPE ||
      data.token_type !== "Bearer" ||
      !Number.isSafeInteger(data.expires_in) ||
      (data.expires_in as number) < 1 ||
      (data.expires_in as number) > 86400
    )
      throw new DriveStorageError("DRIVE_AUTH_INVALID_GRANT");
    const grant = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? previous?.refreshToken,
      expiresAt: this.#now() + (data.expires_in as number) * 1000,
      scope: DRIVE_FILE_SCOPE
    };
    if (!validDriveGrant(grant)) throw new DriveStorageError("DRIVE_AUTH_INVALID_GRANT");
    return grant;
  }
}
