import { describe, expect, it, vi } from "vitest";
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
      execute: ({ part }) => {
        calls.push(part.id);
        if (part.id === "review")
          return Promise.resolve({ text: "RETRY part-1", verdict: "RETRY" as const });
        const retried = calls.filter((id) => id === part.id).length > 1;
        return Promise.resolve({ text: `${part.text}${retried ? " (исправлено)" : ""}` });
      }
    });
    expect(result).not.toBeNull();
    expect(calls).toEqual(["part-1", "part-2", "review", "part-1", "review"]);
    expect(result!.parts[0]!.retried).toBe(true);
    expect(result!.parts[1]!.retried).toBe(false);
    expect(result!.answer).toContain("Часть один (исправлено)");
    expect(result!.answer).toContain("Часть два");
    expect(result!.review.verdict).toBe("RETRY");
    expect(result!.total_ms).toBeGreaterThanOrEqual(0);
  });

  it("does not execute already cancelled work", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(() => Promise.resolve({ text: "x" }));
    await expect(
      runParallelRoute({
        text: "A\nB",
        signal: controller.signal,
        execute
      })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("starts independent parts concurrently with four active calls and preserves order", async () => {
    const fourStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const resultPromise = runParallelRoute({
      text: "A\nB\nC\nD\nE\nF",
      signal: new AbortController().signal,
      execute: async ({ part }) => {
        if (part.id === "review") {
          expect(completed).toBe(6);
          return { text: "PASS", verdict: "PASS" };
        }
        active++;
        maxActive = Math.max(maxActive, active);
        if (active === 4) fourStarted.resolve();
        await release.promise;
        active--;
        completed++;
        return { text: part.text };
      }
    });
    try {
      await fourStarted.promise;
      expect(active).toBe(4);
      expect(completed).toBe(0);
    } finally {
      release.resolve();
    }
    const result = await resultPromise;
    expect(maxActive).toBe(4);
    expect(result?.answer).toBe("A\nB\nC\nD\nE\nF");
    expect(result?.review.verdict).toBe("PASS");
  });

  it("aborts sibling calls after a failure and never reviews a partial result", async () => {
    let siblingSignal: AbortSignal | undefined;
    const calls: string[] = [];
    const failure = new Error("executor failed");
    await expect(
      runParallelRoute({
        text: "A\nB",
        signal: new AbortController().signal,
        execute: async ({ part, signal }) => {
          calls.push(part.id);
          if (part.id === "part-1") throw failure;
          siblingSignal = signal;
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true })
          );
          signal.throwIfAborted();
          return { text: "unreachable" };
        }
      })
    ).rejects.toBe(failure);
    expect(siblingSignal?.aborted).toBe(true);
    expect(calls).toEqual(["part-1", "part-2"]);
  });

  it("does not accept an unrecognised review as PASS", async () => {
    const result = await runParallelRoute({
      text: "A\nB",
      signal: new AbortController().signal,
      execute: () => Promise.resolve({ text: "I did not validate this" })
    });
    expect(result?.review.verdict).toBe("RETRY");
  });

  it("rechecks a repaired result against the original task before PASS", async () => {
    let reviews = 0;
    const result = await runParallelRoute({
      text: "original A\noriginal B",
      signal: new AbortController().signal,
      execute: ({ part, prompt }) => {
        if (part.id === "review")
          return Promise.resolve(
            ++reviews === 1
              ? { text: "RETRY part-1", verdict: "RETRY" }
              : { text: "PASS", verdict: "PASS" }
          );
        if (prompt.includes("Замечания:")) {
          expect(part.text).toBe("original A");
          expect(prompt).toContain("RETRY part-1");
          return Promise.resolve({ text: "fixed A" });
        }
        return Promise.resolve({ text: part.text });
      }
    });
    expect(reviews).toBe(2);
    expect(result?.answer).toBe("fixed A\noriginal B");
    expect(result?.review.verdict).toBe("PASS");
  });
});
