import { describe, expect, it } from "vitest";
import { DeveloperResponseCache, type CacheContext } from "../src/developer-api/response-cache.js";

const context = (overrides: Partial<CacheContext> = {}): CacheContext => ({
  ownerId: "owner-a",
  keyId: "dk_1",
  version: "v1",
  instructions: "answer briefly",
  tools: "none",
  permissions: "chat.write",
  prompt: "40+2?",
  ...overrides
});

describe("developer response cache", () => {
  it("isolates owners, keys and versions", () => {
    let now = 1_000;
    const cache = new DeveloperResponseCache(() => now);
    const base = context();
    cache.put(base, "42", 10_000);
    expect(cache.get(base)).toBe("42");
    expect(cache.get(context({ ownerId: "owner-b" }))).toBeNull();
    expect(cache.get(context({ keyId: "dk_2" }))).toBeNull();
    expect(cache.get(context({ version: "v2" }))).toBeNull();
    now += 10_001;
    expect(cache.get(base)).toBeNull();
  });

  it("invalidates when instructions, tools or permissions change", () => {
    const cache = new DeveloperResponseCache(() => 0);
    const base = context();
    cache.put(base, "42", 10_000);
    expect(cache.get(context({ instructions: "answer in detail" }))).toBeNull();
    expect(cache.get(context({ tools: "browser" }))).toBeNull();
    expect(cache.get(context({ permissions: "chat.read" }))).toBeNull();
    expect(cache.invalidateOwner("owner-a")).toBe(1);
    expect(cache.get(base)).toBeNull();
  });
});
