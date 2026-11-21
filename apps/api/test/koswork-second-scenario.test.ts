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

/** Второй полезный сценарий: другая структура входов — таблица с рядом
 * заголовков+строк и несколько якорных выдержек вместо CSV+заметок. */
describe("pass 5: second admission scenario with a different input structure", () => {
  it("binds a table-workspace goal with source excerpts and a wide dependency fan-in", async () => {
    const db = openDatabase(":memory:");
    dbs.push(db);
    await runMigrations(db);
    const projects = new ProjectStore(db.sqlite);
    const works = new ManagerWorkStore(db.sqlite);
    const dag = new WorkDagStore(db.sqlite);
    const project = projects.createProject("Сводная таблица", "scenario-2", "owner").project.id;

    const table = {
      schema: "kosmora.studio.data",
      version: 1,
      name: "data.csv",
      table: {
        delimiter: ",",
        headers: ["ID", "Q1", "Q2"],
        rows: [
          ["00123", "120", "77"],
          ["00456", "90", "130"]
        ]
      },
      settings: { types: ["text", "number", "number"] }
    };
    projects.setMaterials(project, "owner", {
      version: 0,
      instructions: "Суммировать Q1+Q2 по строке. Не выдумывать строки.",
      attachments: [
        { name: "table.json", content: JSON.stringify(table) },
        { name: "source-a.txt", content: "Якорь: строка 00123 проверена。" },
        { name: "source-b.txt", content: "Якорь: строка 00456 проверена。" }
      ]
    });
    const materials = projects.getMaterials(project, "owner")!;

    const plan = [
      { id: "parse", title: "Разобрать таблицу", goal: "Разобрать", depends_on: [] },
      { id: "anchor-a", title: "Якорь A", goal: "Якорь A", depends_on: ["parse"] },
      { id: "anchor-b", title: "Якорь B", goal: "Якорь B", depends_on: ["parse"] },
      { id: "total", title: "Свести итоги", goal: "Свести", depends_on: ["anchor-a", "anchor-b"] }
    ];
    const snapshot = buildWorkAdmissionSnapshot({
      goal: "Посчитать итог Q1+Q2 по двум строкам и сверить с якорями",
      materials: {
        instructions: materials.instructions,
        attachments: materials.attachments.map((item) => ({
          name: item.name,
          content: item.content
        }))
      },
      plan,
      sourceRunId: "scenario-2-run"
    });
    expect(snapshot.dependencies).toEqual(["anchor-a", "anchor-b", "parse"]);
    expect(snapshot.materials.attachments).toHaveLength(3);

    const accepted = works.create(
      project,
      "owner",
      "owner",
      {
        client_request_id: "scenario-2-work",
        goal: snapshot.goal,
        worker_role: "analyst"
      },
      true
    )!;
    expect(accepted.status).toBe("paused");
    expect(accepted.materials?.attachments).toHaveLength(3);
    expect(accepted.memory_snapshot).toBeDefined();

    // Dependency fan-in: два якоря блокированы до разбора, итог — до обоих якорей.
    const graph = dag.create(project, "owner", "owner", {
      client_request_id: "scenario-2-dag",
      title: "Сводная проверка",
      nodes: plan
    });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get("parse")!.status).toBe("pending");
    expect(byId.get("anchor-a")!.status).toBe("blocked");
    expect(byId.get("anchor-b")!.status).toBe("blocked");
    expect(byId.get("total")!.depends_on).toEqual(["anchor-a", "anchor-b"]);

    // Переоткрытие сохраняет состояние и снимок входа.
    const reopened = new WorkDagStore(db.sqlite).get(graph.id, "owner")!;
    expect(reopened.nodes).toHaveLength(4);
    expect(works.list(project, "owner")[0]!.materials?.attachments).toHaveLength(3);
    expect(createHash("sha256").update(snapshot.digest).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
  });
});
