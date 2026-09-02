import { expect, test } from "@playwright/test";

test("previews an authority diff before applying an autonomy profile change", async ({
  page,
  request
}) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for the autonomy control center browser check.",
      client_message_id: `control-center-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const profileUrl = `http://127.0.0.1:3100/api/v1/projects/${encodeURIComponent(projectId)}/autonomy-profile`;

  const updated = await request.put(profileUrl, {
    data: { base_level: "A3", overrides: [], expected_version: 1 }
  });
  expect(updated.ok()).toBeTruthy();

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  await expect(page.getByText("Guarded owner actions")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Полномочия, подтверждения и аварийное состояние — в одном месте"
    })
  ).toBeVisible();

  const levelMetric = page.locator("article").filter({ hasText: "Уровень" }).first();
  await expect(levelMetric).toContainText("A3");
  await expect(levelMetric).toContainText("profile v2");

  const capabilitiesMetric = page.locator("article").filter({ hasText: "Capabilities" }).first();
  await expect(capabilitiesMetric).toContainText("19");
  await expect(page.locator("[data-mode]")).toHaveCount(19);
  await expect(page.getByText("Нет ожидающих подтверждений.")).toBeVisible();
  const processStopCard = page
    .locator("article")
    .filter({ hasText: "Process emergency stop" })
    .first();
  await expect(processStopCard).toContainText("CLEAR");

  await page.getByRole("button", { name: "Выбрать уровень A4" }).click();
  const authorityDiff = page.getByRole("region", {
    name: "Проверка перед изменением уровня"
  });
  await expect(authorityDiff).toBeVisible();
  await expect(authorityDiff).toContainText("A3 → A4");
  await expect(authorityDiff).toContainText("finance.spend");
  await expect(authorityDiff).toContainText("CONFIRM");
  await expect(authorityDiff).toContainText("AUTONOMOUS");

  const beforeApply = await request.get(profileUrl);
  expect(beforeApply.ok()).toBeTruthy();
  expect(
    ((await beforeApply.json()) as { profile: { base_level: string; version: number } }).profile
  ).toMatchObject({ base_level: "A3", version: 2 });

  await page.getByLabel("Я проверил изменения полномочий и хочу применить их.").check();
  await page.getByRole("button", { name: "Применить A4" }).click();

  await expect(levelMetric).toContainText("A4");
  await expect(levelMetric).toContainText("profile v3");
  await expect(page.getByRole("status")).toContainText("Уровень автономии изменён на A4");

  await expect(page.getByRole("button", { name: /approve|подтверд/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /reject|отклон/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Активировать stop проекта" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /resume|возобновить|снять остановку/i })
  ).toHaveCount(0);

  const afterApply = await request.get(profileUrl);
  expect(afterApply.ok()).toBeTruthy();
  expect(
    ((await afterApply.json()) as { profile: { base_level: string; version: number } }).profile
  ).toMatchObject({ base_level: "A4", version: 3 });
});

test("explains policy verdicts without rendering hidden operation content", async ({
  page,
  request
}) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for the Policy Decision Trace browser check.",
      client_message_id: `decision-trace-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  let traceRequests = 0;

  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${projectId}/decision-trace` &&
      url.searchParams.get("limit") === "50",
    async (route) => {
      traceRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              decision_id: "decision-browser-1",
              operation_id: "publish-campaign-browser-1",
              project_id: projectId,
              actor_id: "manager",
              verdict: "NEEDS_CONFIRMATION",
              capability_ids: ["external.communicate"],
              object_ids: ["campaign-browser-1"],
              reasons: ["Owner confirmation required"],
              purpose: "PRIVATE TRACE PURPOSE MUST NOT RENDER",
              idempotency_key: "private-browser-idempotency",
              request_body: { prompt: "PRIVATE TRACE PROMPT MUST NOT RENDER" },
              policy_version: "1.1.0",
              evaluated_at: "2026-09-01T10:00:00.000Z",
              created_at: "2026-09-01T10:00:00.000Z"
            }
          ],
          limit: 50
        })
      });
    }
  );

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  const trace = page.getByRole("region", {
    name: "Почему Policy Runtime принял решение"
  });
  await expect(trace).toBeVisible();
  await expect(trace).toContainText("Нужно подтверждение");
  await expect(trace).toContainText("NEEDS_CONFIRMATION");
  await expect(trace).toContainText("Owner confirmation required");
  await expect(trace).toContainText("external.communicate");
  await expect(trace).toContainText("campaign-browser-1");
  await expect(trace).toContainText("manager");
  await expect(trace).toContainText("publish-campaign-browser-1");
  await expect(trace).toContainText("policy 1.1.0");
  await expect(trace).toContainText("request/result");
  await expect(trace).not.toContainText("PRIVATE TRACE PURPOSE MUST NOT RENDER");
  await expect(trace).not.toContainText("private-browser-idempotency");
  await expect(trace).not.toContainText("PRIVATE TRACE PROMPT MUST NOT RENDER");
  expect(traceRequests).toBeGreaterThan(0);
});

