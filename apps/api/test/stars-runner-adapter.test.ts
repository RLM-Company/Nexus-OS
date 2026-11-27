import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dispatchIsolatedRunner,
  IsolatedRunnerError,
  resumeIsolatedRunner
} from "../src/stars-runner-adapter.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), "stars-runner-"));
  roots.push(dir);
  return dir;
};
const task = {
  task_id: "task-42",
  holder: "stars-agent",
  goal: "Сверить отчёт",
  steps: ["read", "compare", "report"]
};

describe("isolated Stars runner adapter (test environment, not cloud)", () => {
  it("writes real artifacts and resumes from checkpoint without redoing steps", () => {
    const dir = root();
    try {
      dispatchIsolatedRunner(dir, task, (index) => index !== 1);
      throw Error("EXPECTED_CANCEL");
    } catch (cause) {
      expect(cause).toBeInstanceOf(IsolatedRunnerError);
    }
    const checkpoint = JSON.parse(
      readFileSync(join(dir, "task-42", "checkpoint.json"), "utf8")
    ) as { completed: string[] };
    expect(checkpoint.completed).toEqual(["read"]);

    const resumed = resumeIsolatedRunner(dir, task);
    expect(resumed.completed).toBe(true);
    expect(resumed.checkpoint).toContain("checkpoint.json");
    expect(resumed.artifacts[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(resumed.workspace, "report.txt"), "utf8")).toContain("compare");
    expect(() => dispatchIsolatedRunner(dir, task)).toThrow(IsolatedRunnerError);
  });

  it("cancels without producing a completed report", () => {
    const dir = root();
    expect(() => dispatchIsolatedRunner(dir, task, () => false)).toThrow("CANCELLED");
    const status = JSON.parse(readFileSync(join(dir, "task-42", "status.json"), "utf8")) as {
      status: string;
    };
    expect(status.status).toBe("cancelled");
  });
});
