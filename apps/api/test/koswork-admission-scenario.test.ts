import { createHash } from "node:crypto";
import {
  ManagerWorkStore,
  ProjectStore,
  WorkDagStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { buildWorkAdmissionSnapshot } from "@cosmora/core";
import { afterEach, describe, expect, it } from "vitest";

const dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
const setup = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  const works = new ManagerWorkStore(db.sqlite);
  const dag = new WorkDagStore(db.sqlite);
  const project = projects.createProject("Сверка заказа", "admission-1", "owner").project.id;
  projects.setMaterials(project, "owner", {
    version: 0,
    instructions: "Использовать только сохранённые исходники. Не выдумывать суммы.",
    attachments: [
      { name: "order.csv", content: "ID,Total\n00123,19700\n" },
      { name: "notes.txt", content: "Кроме доставки." }
    ]
  });
  return { db, projects, works, dag, project };
};

describe("pass 1: work admission binds goal, materials and dependencies", () => {
  it("accepts a task with materials snapshot, idempotent replay and a dependent plan", async () => {
    const { db, projects, works, dag, project } = await setup();
    const materials = projects.getMaterials(project, "owner")!;
    const plan = [
      {
        id: "read",
        title: "Прочитать order.csv",
        goal: "Прочитать order.csv",
        depends_on: [] as string[]
      },
      {
        id: "compare",
        title: "Сверить с notes.txt",
        goal: "Сверить с notes.txt",
        depends_on: ["read"]
      },
      {
        id: "report",
        title: "Собрать отчёт",
        goal: "Собрать отчёт",
        depends_on: ["compare"]
      }
    ];
    const snapshot = buildWorkAdmissionSnapshot({
      goal: "Сверить итог заказа 00123 и подготовить отчёт",
      materials: {
        instructions: materials.instructions,
        attachments: materials.attachments.map((item) => ({
          name: item.name,
          content: item.content
        }))
      },
      plan,
      sourceRunId: "run-1"
    });
    expect(snapshot.dependencies).toHaveLength(2);

    const request = {
      client_request_id: "admission-request-1",
      goal: snapshot.goal,
      worker_role: "analyst" as const,
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    };
    const accepted = works.create(project, "owner", "owner", request, true);
    expect(accepted).not.toBeNull();
    expect(accepted!.status).toBe("paused"); // dormant: модель не запущена
    expect(accepted!.materials?.attachments.map((item) => item.name)).toEqual([
      "order.csv",
      "notes.txt"
    ]);
    expect(accepted!.memory_snapshot).toBeDefined();
    expect(accepted!.events[0]).toMatchObject({ stage: "plan", message: "Задача принята" });

    // Повтор того же запроса — та же задача, без второго экземпляра.
    const replay = works.create(project, "owner", "owner", request, true);
    expect(replay!.id).toBe(accepted!.id);
    expect(works.list(project, "owner")).toHaveLength(1);

    // Зависимый план фиксируется в DAG: два шага сначала blocked.
    const graph = dag.create(project, "owner", "owner", {
      client_request_id: "admission-dag-1",
      title: "Сверка отчёта",
      nodes: plan
    })!;
    expect(graph.nodes.filter((node) => node.status === "blocked")).toHaveLength(2);
    expect(graph.nodes[0]!.status).toBe("pending");
    const reopened = new WorkDagStore(db.sqlite);
    expect(reopened.get(graph.id, "owner")!.nodes[2]!.depends_on).toEqual(["compare"]);
  });
});
