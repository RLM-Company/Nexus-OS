import { expect, test } from "@playwright/test";

type Reference = { id: string; version: number };
type CreatedFunction = { function_id: string; version: number };
type CreatedPattern = { pattern_id: string; version: number };
type CreatedBlueprint = { blueprint_id: string; version: number };

const exactRefValue = (reference: Reference): string => JSON.stringify(reference);

test("saves proposal-only Agent Studio team changes without activation", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Agent Studio" })).toHaveAttribute(
    "href",
    "/agent-studio",
  );

  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create an empty project for the Agent Studio UI check.",
      client_message_id: `agent-studio-e2e-${nonce}`,
    },
  });
  expect(created.ok()).toBeTruthy();
  const projectBody = (await created.json()) as { project: { id: string } };
  const projectId = projectBody.project.id;
  const base = `http://127.0.0.1:3100/api/v1/projects/${encodeURIComponent(projectId)}/agent-studio`;

  const functionResponse = await request.post(`${base}/functions`, {
    headers: { "idempotency-key": `agent-studio-function-${nonce}` },
    data: {
      name: "E2E researcher",
      description: "Collects bounded evidence for the browser acceptance test.",
      result_contract: "Return findings and evidence references.",
    },
  });
  expect(functionResponse.ok()).toBeTruthy();
  const agentFunction = (await functionResponse.json()) as CreatedFunction;

  const patternResponse = await request.post(`${base}/patterns`, {
    headers: { "idempotency-key": `agent-studio-pattern-${nonce}` },
    data: {
      name: "E2E skeptical analyst",
      description: "Challenges weak evidence in the browser acceptance test.",
      instructions: "Separate facts from inference and identify counter-evidence.",
      allowed_function_ids: [agentFunction.function_id],
      known_limitations: ["May over-weight missing evidence."],
      test_status: "untested",
    },
  });
  expect(patternResponse.ok()).toBeTruthy();
  const pattern = (await patternResponse.json()) as CreatedPattern;

  const blueprintBody = (delegationDepth: number) => ({
    function_ref: { id: agentFunction.function_id, version: agentFunction.version },
    behavior_pattern_ref: { id: pattern.pattern_id, version: pattern.version },
    model_profile_ref: { id: "cosmora-mars", version: 1 },
    grant: {
      capability_ids: ["context.project.read"],
      tool_ids: [],
      data_scope_ids: ["project-memory"],
      object_ids: [projectId],
      budget: { currency: "USD", money_minor: 0, tokens: 1_000, operations: 0 },
      delegation_depth: delegationDepth,
      valid_until: "2030-01-01T00:00:00.000Z",
    },
    memory_scope: {
      read_mode: "project_segments",
      source_ids: ["project-memory"],
      write_back: "result_and_evidence",
    },
    task_contract: "Return the bounded browser acceptance result.",
    start_condition: "A later activation increment explicitly approves the proposal.",
    close_conditions: ["The result is accepted."],
  });

  const parentBlueprintResponse = await request.post(`${base}/blueprints`, {
    headers: { "idempotency-key": `agent-studio-parent-blueprint-${nonce}` },
    data: blueprintBody(1),
  });
  expect(parentBlueprintResponse.ok()).toBeTruthy();
  const parentBlueprint = (await parentBlueprintResponse.json()) as CreatedBlueprint;

  const childBlueprintResponse = await request.post(`${base}/blueprints`, {
    headers: { "idempotency-key": `agent-studio-child-blueprint-${nonce}` },
    data: {
      ...blueprintBody(0),
      task_contract: "Return one delegated browser acceptance result.",
    },
  });
  expect(childBlueprintResponse.ok()).toBeTruthy();
  const childBlueprint = (await childBlueprintResponse.json()) as CreatedBlueprint;

  await page.goto(`/agent-studio?project=${encodeURIComponent(projectId)}`);

  await expect(
    page.getByRole("heading", { name: "Структура агентов под контролем владельца" }),
  ).toBeVisible();
  await expect(page.getByText("Control plane · агенты не запущены")).toBeVisible();
  await expect(page.getByText("Proposal-only")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Предложенные агенты" })).toBeVisible();
  await expect(page.getByText("В этом проекте пока нет предложенных агентов.")).toBeVisible();

  await page
    .locator("#root-blueprint")
    .selectOption(exactRefValue({ id: parentBlueprint.blueprint_id, version: parentBlueprint.version }));
  await page.getByRole("button", { name: "Сохранить root proposal" }).click();
  await expect(
    page.getByText("Корневое предложение сохранено. Агент остаётся в состоянии proposed."),
  ).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Корневой агент" })).toHaveCount(1);

  await page.locator("#parent-instance").selectOption({ index: 1 });
  await page
    .locator("#child-blueprint")
    .selectOption(exactRefValue({ id: childBlueprint.blueprint_id, version: childBlueprint.version }));
  await page.getByRole("button", { name: "Сохранить delegated proposal" }).click();
  await expect(
    page.getByText("Дочернее предложение сохранено после проверки Policy Engine."),
  ).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Дочерний агент" })).toHaveCount(1);

  await expect(page.getByText("Предложен корневой агент")).toBeVisible();
  await expect(page.getByText("Предложен дочерний агент")).toBeVisible();
  await expect(page.getByRole("button", { name: /актив/i })).toHaveCount(0);
});
