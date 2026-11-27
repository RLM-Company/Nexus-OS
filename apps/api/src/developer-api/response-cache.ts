import { createHash } from "node:crypto";

export type CacheContext = {
  ownerId: string;
  keyId: string;
  version: string;
  instructions: string;
  tools: string;
  permissions: string;
  prompt: string;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Owner/version-isolated response cache. Only readonly prompt answers may be
 * cached; an external action result is never used as permission to repeat it.
 */
export class DeveloperResponseCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number; context: CacheContext }>();

  constructor(private readonly now = () => Date.now()) {}

  key(context: CacheContext): string {
    return sha256(
      JSON.stringify([
        context.ownerId,
        context.keyId,
        context.version,
        sha256(context.instructions),
        sha256(context.tools),
        sha256(context.permissions),
        sha256(context.prompt)
      ])
    );
  }

  get(context: CacheContext): string | null {
    const hit = this.entries.get(this.key(context));
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(this.key(context));
      return null;
    }
    return hit.value;
  }

  put(context: CacheContext, value: string, ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    this.entries.set(this.key(context), {
      value,
      expiresAt: this.now() + ttlMs,
      context
    });
  }

  invalidateOwner(ownerId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.context.ownerId === ownerId) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear() {
    this.entries.clear();
  }
}
