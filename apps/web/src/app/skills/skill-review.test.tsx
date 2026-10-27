import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillReview } from "./skill-review";
import { SkillImport } from "./skill-import";
it("renders full historical and draft content as text and requires explicit review", () => {
  const draft = {
    name: "Current",
    summary: "Text",
    instructions: "<img src=x onerror=alert(1)>\r\n"
  };
  const html = renderToStaticMarkup(
    <SkillReview
      id="a"
      currentVersion={2}
      draft={draft}
      revision={{ ...draft, instructions: "Old text", version: 1, created_at: "" }}
      busy={false}
      onRestore={() => {}}
      onDownload={() => {}}
    />
  );
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(html).toContain("Old text");
  expect(html).toContain("Изменённых полей: 1");
  expect(html).toMatch(/disabled=""[^>]*>Восстановить версию 1/);
});
it("a current version can be downloaded but cannot be restored to itself", () => {
  const draft = { name: "Current", summary: "Text", instructions: "Body" };
  const html = renderToStaticMarkup(
    <SkillReview
      id="a"
      currentVersion={2}
      draft={draft}
      revision={{ ...draft, version: 2, created_at: "" }}
      busy={false}
      onRestore={() => {}}
      onDownload={() => {}}
    />
  );
  expect(html).toContain("Скачать пакет версии 2");
  expect(html).not.toContain("Восстановить версию 2");
});
it("import has a labelled file input and no create action before a checked package exists", () => {
  const html = renderToStaticMarkup(
    <SkillImport busy={false} blocked={false} onImport={() => Promise.resolve(true)} />
  );
  expect(html).toContain("Выберите пакет Skill");
  expect(html).not.toContain("Импортировать новую копию");
});