test("shows exact project usage without exposing provider routes or invented prices", async ({
  page,
  request
}) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for the Usage Ledger browser check.",
      client_message_id: `usage-ledger-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;

  await page.route(`**/api/v1/projects/${projectId}/usage-summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        project_id: projectId,
        generated_at: "2026-09-01T20:30:00.000Z",
        attempts: { total: 4, reserved: 1, committed: 2, failed: 1, cancelled: 0 },
        tokens: {
          committed_input: 1200,
          committed_output: 340,
          reserved_upper_bound: 500,
          unknown_committed_attempts: 0
        },
        costs: [{ currency: "USD", committed_amount: 0.125, reserved_amount: 0.04 }],
        unknown_committed_cost_attempts: 1,
        unknown_reserved_cost_attempts: 0,
        provider_id: "PRIVATE PROVIDER MUST NOT RENDER",
        model_id: "PRIVATE MODEL MUST NOT RENDER",
        prompt: "PRIVATE PROMPT MUST NOT RENDER"
      })
    });
  });

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  const usage = page.getByRole("region", { name: "Расходы и лимиты проекта" });
  await expect(usage).toBeVisible();
  await expect(usage).toContainText("1 540");
  await expect(usage).toContainText("1 200");
  await expect(usage).toContainText("340");
  await expect(usage).toContainText("500");
  await expect(usage).toContainText("0,125 USD");
  await expect(usage).toContainText("0,04 USD");
  await expect(usage).toContainText("НЕ НАСТРОЕН");
  await expect(usage).toContainText("Стоимость не подтверждена для 1 завершённых попыток.");
  await expect(usage).toContainText("Провайдер, модель, Registry route");
  await expect(usage).not.toContainText("PRIVATE PROVIDER MUST NOT RENDER");
  await expect(usage).not.toContainText("PRIVATE MODEL MUST NOT RENDER");
  await expect(usage).not.toContainText("PRIVATE PROMPT MUST NOT RENDER");
});

test("activates and reloads a durable project emergency stop without exposing resume", async ({
  page,
  request
}) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for the emergency-stop browser check.",
      client_message_id: `project-stop-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const stopStatusUrl = `http://127.0.0.1:3100/api/v1/operations/emergency-stop?project_id=${encodeURIComponent(projectId)}`;

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  const activate = page.getByRole("button", { name: "Активировать stop проекта" });
  await expect(activate).toBeDisabled();
  await page.getByLabel("Причина аварийной остановки").fill("Unexpected project behavior");
  await expect(activate).toBeDisabled();
  await page
    .getByLabel("Я понимаю: новые и активные runs этого проекта будут остановлены.")
    .check();
  await activate.click();

  await expect(page.getByRole("status")).toContainText("Project emergency stop активирован");
  const projectStopCard = page.locator("article").filter({ hasText: "Selected project stop" });
  await expect(projectStopCard).toContainText("ACTIVE");
  await expect(projectStopCard).toContainText("Unexpected project behavior");

  const stored = await request.get(stopStatusUrl);
  expect(stored.ok()).toBeTruthy();
  expect((await stored.json()) as Record<string, unknown>).toMatchObject({
    scope: "project",
    project_id: projectId,
    active: true,
    reason: "Unexpected project behavior"
  });

  await page.reload();
  await expect(projectStopCard).toContainText("ACTIVE");
  await expect(projectStopCard).toContainText("Unexpected project behavior");
  await expect(page.getByText("Project emergency stop уже активен")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /resume|возобновить|снять остановку/i })
  ).toHaveCount(0);
});

