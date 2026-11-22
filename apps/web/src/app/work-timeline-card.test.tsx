import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkTimelineCard } from "./work-timeline-card";

const liveApproval = {
  id: "edcc0468-9458-496d-adcc-1921a889862d",
  status: "awaiting_approval",
  stage: "draft",
  plan: { summary: "Создам короткий файл о погоде." },
  error_code: null,
  model_requests: 1,
  events: [
    { sequence: 1, stage: "plan", message: "Задача принята", at: "2026-11-22T10:00:00.000Z" },
    { sequence: 2, stage: "plan", message: "Запрос модели: plan", at: "2026-11-22T10:00:01.000Z" },
    { sequence: 3, stage: "plan", message: "План подготовлен", at: "2026-11-22T10:00:45.000Z" }
  ]
};

describe("WorkTimelineCard", () => {
  it("renders the live approval projection without touching the chat shell", () => {
    const html = renderToStaticMarkup(<WorkTimelineCard work={liveApproval} />);
    expect(html).toContain("awaiting_owner");
    expect(html).toContain("Создам короткий файл о погоде.");
    expect(html).toContain("Запрос модели: plan");
    expect(html).toContain("Запросов модели: 1");
    expect(html).not.toContain("Ошибка:");
  });

  it("shows a diagnostic alert for a failed live provider run", () => {
    const html = renderToStaticMarkup(
      <WorkTimelineCard
        work={{
          ...liveApproval,
          id: "b5f2297f",
          status: "failed",
          stage: "plan",
          error_code: "PROVIDER_ERROR",
          events: [
            ...liveApproval.events.slice(0, 1),
            {
              sequence: 2,
              stage: "plan",
              message: "Диагностика модели: INCOMPLETE_TEXT_RESPONSE",
              at: "2026-11-22T10:21:00.000Z"
            }
          ]
        }}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("PROVIDER_ERROR");
    expect(html).toContain('data-kind="diagnostic"');
  });
});
