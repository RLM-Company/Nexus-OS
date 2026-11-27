import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Value } from "typebox/value";
import {
  DeveloperTaskRequestSchema,
  DeveloperTaskViewSchema,
  DeveloperWebhookSubscriptionSchema,
  type DeveloperKeyIssued,
  type DeveloperKeyView,
  type DeveloperScope,
  type DeveloperTaskRequest,
  type DeveloperTaskView,
  type DeveloperWebhookSubscription
} from "@cosmora/contracts";

const TOKEN_PREFIX = "cdev_";
const TOKEN_BYTES = 32;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export class DeveloperApiError extends Error {
  constructor(
    readonly code:
      | "KEY_NOT_FOUND"
      | "KEY_REVOKED"
      | "KEY_EXPIRED"
      | "SCOPE_DENIED"
      | "INVALID_REQUEST"
      | "TASK_CONFLICT"
      | "TASK_NOT_FOUND"
      | "WEBHOOK_NOT_FOUND"
      | "OWNER_DATA_FENCED",
    message = code
  ) {
    super(message);
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenHash = (token: string) => sha256("cosmora.developer-api.v1\0" + token);
const bodyHash = (value: unknown) => sha256(JSON.stringify(value ?? null));

/** Owns developer keys, durable tasks and webhook subscriptions. No billing dimension. */
export class DeveloperApiStore {
  constructor(private readonly db: DatabaseSync) {}

  private active(owner: string) {
    const row = this.db
      .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(owner) as { state: string } | undefined;
    if (row && row.state !== "active") throw new DeveloperApiError("OWNER_DATA_FENCED");
  }

  issue(
    ownerId: string,
    scopes: readonly DeveloperScope[],
    ttlMs: number,
    now = new Date()
  ): DeveloperKeyIssued {
    this.active(ownerId);
    if (!scopes.length || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS)
      throw new DeveloperApiError("INVALID_REQUEST");
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
    const keyId = "dk_" + randomBytes(16).toString("hex");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.db
      .prepare(
        "INSERT INTO developer_api_keys(key_id,owner_id,token_hash,scopes_json,created_at,expires_at,revoked_at,last_used_at) VALUES(?,?,?,?,?,?,NULL,NULL)"
      )
      .run(keyId, ownerId, tokenHash(token), JSON.stringify([...scopes]), createdAt, expiresAt);
    return { key_id: keyId, owner_id: ownerId, token, scopes: [...scopes], created_at: createdAt, expires_at: expiresAt };
  }

  /** Returns the owner-bound identity; never returns the token or its plaintext. */
  resolve(token: string, now = new Date()): { owner_id: string; key_id: string; scopes: DeveloperScope[] } {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 256)
      throw new DeveloperApiError("KEY_NOT_FOUND");
    const hash = tokenHash(token);
    const row = this.db
      .prepare(
        "SELECT key_id,owner_id,scopes_json,expires_at,revoked_at FROM developer_api_keys WHERE token_hash=?"
      )
      .get(hash) as
      | { key_id: string; owner_id: string; scopes_json: string; expires_at: string; revoked_at: string | null }
      | undefined;
    if (!row) throw new DeveloperApiError("KEY_NOT_FOUND");
    this.active(row.owner_id);
    if (row.revoked_at) throw new DeveloperApiError("KEY_REVOKED");
    if (new Date(row.expires_at).getTime() <= now.getTime()) throw new DeveloperApiError("KEY_EXPIRED");
    this.db
      .prepare("UPDATE developer_api_keys SET last_used_at=? WHERE key_id=?")
      .run(now.toISOString(), row.key_id);
    return { owner_id: row.owner_id, key_id: row.key_id, scopes: JSON.parse(row.scopes_json) as DeveloperScope[] };
  }

  requireScope(keyId: string, scope: DeveloperScope) {
    const row = this.db
      .prepare("SELECT scopes_json FROM developer_api_keys WHERE key_id=?")
      .get(keyId) as { scopes_json: string } | undefined;
    if (!row || !(JSON.parse(row.scopes_json) as DeveloperScope[]).includes(scope))
      throw new DeveloperApiError("SCOPE_DENIED");
  }

  list(ownerId: string): DeveloperKeyView[] {
    this.active(ownerId);
    const rows = this.db
      .prepare(
        "SELECT key_id,owner_id,scopes_json,created_at,expires_at,revoked_at,last_used_at FROM developer_api_keys WHERE owner_id=? ORDER BY created_at DESC LIMIT 100"
      )
      .all(ownerId) as Array<Omit<DeveloperKeyView, "scopes"> & { scopes_json: string }>;
    return rows.map(({ scopes_json, ...rest }) => ({ ...rest, scopes: JSON.parse(scopes_json) as DeveloperScope[] }));
  }

  revoke(ownerId: string, keyId: string, at = new Date()): DeveloperKeyView {
    this.active(ownerId);
    const result = this.db
      .prepare("UPDATE developer_api_keys SET revoked_at=? WHERE key_id=? AND owner_id=? AND revoked_at IS NULL")
      .run(at.toISOString(), keyId, ownerId);
    if (!result.changes) throw new DeveloperApiError("KEY_NOT_FOUND");
    const row = this.db
      .prepare("SELECT key_id,owner_id,scopes_json,created_at,expires_at,revoked_at,last_used_at FROM developer_api_keys WHERE key_id=?")
      .get(keyId) as Omit<DeveloperKeyView, "scopes"> & { scopes_json: string };
    const view: DeveloperKeyView = {
      ...row,
      scopes: JSON.parse(row.scopes_json) as DeveloperScope[]
    };
    return view;
  }

  createTask(
    ownerId: string,
    keyId: string,
    input: unknown,
    now = new Date()
  ): DeveloperTaskView {
    this.active(ownerId);
    if (!Value.Check(DeveloperTaskRequestSchema, input)) throw new DeveloperApiError("INVALID_REQUEST");
    const request = input as DeveloperTaskRequest;
    const hash = bodyHash({ goal: request.goal, files: request.files ?? [] });
    const prior = this.db
      .prepare("SELECT task_id,request_hash,status,goal,created_at,updated_at,result_file FROM developer_api_tasks WHERE owner_id=? AND client_request_id=?")
      .get(ownerId, request.client_request_id) as
      | (Omit<DeveloperTaskView, "owner_id"> & { request_hash: string })
      | undefined;
    if (prior) {
      if (prior.request_hash !== hash) throw new DeveloperApiError("TASK_CONFLICT");
      return { ...prior, owner_id: ownerId };
    }
    const taskId = "dt_" + randomBytes(16).toString("hex");
    const at = now.toISOString();
    this.db
      .prepare(
        "INSERT INTO developer_api_tasks(task_id,owner_id,key_id,client_request_id,goal,files_json,status,request_hash,result_file,created_at,updated_at) VALUES(?,?,?,?,?,?, 'queued', ?,NULL,?,?)"
      )
      .run(taskId, ownerId, keyId, request.client_request_id, request.goal, JSON.stringify(request.files ?? []), hash, at, at);
    return this.getTask(ownerId, taskId);
  }

  getTask(ownerId: string, taskId: string): DeveloperTaskView {
    this.active(ownerId);
    const row = this.db
      .prepare(
        "SELECT task_id,owner_id,status,goal,created_at,updated_at,result_file FROM developer_api_tasks WHERE task_id=? AND owner_id=?"
      )
      .get(taskId, ownerId) as DeveloperTaskView | undefined;
    if (!row) throw new DeveloperApiError("TASK_NOT_FOUND");
    if (!Value.Check(DeveloperTaskViewSchema, row)) throw new Error("INVALID_TASK_VIEW");
    return row;
  }

  listTasks(ownerId: string): DeveloperTaskView[] {
    this.active(ownerId);
    return this.db
      .prepare(
        "SELECT task_id,owner_id,status,goal,created_at,updated_at,result_file FROM developer_api_tasks WHERE owner_id=? ORDER BY created_at DESC LIMIT 100"
      )
      .all(ownerId) as DeveloperTaskView[];
  }

  setTaskStatus(ownerId: string, taskId: string, status: DeveloperTaskView["status"], resultFile: string | null = null) {
    this.active(ownerId);
    this.db
      .prepare("UPDATE developer_api_tasks SET status=?, result_file=COALESCE(?,result_file), updated_at=? WHERE task_id=? AND owner_id=?")
      .run(status, resultFile, new Date().toISOString(), taskId, ownerId);
    return this.getTask(ownerId, taskId);
  }

  subscribe(ownerId: string, url: string, events: string[], now = new Date()): { subscription: DeveloperWebhookSubscription; secret: string } {
    this.active(ownerId);
    if (!url.startsWith("https://") || !events.length || events.length > 20)
      throw new DeveloperApiError("INVALID_REQUEST");
    const secret = "whsec_" + randomBytes(32).toString("base64url");
    const webhookId = "wh_" + randomBytes(16).toString("hex");
    const subscription: DeveloperWebhookSubscription = {
      webhook_id: webhookId,
      owner_id: ownerId,
      url,
      events,
      created_at: now.toISOString(),
      revoked_at: null
    };
    if (!Value.Check(DeveloperWebhookSubscriptionSchema, subscription))
      throw new DeveloperApiError("INVALID_REQUEST");
    this.db
      .prepare(
        "INSERT INTO developer_api_webhooks(webhook_id,owner_id,url,events_json,secret_hash,created_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)"
      )
      .run(webhookId, ownerId, url, JSON.stringify(events), sha256(secret), subscription.created_at);
    return { subscription, secret };
  }

  subscriptions(ownerId: string): DeveloperWebhookSubscription[] {
    this.active(ownerId);
    const rows = this.db
      .prepare(
        "SELECT webhook_id,owner_id,url,events_json,created_at,revoked_at FROM developer_api_webhooks WHERE owner_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100"
      )
      .all(ownerId) as Array<Omit<DeveloperWebhookSubscription, "events"> & { events_json: string }>;
    return rows.map(({ events_json, ...rest }) => ({ ...rest, events: JSON.parse(events_json) as string[] }));
  }

  revokeWebhook(ownerId: string, webhookId: string) {
    this.active(ownerId);
    const result = this.db
      .prepare("UPDATE developer_api_webhooks SET revoked_at=? WHERE webhook_id=? AND owner_id=? AND revoked_at IS NULL")
      .run(new Date().toISOString(), webhookId, ownerId);
    if (!result.changes) throw new DeveloperApiError("WEBHOOK_NOT_FOUND");
  }

  /** HMAC key is the stored digest; the raw secret is shown once at subscription. */
  signingKey(webhookId: string): Buffer | null {
    const row = this.db
      .prepare("SELECT secret_hash FROM developer_api_webhooks WHERE webhook_id=? AND revoked_at IS NULL")
      .get(webhookId) as { secret_hash: string } | undefined;
    return row ? Buffer.from(row.secret_hash, "hex") : null;
  }

  ownerOfWebhook(webhookId: string): string | null {
    const row = this.db
      .prepare("SELECT owner_id FROM developer_api_webhooks WHERE webhook_id=? AND revoked_at IS NULL")
      .get(webhookId) as { owner_id: string } | undefined;
    return row?.owner_id ?? null;
  }

  recordDelivery(ownerId: string, webhookId: string, event: string, payload: unknown, attempt: number) {
    this.active(ownerId);
    const digest = bodyHash(payload);
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO developer_api_deliveries(delivery_id,webhook_id,owner_id,event,payload_sha256,attempt,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)"
      )
      .run("dld_" + randomBytes(12).toString("hex"), webhookId, ownerId, event, digest, attempt, new Date().toISOString());
    return result.changes === 1;
  }

  static safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
