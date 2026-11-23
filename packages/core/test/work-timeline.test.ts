import { describe, expect, it } from "vitest";
import { projectWorkTimeline, type WorkTimelineSource } from "../src/work-timeline.js";

/** События скопированы из живого прогона 2026-11-22 (id edcc0468…). */
const liveApproval = {
  id: "edcc0468-9458-496d-adcc-1921a889862d",
  status: "awaiting_approval",
  stage: "draft",
  plan: { summary: "Создам короткий файл с нейтральным текстом о погоде." },
  error_code: null,
  model_requests: 1,
  events: [
    { sequence: 1, stage: "plan", message: "Задача принята", at: "2026-11-22T10:00:00.000Z" },
    { sequence: 2, stage: "plan", message: "Запрос модели: plan", at: "2026-11-22T10:00:01.000Z" },
    { sequence: 3, stage: "plan", message: "План подготовлен", at: "2026-11-22T10:00:45.000Z" }
  ]
} satisfies WorkTimelineSource;

describe("work timeline for chat plan/timer cards", () => {
  it("keeps queued work in the queue even when the next stage is planning", () => {
    const work = { ...liveApproval, status: "queued", stage: "plan" } as const;
    expect(projectWorkTimeline(work).progress).toBe("queued");
    expect(projectWorkTimeline({ ...work, status: "running" }).progress).toBe("planning");
  });

  it("shows active publication and the owner gate as distinct states", () => {
    const work = { ...liveApproval, status: "running", stage: "publish" } as const;
    expect(projectWorkTimeline(work).progress).toBe("delivering");
    expect(
      projectWorkTimeline({ ...work, status: "blocked", error_code: "WAITING_CONFIRMATION" })
    ).toMatchObject({ progress: "awaiting_owner", error_code: "WAITING_CONFIRMATION" });
  });

  it("turns real live approval events into a compact owner-facing status", () => {
    const timeline = projectWorkTimeline(liveApproval);
    expect(timeline).toMatchObject({
      work_id: liveApproval.id,
      status: "awaiting_approval",
      stage: "draft",
      progress: "awaiting_owner",
      model_requests: 1,
      error_code: null
    });
    expect(timeline.title).toContain("короткий файл");
    expect(timeline.steps.map((step) => step.kind)).toEqual(["control", "model", "model"]);
  });

  it("keeps an honest diagnostic step for a failed live provider call", () => {
    const timeline = projectWorkTimeline({
      id: "b5f2297f",
      status: "failed",
      stage: "plan",
      error_code: "PROVIDER_ERROR",
      model_requests: 1,
      events: [
        { sequence: 1, stage: "plan", message: "Задача принята", at: "2026-11-22T10:20:00.000Z" },
        {
          sequence: 2,
          stage: "plan",
          message: "Диагностика модели: INCOMPLETE_TEXT_RESPONSE",
          at: "2026-11-22T10:21:00.000Z"
        },
        {
          sequence: 3,
          stage: "plan",
          message: "Работа остановлена: PROVIDER_ERROR",
          at: "2026-11-22T10:21:01.000Z"
        }
      ]
    });
    expect(timeline.progress).toBe("closed");
    expect(timeline.error_code).toBe("PROVIDER_ERROR");
    expect(timeline.steps[2]!.kind).toBe("diagnostic");
  });
});
