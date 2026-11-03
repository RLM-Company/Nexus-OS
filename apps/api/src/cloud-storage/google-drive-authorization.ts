import { createHash, randomBytes } from "node:crypto";
import { DRIVE_FILE_SCOPE, readBoundedDriveBody } from "./google-drive.js";

export interface DriveGrant {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: typeof DRIVE_FILE_SCOPE;
}

export function validDriveGrant(v: unknown): v is DriveGrant {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.accessToken === "string" &&
    g.accessToken.length > 0 &&
    typeof g.refreshToken === "string" &&
    g.refreshToken.length > 0 &&
    typeof g.expiresAt === "number" &&
    Number.isFinite(g.expiresAt) &&
    g.scope === DRIVE_FILE_SCOPE
  );
}

interface PendingState {
  ownerId: string;
  sessionId: string;
  codeVerifier: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_MAX_BYTES = 32 * 1024;

export class GoogleDriveAuthorization {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingState>();
  private readonly inFlightCodes = new Set<string>();

  constructor(options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    request?: typeof fetch;
    now?: () => number;
  }) {
    if (!options.clientId || !options.clientSecret || !options.redirectUri) {
      throw new Error("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
    }
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.request = options.request ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private pruneExpired(): void {
    const current = this.now();
    for (const [state, record] of this.pending.entries()) {
      if (record.expiresAt <= current) {
        this.pending.delete(state);
      }
    }
  }

  begin(input: { ownerId: string; sessionId: string }): { url: string; state: string } {
    if (!input.ownerId || !input.sessionId) {
      throw new Error("DRIVE_AUTH_CONTEXT_REQUIRED");
    }
    this.pruneExpired();
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    this.pending.set(state, {
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      codeVerifier,
      expiresAt: this.now() + STATE_TTL_MS
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: DRIVE_FILE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state
    };
  }

  async finish(input: {
    ownerId: string;
    sessionId: string;
    state: string;
    code: string;
  }): Promise<DriveGrant> {
    this.pruneExpired();
    const record = this.pending.get(input.state);
    this.pending.delete(input.state);

    if (!record || record.expiresAt <= this.now()) {
      throw new Error("DRIVE_OAUTH_STATE_INVALID");
    }
    if (record.ownerId !== input.ownerId || record.sessionId !== input.sessionId) {
      throw new Error("DRIVE_OAUTH_SESSION_MISMATCH");
    }
    if (typeof input.code !== "string" || !input.code.trim()) {
      throw new Error("DRIVE_OAUTH_CODE_REQUIRED");
    }
    if (this.inFlightCodes.has(input.code)) {
      throw new Error("DRIVE_OAUTH_CODE_REPLAYED");
    }

    this.inFlightCodes.add(input.code);
    try {
      const body = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: record.codeVerifier
      });

      const response = await this.request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        redirect: "error"
      });
      if (!response.ok) {
        throw new Error("DRIVE_OAUTH_EXCHANGE_FAILED");
      }
      const raw = await readBoundedDriveBody(response, OAUTH_MAX_BYTES);
      const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      const accessToken = parsed.access_token;
      const refreshToken = parsed.refresh_token;
      const expiresIn = Number(parsed.expires_in);
      const scope = String(parsed.scope ?? "");
      const scopes = scope.split(/\s+/).filter(Boolean);

      if (
        typeof accessToken !== "string" ||
        !accessToken ||
        typeof refreshToken !== "string" ||
        !refreshToken ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0 ||
        !scopes.includes(DRIVE_FILE_SCOPE)
      ) {
        throw new Error("DRIVE_OAUTH_INVALID_GRANT");
      }

      return {
        accessToken,
        refreshToken,
        expiresAt: this.now() + Math.floor(expiresIn * 1000),
        scope: DRIVE_FILE_SCOPE
      };
    } finally {
      this.inFlightCodes.delete(input.code);
    }
  }

  async refresh(grant: DriveGrant): Promise<DriveGrant> {
    if (!validDriveGrant(grant)) {
      throw new Error("INVALID_DRIVE_GRANT");
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken
    });
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error"
    });
    if (!response.ok) {
      throw new Error("DRIVE_OAUTH_REFRESH_FAILED");
    }
    const raw = await readBoundedDriveBody(response, OAUTH_MAX_BYTES);
    const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const accessToken = parsed.access_token;
    const refreshToken =
      typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 0
        ? parsed.refresh_token
        : grant.refreshToken;
    const expiresIn = Number(parsed.expires_in);

    if (typeof accessToken !== "string" || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("DRIVE_OAUTH_INVALID_GRANT");
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: this.now() + Math.floor(expiresIn * 1000),
      scope: DRIVE_FILE_SCOPE
    };
  }
}
