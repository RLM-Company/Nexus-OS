import { expect, test } from "@playwright/test";

test("fully redacts quoted secret-like Project Context values", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for quoted context redaction coverage.",
      client_message_id: `quoted-context-redaction-${Date.now()}`
    }
  });
  expect(created.ok()).toBeTruthy();

  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const storageKey = `cosmora:project-context:${projectId}`;

  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          sources: [
            {
              id: "quoted-secret-fixture",
              title: 'token="alpha beta gamma"',
              kind: "document",
              summary: "password='one two three' api_key=\"four five six\"",
              size: 100,
              connected: true
            }
          ]
        })
      );
    },
    { key: storageKey }
  );

  await page.goto(`/?project=${encodeURIComponent(projectId)}&view=context`);

  const panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  await expect(panel).toContainText("token=[скрыто]");
  await expect(panel).toContainText("password=[скрыто]");
  await expect(panel).toContainText("api_key=[скрыто]");
  await expect(panel).not.toContainText("alpha beta gamma");
  await expect(panel).not.toContainText("one two three");
  await expect(panel).not.toContainText("four five six");

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(stored).not.toContain("alpha beta gamma");
  expect(stored).not.toContain("one two three");
  expect(stored).not.toContain("four five six");
});
