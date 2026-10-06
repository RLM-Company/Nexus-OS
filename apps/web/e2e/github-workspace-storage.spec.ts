import { expect, test } from "@playwright/test";
import {
  readWorkspace,
  saveWorkspace,
  workspaceKey,
  changeSetError,
  type WorkspaceSnapshot
} from "../src/app/github/github-workspace";
const snapshot = (): WorkspaceSnapshot => ({
  version: 1,
  scope: "1".repeat(64),
  repository: "RLM-Company/Nexus-OS",
  branch: "feature/code",
  base_sha: "a".repeat(40),
  changes: [{ path: "app.ts", content: "new", before: "old" }],
  file: { path: "src/new.ts", original: "", content: "unstaged", isNew: true },
  title: "Several files",
  project: "project",
  draft_id: null,
  publication: null,
  saved_at: Date.now()
});
function storage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    }
  };
}
test("recovers the complete tab material and uncertain publication without persisting approval or credentials", () => {
  const store = storage();
  const saved = {
    ...snapshot(),
    draft_id: "draft",
    publication: "uncertain" as const,
    approve: true,
    token: "do-not-store"
  };
  expect(saveWorkspace(store, saved)).toBeNull();
  const raw = store.getItem(workspaceKey)!;
  expect(raw).not.toContain("approve");
  expect(raw).not.toContain("do-not-store");
  expect(readWorkspace(store, saved.scope, saved.repository).snapshot).toMatchObject({
    branch: "feature/code",
    base_sha: saved.base_sha,
    changes: saved.changes,
    file: saved.file,
    draft_id: "draft",
    publication: "uncertain"
  });
});
test("never restores a different owner/access binding or repository", () => {
  for (const [scope, repo] of [
    ["2".repeat(64), snapshot().repository],
    [snapshot().scope, "Other/Repo"]
  ]) {
    const store = storage();
    const saved = snapshot();
    saveWorkspace(store, saved);
    expect(readWorkspace(store, scope!, repo!).snapshot).toBeNull();
    expect(store.getItem(workspaceKey)).toBeNull();
  }
});
test("rejects damaged, expired, duplicate-path and oversized material without silent truncation", () => {
  const store = storage();
  const saved = snapshot();
  store.setItem(workspaceKey, "not-json");
  expect(readWorkspace(store, saved.scope, saved.repository).snapshot).toBeNull();
  saveWorkspace(store, saved);
  expect(
    readWorkspace(store, saved.scope, saved.repository, saved.saved_at + 8 * 24 * 60 * 60 * 1000)
      .snapshot
  ).toBeNull();
  expect(
    saveWorkspace(store, { ...saved, changes: [saved.changes[0]!, saved.changes[0]!] })
  ).not.toBeNull();
  expect(changeSetError([{ path: "large.ts", content: "я".repeat(25001) }])).toContain("50 КБ");
  expect(
    changeSetError(
      Array.from({ length: 4 }, (_, i) => ({ path: `${i}.ts`, content: "a".repeat(40001) }))
    )
  ).toContain("160 КБ");
  expect(
    saveWorkspace(store, { ...saved, changes: [{ path: ".env", content: "key", before: null }] })
  ).not.toBeNull();
  expect(
    saveWorkspace(store, {
      ...saved,
      file: { path: "file.ts", original: "", content: "ghp_example", isNew: true }
    })
  ).not.toBeNull();
  expect(
    saveWorkspace(store, {
      ...saved,
      changes: Array.from({ length: 8 }, (_, i) => ({
        path: `${i}.ts`,
        content: "\t".repeat(20000),
        before: "\t".repeat(50000)
      })),
      file: { path: "editor.ts", original: "\t".repeat(50000), content: "\t".repeat(50000) }
    })
  ).not.toBeNull();
});
test("keeps the last saved text on quota failure and reports unavailable storage", () => {
  const store = storage();
  const saved = snapshot();
  saveWorkspace(store, saved);
  const failing = {
    ...store,
    setItem: () => {
      throw new Error("quota");
    }
  };
  expect(saveWorkspace(failing, { ...saved, title: "newer" })).toContain("не сохранены");
  expect(readWorkspace(store, saved.scope, saved.repository).snapshot?.title).toBe(saved.title);
  expect(
    readWorkspace(
      {
        ...store,
        getItem: () => {
          throw new Error("denied");
        }
      },
      saved.scope,
      saved.repository
    ).notice
  ).toContain("Не удалось");
});
