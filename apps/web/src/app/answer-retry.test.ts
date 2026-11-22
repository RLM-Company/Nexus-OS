import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAnswerRetry, readAnswerRetry, saveAnswerRetry } from "./answer-retry";

describe("document answer retry markers", () => {
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

  it("keeps the marker after dispatch so a lost response can be reconciled", () => {
    saveAnswerRetry("project-a", "source-1", "request-1");
    expect(readAnswerRetry("project-a", "source-1")?.requestId).toBe("request-1");
    expect(readAnswerRetry("project-b", "source-1")).toBeUndefined();
    expect(readAnswerRetry("project-a", "source-2")).toBeUndefined();
  });

  it("replaces an earlier uncertain marker only on an explicit new attempt", () => {
    saveAnswerRetry("project-a", "source-1", "request-1");
    saveAnswerRetry("project-a", "source-1", "request-2");
    expect(readAnswerRetry("project-a", "source-1")?.requestId).toBe("request-2");
  });

  it("clears only the reconciled source", () => {
    saveAnswerRetry("project-a", "source-1", "request-1");
    saveAnswerRetry("project-a", "source-2", "request-2");
    clearAnswerRetry("project-a", "source-1");
    expect(readAnswerRetry("project-a", "source-1")).toBeUndefined();
    expect(readAnswerRetry("project-a", "source-2")?.requestId).toBe("request-2");
  });
});
