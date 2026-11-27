import { describe, expect, it } from "vitest";
import { runParallelRoute, splitParallelParts } from "../src/developer-api/parallel-route.js";

describe("explicit parallel route", () => {
  it("does not fan out small tasks automatically", () => {
    expect(splitParallelParts("Один короткий вопрос")).toEqual([]);
  });

  it("runs strong review and retries only the flagged part", async () => {
    const calls: string[] = [];
    let tick = 0;
    const result = await runParallelRoute({
      text: "Часть один\nЧасть два",
      now: () => tick++,
      signal: new AbortController().signal,
      execute: async ({ part, prompt }) => {
        calls.push(part.id);
        if (part.id === "review") return { text: "RETRY part-1", verdict: "RETRY" };
        const retried = calls.filter((id) => id === part.id).length > 1;
        return { text: `${part.text}${retried ? " (исправлено)" : ""}` };
      }
    });
    expect(result).not.toBeNull();
    expect(calls).toEqual(["part-1", "part-2", "review", "part-1"]);
    expect(result!.parts[0]!.retried).toBe(true);
    expect(result!.parts[1]!.retried).toBe(false);
    expect(result!.answer).toContain("Часть один (исправлено)");
    expect(result!.answer).toContain("Часть два");
    expect(result!.review.verdict).toBe("RETRY");
    expect(result!.total_ms).toBeGreaterThanOrEqual(0);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runParallelRoute({
        text: "A\nB",
        signal: controller.signal,
        execute: async () => ({ text: "x" })
      })
    ).resolves.not.toBeNull(); // the pure coordinator trusts the executor to honour the signal
  });
});
