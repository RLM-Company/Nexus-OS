import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IdentityContext } from "@cosmora/contracts";
import { DriveStorageError, GoogleDriveArchiveTransport } from "./google-drive.js";
import type { GoogleDriveAuthorization } from "./google-drive-authorization.js";
import type { GoogleDriveBackups } from "./google-drive-backups.js";
import type { DriveConnectTicket, GoogleDriveStore } from "./google-drive-store.js";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const nonce = (v: string) => /^[A-Za-z0-9_-]{43}$/.test(v);
type Pending = {
  state: string;
  ticket: DriveConnectTicket;
  session: string;
  binding: string;
  proof: string;
  until: number;
};
export type DriveFinish = { state: string; proof: string; code?: string; denied?: boolean };

/** A browser proof held in sessionStorage binds the Google redirect to the tab
 * that started consent, even when the authenticating proxy strips all cookies.
 * It is not a provider token. PKCE verifiers and all Google credentials stay here.
 */
export class GoogleDriveConnection {
  readonly #pending = new Map<string, Pending>();
  readonly #finishing = new Map<string, Promise<unknown>>();
  readonly #blocked = new Set<string>();
  readonly #rate = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly store: GoogleDriveStore,
    private readonly authorization: GoogleDriveAuthorization,
    private readonly backups: GoogleDriveBackups,
    private readonly origin: string,
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now
  ) {}
  private prune() {
    for (const [key, value] of this.#pending)
      if (value.until <= this.now()) {
        this.authorization.cancel(value.ticket.ownerId, value.binding, value.state);
        this.#pending.delete(key);
      }
    for (const [key, value] of this.#rate) if (value.until <= this.now()) this.#rate.delete(key);
  }
  private allowed(identity: IdentityContext) {
    if (this.#blocked.has(identity.owner_id)) throw new DriveStorageError("OWNER_DATA_FENCED");
    this.prune();
    const key = hash(identity.owner_id + "\0" + identity.session_id);
    const rate = this.#rate.get(key) ?? { count: 0, until: this.now() + 60_000 };
    if (this.#rate.size >= 1024 && !this.#rate.has(key))
      throw new DriveStorageError("DRIVE_AUTH_BUSY");
    if (++rate.count > 10) throw new DriveStorageError("DRIVE_AUTH_BUSY");
    this.#rate.set(key, rate);
  }
  begin(identity: IdentityContext) {
    this.allowed(identity);
    if (this.#finishing.has(identity.owner_id) || this.#pending.size >= 256)
      throw new DriveStorageError("DRIVE_AUTH_BUSY");
    const ticket = this.store.beginConnect(identity.owner_id),
      proof = randomBytes(32).toString("base64url");
    const binding = hash(identity.session_id + "\0" + proof);
    const start = this.authorization.begin(identity.owner_id, binding);
    const state = new URL(start.authorizationUrl).searchParams.get("state")!;
    this.#pending.set(hash(state), {
      state,
      ticket,
      session: hash(identity.session_id),
      binding,
      proof: hash(proof),
      until: start.expiresAt
    });
    return { authorization_url: start.authorizationUrl, state, proof, expires_at: start.expiresAt };
  }
  private pending(identity: IdentityContext, state: string): Pending {
    if (!nonce(state)) throw new DriveStorageError("DRIVE_AUTH_FAILED");
    const item = this.#pending.get(hash(state));
    if (
      !item ||
      item.until <= this.now() ||
      item.ticket.ownerId !== identity.owner_id ||
      item.session !== hash(identity.session_id)
    )
      throw new DriveStorageError("DRIVE_AUTH_FAILED");
    return item;
  }
  private assertTicket(item: Pending) {
    if (this.#blocked.has(item.ticket.ownerId)) throw new DriveStorageError("OWNER_DATA_FENCED");
    this.store.assertConnectTicket(item.ticket);
  }
  callback(
    identity: IdentityContext,
    query: { state?: string; code?: string; error?: string }
  ): string {
    const target = new URL("/personal-settings", this.origin);
    try {
      if (this.#blocked.has(identity.owner_id)) throw new DriveStorageError("OWNER_DATA_FENCED");
      const item = this.pending(identity, query.state ?? "");
      this.assertTicket(item);
      if ((!query.code || query.code.length > 2048) && !query.error)
        throw new DriveStorageError("DRIVE_AUTH_FAILED");
      target.hash = new URLSearchParams({
        drive_state: item.state,
        ...(query.error ? { drive_error: "denied" } : { drive_code: query.code! })
      }).toString();
    } catch {
      target.hash = "drive_result=failed";
    }
    // Nothing is exchanged or stored until the originating tab proves possession.
    return target.href;
  }
  async finish(
    identity: IdentityContext,
    input: DriveFinish
  ): Promise<{ state: "connected" | "pending" | "cancelled" }> {
    this.allowed(identity);
    const item = this.pending(identity, input.state);
    if (
      !nonce(input.proof) ||
      !timingSafeEqual(Buffer.from(item.proof, "hex"), Buffer.from(hash(input.proof), "hex"))
    )
      throw new DriveStorageError("DRIVE_AUTH_FAILED");
    if (this.#finishing.has(identity.owner_id) || this.#finishing.size >= 4)
      throw new DriveStorageError("DRIVE_AUTH_BUSY");
    this.#pending.delete(hash(input.state));
    if (input.denied) {
      this.authorization.cancel(identity.owner_id, item.binding, item.state);
      return { state: "cancelled" };
    }
    const job = Promise.resolve().then(async () => {
      this.assertTicket(item);
      const grant = await this.authorization.finish({
        ownerId: identity.owner_id,
        sessionId: item.binding,
        state: item.state,
        code: input.code ?? ""
      });
      this.assertTicket(item);
      const transport = new GoogleDriveArchiveTransport(
        identity.owner_id,
        () => {
          this.assertTicket(item);
          return Promise.resolve(grant.accessToken);
        },
        this.request
      );
      const folderId = await transport.generateId();
      this.assertTicket(item);
      const context = this.store.connect(item.ticket, grant, folderId);
      try {
        await this.backups.initializeFolder(identity.owner_id);
        if (this.store.context(identity.owner_id).connectionId !== context.connectionId)
          throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
        return { state: "connected" as const };
      } catch (error) {
        if (this.store.context(identity.owner_id).connectionId !== context.connectionId)
          throw error;
        return { state: "pending" as const };
      }
    });
    this.#finishing.set(identity.owner_id, job);
    try {
      return await job;
    } finally {
      if (this.#finishing.get(identity.owner_id) === job) this.#finishing.delete(identity.owner_id);
    }
  }
  private cancelOwner(ownerId: string) {
    for (const [key, item] of this.#pending)
      if (item.ticket.ownerId === ownerId) {
        this.authorization.cancel(ownerId, item.binding, item.state);
        this.#pending.delete(key);
      }
  }
  async disconnect(ownerId: string) {
    this.cancelOwner(ownerId);
    await Promise.all([
      this.backups.disconnect(ownerId),
      this.#finishing.get(ownerId)?.catch(() => {})
    ]);
  }
  async quiesce(ownerId: string) {
    this.#blocked.add(ownerId);
    this.cancelOwner(ownerId);
    await Promise.all([
      this.backups.quiesce(ownerId),
      this.#finishing.get(ownerId)?.catch(() => {})
    ]);
  }
  resume(ownerId: string) {
    this.#blocked.delete(ownerId);
    this.backups.resume(ownerId);
  }
  check(ownerId: string) {
    return this.backups.initializeFolder(ownerId);
  }
  retryFolder(ownerId: string) {
    return this.backups.retryFolder(ownerId);
  }
}
