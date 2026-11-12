import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatSendRetryKey,
  clearChatSendRetry,
  clearNewChatRetry,
  readChatSendRetry,
  saveChatSendRetry
} from "./chat-send-retry";

const legacy = "cosmora:pending-chat-send:v1";

describe("tab-scoped chat send retries", () => {
  const records = new Map<string, string>();
  beforeEach(() => {
    records.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => records.get(key) ?? null,
        setItem: (key: string, value: string) => records.set(key, value),
        removeItem: (key: string) => records.delete(key)
      }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reuses a legacy marker only for an exact request and retires it on acknowledgement", async () => {
    const path = "/api/v1/chats/example/messages";
    const key = (await chatSendRetryKey(path, "original payload"))!;
    const modified = (await chatSendRetryKey(path, "modified payload"))!;
    records.set(legacy, JSON.stringify({ fingerprint: key.fingerprint, id: "previous-id" }));

    expect(readChatSendRetry(modified)).toBeUndefined();
    expect(readChatSendRetry(key)).toBe("previous-id");
    saveChatSendRetry(key, "previous-id");
    expect(records.has(legacy)).toBe(false);
    clearChatSendRetry(key.scope, "unrelated-id");
    expect(readChatSendRetry(key)).toBe("previous-id");
    clearChatSendRetry(key.scope, "previous-id");
    expect(readChatSendRetry(key)).toBeUndefined();
    expect(records.size).toBe(0);
  });

  it("keeps only the newest 16 markers and clears a fresh chat independently", async () => {
    const fresh = (await chatSendRetryKey("/api/v1/chats", "new conversation"))!;
    const keys = await Promise.all(
      Array.from(
        { length: 16 },
        async (_, index) => (await chatSendRetryKey(`/api/v1/chats/${index}/messages`, "pending"))!
      )
    );
    keys.forEach((key, index) => saveChatSendRetry(key, `request-${index}`));
    saveChatSendRetry(fresh, "new-request");
    expect(readChatSendRetry(keys[0]!)).toBeUndefined();
    expect(readChatSendRetry(fresh)).toBe("new-request");

    clearNewChatRetry();
    expect(readChatSendRetry(fresh)).toBeUndefined();
    expect(readChatSendRetry(keys[1]!)).toBe("request-1");
    expect(readChatSendRetry(keys[15]!)).toBe("request-15");
  });
});
