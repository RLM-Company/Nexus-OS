import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";

type GoogleClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iat?: number;
  nonce?: string;
};
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const KEYS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const decode = (part: string): unknown =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const readJson = async (response: Response): Promise<unknown> => {
  if (!response.ok || !response.body) throw Error("GOOGLE_UNAVAILABLE");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 100_000) {
      await reader.cancel();
      throw Error("GOOGLE_RESPONSE_TOO_LARGE");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
};

export const newOAuthTransaction = () => {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  return { state, nonce, verifier, at: Date.now() };
};
export type OAuthTransaction = ReturnType<typeof newOAuthTransaction>;

export class GoogleIdentity {
  private keys: Jwk[] = [];
  private keysUntil = 0;
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    if (!clientId || !clientSecret || !redirectUri.startsWith("https://"))
      throw Error("Google OAuth configuration is incomplete");
  }

  authorizationUrl(transaction: OAuthTransaction): string {
    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: createHash("sha256").update(transaction.verifier).digest("base64url"),
      code_challenge_method: "S256"
    }).toString();
    return url.toString();
  }

  async exchange(
    code: string,
    transaction: OAuthTransaction
  ): Promise<{ email: string; subject: string }> {
    if (!code || code.length > 2048 || this.now() - transaction.at > 10 * 60 * 1000)
      throw Error("GOOGLE_AUTH_FAILED");
    const response = await this.request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
        code_verifier: transaction.verifier
      }),
      signal: AbortSignal.timeout(5000)
    });
    const token = (await readJson(response)) as { id_token?: unknown };
    if (typeof token.id_token !== "string" || token.id_token.length > 16_000)
      throw Error("GOOGLE_AUTH_FAILED");
    return this.verifyIdToken(token.id_token, transaction.nonce);
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<{ email: string; subject: string }> {
    try {
      const parts = idToken.split(".");
      if (parts.length !== 3 || parts.some((part) => !part || part.length > 12_000))
        throw Error("JWT_FORMAT");
      const header = decode(parts[0]!) as { alg?: string; kid?: string };
      const claims = decode(parts[1]!) as GoogleClaims;
      if (header.alg !== "RS256" || !header.kid) throw Error("JWT_ALGORITHM");
      let key = this.keys.find((item) => item.kid === header.kid);
      if (!key || this.now() >= this.keysUntil) {
        const response = await this.request(KEYS_ENDPOINT, { signal: AbortSignal.timeout(5000) });
        const body = (await readJson(response)) as { keys?: Jwk[] };
        if (!Array.isArray(body.keys) || body.keys.length > 10) throw Error("JWKS_INVALID");
        this.keys = body.keys.filter((item) => item.kty === "RSA" && item.use === "sig");
        this.keysUntil = this.now() + 60 * 60 * 1000;
        key = this.keys.find((item) => item.kid === header.kid);
      }
      if (
        !key ||
        !verify(
          "RSA-SHA256",
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey({ key, format: "jwk" }),
          Buffer.from(parts[2]!, "base64url")
        )
      )
        throw Error("JWT_SIGNATURE");
      const seconds = this.now() / 1000;
      if (
        !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss ?? "") ||
        claims.aud !== this.clientId ||
        !Number.isFinite(claims.exp) ||
        claims.exp! <= seconds ||
        !Number.isFinite(claims.iat) ||
        claims.iat! > seconds + 60 ||
        claims.nonce !== nonce ||
        claims.email_verified !== true ||
        typeof claims.email !== "string" ||
        typeof claims.sub !== "string"
      )
        throw Error("JWT_CLAIMS");
      return { email: claims.email, subject: claims.sub };
    } catch {
      throw Error("GOOGLE_AUTH_FAILED");
    }
  }
}
