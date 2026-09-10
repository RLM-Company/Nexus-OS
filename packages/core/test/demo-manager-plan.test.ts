import { describe, expect, it } from "vitest";
import { validateRuntimeTaskGraph } from "@cosmora/contracts";
import { composeDemoManagerPlan } from "../src/index.js";

const ids = (...values: string[]) => {
  const pending = [...values];
  return () => {
    const value = pending.shift();
    if (!value) throw new Error("Unexpected id request");
    return value;
  };
};

describe("demo Manager plan", () => {
  it("builds a valid project-bound graph with one synthetic read-only step", () => {
    const plan = composeDemoManagerPlan({
      projectId: "project-a",
      ownerGoal: "  Подготовь   план улучшения документации  ",
      createdAt: "2026-09-10T10:00:00.000Z",
      createId: ids("graph-a", "plan-a", "context-a", "handoff-a")
    });

    expect(validateRuntimeTaskGraph(plan.graph)).toEqual([]);
    expect(plan.graph.nodes.every((node) => node.project_id === "project-a")).toBe(true);
    expect(plan.graph.nodes.map((node) => node.status)).toEqual(["pending", "pending", "pending"]);
    expect(plan.visibleSteps).toEqual([
      {
        taskId: "plan-a",
        title: "Сформировать план: Подготовь план улучшения документации",
        execution: "manager"
      },
      {
        taskId: "context-a",
        title: "Проверить контекст проекта (только чтение)",
        execution: "synthetic_read_only"
      },
      {
        taskId: "handoff-a",
        title: "Собрать результат и checkpoint",
        execution: "manager"
      }
    ]);
  });

  it("refuses an empty owner task", () => {
    expect(() =>
      composeDemoManagerPlan({
        projectId: "project-a",
        ownerGoal: "   ",
        createdAt: "2026-09-10T10:00:00.000Z",
        createId: ids("unused")
      })
    ).toThrow("requires an owner goal");
  });
});
