import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/** Stage-three "Карточка уточняющего вопроса" (15 Nov 2026). The card is
 * announced by the current Koswork task through the same CustomEvent pattern as
 * `kosmora:open-work-plan`; it is scoped to the project, restored after reload
 * and an answer/skip is counted once. These are browser-only, no model calls. */
async function project(page: import("@playwright/test").Page) {
  const created = await page.request.post("/api/v1/projects", {
    data: { initial_message: "Уточняющий вопрос", client_message_id: randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
    } catch {
      /* Storage may be unavailable; the card test still exercises the surface. */
    }
  });
  await page.goto(`/?project=${encodeURIComponent(project.id)}&view=chat`);
  // The card mounts only once the Koswork project is active. A real question
  // arrives during a run, after this composer is ready.
  await expect(page.getByLabel("Сообщение менеджеру")).toBeEnabled();
  return project.id;
}

const ask = (page: import("@playwright/test").Page, projectId: string, required = false) =>
  page.evaluate(
    ({ projectId, required }) => {
      window.dispatchEvent(
        new CustomEvent("kosmora:clarification", {
          detail: {
            projectId,
            id: "clarification-1",
            question: "Какой формат отчёта подготовить?",
            options: ["PDF", "DOCX", "XLSX"],
            required
          }
        })
      );
    },
    { projectId, required }
  );

const card = (page: import("@playwright/test").Page) => page.locator("[data-clarification-status]");

test("option answer goes into the existing composer and counts once", async ({ page }) => {
  const projectId = await project(page);
  await ask(page, projectId);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("Какой формат отчёта подготовить?");
  await expect(card(page).getByRole("button", { name: /1\. PDF/ })).toBeVisible();
  await card(page)
    .getByRole("button", { name: /2\. DOCX/ })
    .click();
  await expect(card(page).getByRole("button", { name: /2\. DOCX/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await card(page).getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("2. DOCX");
  await expect(card(page)).toHaveAttribute("data-clarification-status", "answered");
  // A second submission cannot change the recorded answer.
  await expect(card(page).getByRole("button", { name: "Отправить", exact: true })).toHaveCount(0);
  await expect(card(page)).toContainText("Ответ принят: 2. DOCX");
});

test("free-text answer wins over a selected option and supports Ctrl+Enter", async ({ page }) => {
  const projectId = await project(page);
  await ask(page, projectId);
  await card(page)
    .getByRole("button", { name: /1\. PDF/ })
    .click();
  await card(page).getByLabel("Свой ответ").fill("Только PDF с подписью");
  await expect(card(page).getByRole("button", { name: /1\. PDF/ })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await card(page).getByLabel("Свой ответ").press("Control+Enter");
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("Только PDF с подписью");
});

test("optional skip is allowed and a required question waits for a decision", async ({ page }) => {
  const projectId = await project(page);
  await ask(page, projectId, false);
  await card(page).getByRole("button", { name: "Пропустить", exact: true }).click();
  await expect(card(page)).toHaveAttribute("data-clarification-status", "skipped");
  await expect(card(page)).toContainText("Уточнение пропущено.");
  await expect(card(page).getByRole("button", { name: "Пропустить", exact: true })).toHaveCount(0);

  const requiredPage = await page.context().newPage();
  const requiredId = await project(requiredPage);
  await ask(requiredPage, requiredId, true);
  await expect(card(requiredPage)).toContainText("Задача ждёт решения");
  await expect(
    card(requiredPage).getByRole("button", { name: "Пропустить", exact: true })
  ).toHaveCount(0);
  await card(requiredPage).getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(card(requiredPage)).toContainText("Выберите вариант или напишите свой ответ.");
  await card(requiredPage)
    .getByRole("button", { name: /3\. XLSX/ })
    .click();
  await card(requiredPage).getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(card(requiredPage)).toHaveAttribute("data-clarification-status", "answered");
});

test("card survives reload and keyboard option selection", async ({ page }) => {
  const projectId = await project(page);
  await ask(page, projectId);
  await card(page)
    .getByRole("button", { name: /3\. XLSX/ })
    .focus();
  await card(page)
    .getByRole("button", { name: /3\. XLSX/ })
    .press("Enter");
  await expect(card(page)).toHaveAttribute("data-clarification-status", "answered");
  await page.reload();
  await expect(card(page)).toHaveAttribute("data-clarification-status", "answered");
  await expect(card(page)).toContainText("Ответ принят: 3. XLSX");
  // The answer is inserted into the existing composer and survives reload as
  // an unsent draft; the owner still confirms sending through the normal flow.
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("3. XLSX");
});

test("a card from another task is never shown", async ({ page }) => {
  const projectId = await project(page);
  await page.evaluate((otherId) => {
    window.dispatchEvent(
      new CustomEvent("kosmora:clarification", {
        detail: {
          projectId: otherId,
          id: "foreign",
          question: "Чужой вопрос",
          options: ["A"],
          required: false
        }
      })
    );
  }, projectId + "-other");
  await expect(card(page)).toHaveCount(0);
});
