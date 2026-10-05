import { expect, test } from "@playwright/test";

test("polls active Manager work quickly and backs off after completion", async ({ page, request }) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Проверь adaptive polling",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  let status = "running";
  let version = 1;
  let workReads = 0;
  let runtimeReads = 0;

  await page.route("**/api/v1/projects/" + project.id + "/work", (route) => {
    workReads += 1;
    const completed = status === "completed";
    return route.fulfill({
      json: {
        items: [
          {
            id: "adaptive-poll-fixture",
            version,
            status,
            stage: completed ? "done" : "draft",
            pause_requested: false,
            model_requests: completed ? 3 : 1,
            error_code: null,
            confirmation_id: null,
            request: { goal: "Проверь adaptive polling" },
            plan: null,
            draft: completed ? { files: [{ name: "result.md", content: "# Done" }] } : null,
            review: completed ? { verdict: "PASS", reason: "Готово" } : null,
            events: [
              {
                sequence: completed ? 2 : 1,
                stage: completed ? "done" : "draft",
                message: completed ? "Работа завершена" : "Создаётся черновик",
                at: "2026-10-05T12:00:00.000Z"
              }
            ]
          }
        ]
      }
    });
  });
  await page.route("**/api/v1/model-runtime", (route) => {
    runtimeReads += 1;
    return route.fulfill({
      json: { mode: "mock", provider: "mock", model: "fixture", fallback_to_mock: false }
    });
  });
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: null } })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) =>
    route.fulfill({ json: null })
  );

  await page.goto("/?project=" + project.id + "&view=plan");
  const panel = page.getByRole("region", { name: "Выполнение задачи Manager" });
  await expect(panel.getByRole("status")).toHaveText("Выполняется");
  await expect.poll(() => workReads, { timeout: 3500 }).toBeGreaterThanOrEqual(3);
  expect(runtimeReads).toBe(1);

  status = "completed";
  version = 2;
  await expect(panel.getByRole("status"), "completed state should arrive on the active cadence").toHaveText(
    "Готово",
    { timeout: 2500 }
  );

  const idleReads = workReads;
  const idleRuntimeReads = runtimeReads;
  await page.waitForTimeout(1800);
  expect(workReads).toBe(idleReads);
  expect(runtimeReads).toBe(idleRuntimeReads);
});
