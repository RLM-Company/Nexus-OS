import { describe, expect, it } from "vitest";
import {
  buildWorkAdmissionSnapshot,
  sameAdmissionSnapshot
} from "../src/work-admission-snapshot.js";

/** Первый полезный набор: отчёт по таблице, зависит от прочитанного源文件. */
const dataset = () => ({
  goal: "Сверить итог заказа 00123 и подготовить отчёт",
  materials: {
    instructions: "Использовать только сохранённые源文件. Не выдумывать суммы.",
    attachments: [
      { name: "order.csv", content: "ID,Total\n00123,19700\n" },
      { name: "notes.txt", content: "Кроме доставки." }
    ]
  },
  plan: [
    { title: "Прочитать order.csv" },
    { title: "Сверить с notes.txt", depends_on: ["Прочитать order.csv"] },
    { title: "Собрать отчёт", depends_on: ["Сверить с notes.txt"] }
  ],
  sourceRunId: "run-1"
});

describe("work admission snapshot (pass 1)", () => {
  it("binds goal, materials and dependencies into one deterministic snapshot", () => {
    const snapshot = buildWorkAdmissionSnapshot(dataset());
    expect(snapshot.format).toBe("kosmora.work-admission.v1");
    expect(snapshot.goal).toContain("00123");
    expect(snapshot.materials.attachments.map((a) => a.name)).toEqual(["notes.txt", "order.csv"]);
    expect(snapshot.dependencies).toEqual(["Прочитать order.csv", "Сверить с notes.txt"]);
    expect(snapshot.plan).toHaveLength(3);
    expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable on repeated request and order-insensitive within materials", () => {
    const input = dataset();
    input.materials.attachments.push({ name: "notes.txt", content: "Уточнение." });
    const first = buildWorkAdmissionSnapshot(input);
    input.materials.attachments.reverse();
    const second = buildWorkAdmissionSnapshot(input);
    expect(sameAdmissionSnapshot(first, second)).toBe(true);
  });

  it("detects a changed source and changed goal", () => {
    const first = buildWorkAdmissionSnapshot(dataset());
    expect(
      sameAdmissionSnapshot(
        first,
        buildWorkAdmissionSnapshot({ ...dataset(), sourceRunId: "run-2" })
      )
    ).toBe(false);
    expect(
      sameAdmissionSnapshot(
        first,
        buildWorkAdmissionSnapshot({ ...dataset(), goal: "Другая цель" })
      )
    ).toBe(false);
  });

  it("rejects an empty goal", () => {
    expect(() => buildWorkAdmissionSnapshot({ ...dataset(), goal: "   " })).toThrow("INVALID_GOAL");
  });
});
