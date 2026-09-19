import { expect, test } from "@playwright/test";
import { loadMockSkillCatalog } from "../src/app/skills/skills-manifest";

test("returns isolated copies of the mock Skills catalog", () => {
  const first = loadMockSkillCatalog();
  const second = loadMockSkillCatalog();

  expect(first).not.toBe(second);
  expect(first[0]).not.toBe(second[0]);
  expect(first[0]?.permissions).not.toBe(second[0]?.permissions);
  expect(first[0]?.permissions[0]).not.toBe(second[0]?.permissions[0]);

  const permission = first[0]?.permissions[0];
  if (!permission) throw new Error("expected mock skill permission");

  permission.label = "mutated label";
  permission.description = "mutated description";

  const third = loadMockSkillCatalog();
  expect(third[0]?.permissions[0]?.label).toBe("Проект");
  expect(third[0]?.permissions[0]?.description).toBe("Чтение текущего проекта без изменений.");
});