test("requires explicit process-stop intent and omits a project id", async ({ page, request }) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for the process-stop browser contract.",
      client_message_id: `process-stop-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const activatedAt = "2026-09-01T04:00:00.000Z";
  const processStop = {
    scope: "process",
    project_id: null,
    active: true,
    reason: "Contain the full runtime",
    activated_at: activatedAt,
    activated_by: "local-owner"
  } as const;
  let processStopRequests = 0;

  await page.route("**/api/v1/operations/emergency-stop", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    processStopRequests += 1;
    expect(route.request().postDataJSON()).toEqual({
      scope: "process",
      reason: "Contain the full runtime"
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(processStop)
    });
  });
  await page.route("**/api/v1/operations/status", async (route) => {
    if (processStopRequests === 0) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generated_at: activatedAt,
        active_runs: 0,
        process_stop: processStop,
        active_project_stops: 0,
        metrics: {
          runs_started: 0,
          runs_completed: 0,
          runs_failed: 0,
          runs_cancelled: 0,
          route_attempts: 0,
          route_failures: {
            ROUTE_UNAVAILABLE: 0,
            PROVIDER_TIMEOUT: 0,
            PROVIDER_ERROR: 0,
            CIRCUIT_OPEN: 0,
            INTERRUPTED: 0,
            EMERGENCY_STOP: 0
          },
          last_failure_at: null
        },
        alerts: [
          {
            code: "PROCESS_EMERGENCY_STOP",
            severity: "critical",
            message: "Process emergency stop is active."
          }
        ]
      })
    });
  });

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);
  await page.getByRole("button", { name: "Весь процесс" }).click();
  const activate = page.getByRole("button", { name: "Активировать stop процесса" });
  await page.getByLabel("Причина аварийной остановки").fill("Contain the full runtime");
  await expect(activate).toBeDisabled();
  await page
    .getByLabel("Я понимаю: новые и активные runs всех проектов будут остановлены.")
    .check();
  await activate.click();

  await expect(page.getByRole("status")).toContainText("Process emergency stop активирован");
  expect(processStopRequests).toBe(1);
  const processStopCard = page
    .locator("article")
    .filter({ hasText: "Process emergency stop" })
    .first();
  await expect(processStopCard).toContainText("ACTIVE");
  await expect(processStopCard).toContainText("Contain the full runtime");
  await expect(
    page.getByRole("button", { name: /resume|возобновить|снять остановку/i })
  ).toHaveCount(0);
});

test("requires explicit review before approving or rejecting confirmation cards", async ({
  page,
  request
}) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for confirmation decision browser checks.",
      client_message_id: `confirmation-control-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;

  const confirmation = (input: {
    id: string;
    operationId: string;
    capabilityId: string;
    objectId: string;
    purpose: string;
    challengeNonce: string;
    requiresStepUp: boolean;
  }) => ({
    confirmation_id: input.id,
    project_id: projectId,
    operation_id: input.operationId,
    actor_id: "manager",
    intent: {
      operation_id: input.operationId,
      project_id: projectId,
      actor_id: "manager",
      capability_ids: [input.capabilityId],
      object_ids: [input.objectId],
      purpose: input.purpose,
      idempotency_key: `${input.operationId}-once`
    },
    verdict: {
      operation_id: input.operationId,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        { capability_id: input.capabilityId, mode: "CONFIRM", scope: [], conditions: [] }
      ],
      permission_ids: [],
      reasons: ["Owner confirmation required"],
      evaluated_at: "2026-08-31T22:20:00.000Z",
      policy_version: "1.1.0"
    },
    status: "PENDING",
    challenge_nonce: input.challengeNonce,
    requires_step_up: input.requiresStepUp,
    requested_at: "2026-08-31T22:20:00.000Z",
    expires_at: "2026-09-01T22:20:00.000Z",
    decided_at: null,
    decided_by: null,
    decision_reason: null
  });

  const critical = confirmation({
    id: "critical-confirmation-e2e",
    operationId: "critical-operation-e2e",
    capabilityId: "finance.spend",
    objectId: "invoice-browser-1",
    purpose: "Pay an approved browser-test invoice",
    challengeNonce: "critical-challenge-nonce-e2e",
    requiresStepUp: true
  });
  const routine = confirmation({
    id: "routine-confirmation-e2e",
    operationId: "routine-operation-e2e",
    capabilityId: "external.communicate",
    objectId: "campaign-browser-1",
    purpose: "Publish a campaign update",
    challengeNonce: "routine-challenge-nonce-e2e",
    requiresStepUp: false
  });

  await page.route(`**/api/v1/projects/${projectId}/confirmations`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [critical, routine] })
    });
  });
  await page.route("**/api/v1/confirmations/critical-confirmation-e2e/approve", async (route) => {
    const body = route.request().postDataJSON() as {
      challenge_nonce: string;
      reason?: string;
    };
    expect(body).toEqual({
      challenge_nonce: critical.challenge_nonce,
      reason: "Approved inside the current budget"
    });
    expect(route.request().headers()["x-step-up-token"]).toBe("browser-step-up-proof");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...critical,
        status: "APPROVED",
        decided_at: "2026-08-31T22:21:00.000Z",
        decided_by: "local-owner",
        decision_reason: body.reason ?? null
      })
    });
  });
  await page.route("**/api/v1/confirmations/routine-confirmation-e2e/reject", async (route) => {
    const body = route.request().postDataJSON() as {
      challenge_nonce: string;
      reason?: string;
    };
    expect(body).toEqual({
      challenge_nonce: routine.challenge_nonce,
      reason: "Campaign timing is not approved"
    });
    expect(route.request().headers()["x-step-up-token"]).toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...routine,
        status: "REJECTED",
        decided_at: "2026-08-31T22:22:00.000Z",
        decided_by: "local-owner",
        decision_reason: body.reason ?? null
      })
    });
  });

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  const pendingMetric = page.locator("article").filter({ hasText: "Ожидают решения" }).first();
  await expect(pendingMetric).toContainText("2");

  const criticalCard = page
    .locator("article")
    .filter({ hasText: "Pay an approved browser-test invoice" })
    .first();
  await expect(criticalCard).toContainText("invoice-browser-1");
  await expect(criticalCard).toContainText("Owner confirmation required");
  await criticalCard.getByRole("button", { name: "Рассмотреть" }).click();
  const approve = criticalCard.getByRole("button", { name: "Одобрить" });
  await expect(approve).toBeDisabled();
  await criticalCard.getByLabel("Комментарий владельца").fill("Approved inside the current budget");
  await criticalCard.getByLabel("Я проверил действие, цель, объекты, риск и срок.").check();
  await expect(approve).toBeDisabled();
  await criticalCard
    .getByLabel("Одноразовый step-up токен для одобрения")
    .fill("browser-step-up-proof");
  await approve.click();

  await expect(page.getByRole("status")).toContainText("Действие одобрено");
  await expect(pendingMetric).toContainText("1");
  await expect(page.getByLabel("Одноразовый step-up токен для одобрения")).toHaveCount(0);

  const routineCard = page
    .locator("article")
    .filter({ hasText: "Publish a campaign update" })
    .first();
  await routineCard.getByRole("button", { name: "Рассмотреть" }).click();
  const reject = routineCard.getByRole("button", { name: "Отклонить" });
  await expect(reject).toBeDisabled();
  await routineCard.getByLabel("Комментарий владельца").fill("Campaign timing is not approved");
  await routineCard.getByLabel("Я проверил действие, цель, объекты, риск и срок.").check();
  await reject.click();

  await expect(page.getByRole("status")).toContainText("Действие отклонено");
  await expect(page.getByText("Нет ожидающих подтверждений.")).toBeVisible();
  await expect(page.locator('[data-status="APPROVED"]')).toHaveCount(1);
  await expect(page.locator('[data-status="REJECTED"]')).toHaveCount(1);
});
