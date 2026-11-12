export interface LocalChange {
  path: string;
  content: string;
  before: string | null;
}
export interface EditorFile {
  path: string;
  original: string;
  content: string;
  isNew?: boolean;
  stagedPath?: string;
}
export interface WorkspaceSnapshot {
  version: 1;
  scope: string;
  repository: string;
  branch: string;
  base_sha: string;
  changes: LocalChange[];
  file: EditorFile | null;
  title: string;
  project: string;
  draft_id: string | null;
  publication: "uncertain" | null;
  saved_at: number;
}
export const workspaceKey = "cosmora:github-workspace:v1";
const bytes = (value: string) => new TextEncoder().encode(value).length;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const validChangePath = (path: string) =>
  path.length > 0 &&
  path.length <= 240 &&
  !path.includes("\\") &&
  !path.toLowerCase().startsWith(".github/") &&
  path
    .split("/")
    .every(
      (part) =>
        /^[\p{L}\p{N}._ -]+$/u.test(part) &&
        part !== "." &&
        part !== ".." &&
        !/^\.git$|^\.env(?:\.|$)|secret|credential|\.pem$|\.key$/i.test(part)
    );
const safeText = (value: unknown): value is string =>
  typeof value === "string" &&
  bytes(value) <= 50_000 &&
  !value.includes("\0") &&
  !/github_pat_|ghp_|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value);
export function changeSetError(changes: Array<{ path: string; content: string }>): string | null {
  if (changes.length > 8) return "В одном наборе допускается до 8 файлов.";
  if (new Set(changes.map((item) => item.path)).size !== changes.length)
    return "Пути файлов должны быть уникальными.";
  if (changes.some((item) => !validChangePath(item.path)))
    return "Укажите уникальный путь текстового файла. Служебные и секретные пути недоступны.";
  if (changes.some((item) => !safeText(item.content)))
    return "Файл должен содержать текст UTF-8 до 50 КБ без ключей и секретов.";
  if (changes.reduce((sum, item) => sum + bytes(item.content), 0) > 160_000)
    return "Общий объём изменений превышает 160 КБ.";
  return null;
}
function validSnapshot(value: unknown, now: number): value is WorkspaceSnapshot {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.scope !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.scope) ||
    typeof value.repository !== "string" ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) ||
    typeof value.branch !== "string" ||
    !value.branch ||
    value.branch.length > 240 ||
    typeof value.base_sha !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.base_sha) ||
    typeof value.title !== "string" ||
    value.title.length > 160 ||
    typeof value.project !== "string" ||
    value.project.length > 240 ||
    (value.draft_id !== null &&
      (typeof value.draft_id !== "string" || value.draft_id.length > 240)) ||
    (value.publication !== null && value.publication !== "uncertain") ||
    (value.publication !== null && (!value.draft_id || !value.project)) ||
    typeof value.saved_at !== "number" ||
    !Number.isSafeInteger(value.saved_at) ||
    value.saved_at > now + 60_000 ||
    now - value.saved_at > 7 * 24 * 60 * 60 * 1000 ||
    !Array.isArray(value.changes) ||
    value.changes.length > 8
  )
    return false;
  if (
    !value.changes.every(
      (item: unknown) =>
        record(item) &&
        typeof item.path === "string" &&
        safeText(item.content) &&
        (item.before === null || safeText(item.before))
    )
  )
    return false;
  if (changeSetError(value.changes as LocalChange[])) return false;
  if (value.file !== null) {
    const file = value.file;
    if (
      !record(file) ||
      typeof file.path !== "string" ||
      file.path.length > 240 ||
      (file.path !== "" && !validChangePath(file.path)) ||
      !safeText(file.original) ||
      !safeText(file.content) ||
      (file.isNew !== undefined && typeof file.isNew !== "boolean") ||
      (file.stagedPath !== undefined &&
        (typeof file.stagedPath !== "string" || !validChangePath(file.stagedPath)))
    )
      return false;
  }
  return true;
}
export function readWorkspace(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: string,
  repository: string,
  now = Date.now()
): { snapshot: WorkspaceSnapshot | null; notice: string | null } {
  try {
    const raw = storage.getItem(workspaceKey);
    if (raw === null) return { snapshot: null, notice: null };
    if (bytes(raw) > 1_200_000) throw new Error("Oversize workspace");
    const value: unknown = JSON.parse(raw);
    if (!validSnapshot(value, now)) throw new Error("Invalid workspace");
    if (value.scope !== scope || value.repository !== repository) {
      storage.removeItem(workspaceKey);
      return {
        snapshot: null,
        notice:
          "Сохранённые правки относятся к другому владельцу, репозиторию или доступу и не восстановлены."
      };
    }
    return {
      snapshot: value,
      notice: "Правки этой вкладки восстановлены. Подтверждение отправки нужно дать заново."
    };
  } catch {
    try {
      storage.removeItem(workspaceKey);
    } catch {
      /* Storage may be disabled. */
    }
    return {
      snapshot: null,
      notice:
        "Не удалось восстановить правки этой вкладки: сохранение недоступно, повреждено или устарело."
    };
  }
}
export function saveWorkspace(
  storage: Pick<Storage, "setItem" | "removeItem">,
  snapshot: WorkspaceSnapshot
): string | null {
  try {
    if (!validSnapshot(snapshot, Date.now())) throw new Error("Invalid workspace");
    // Serialize only known data fields. Never persist credentials, approval or arbitrary response fields.
    const raw = JSON.stringify({
      version: 1,
      scope: snapshot.scope,
      repository: snapshot.repository,
      branch: snapshot.branch,
      base_sha: snapshot.base_sha,
      changes: snapshot.changes.map(({ path, content, before }) => ({ path, content, before })),
      file: snapshot.file && {
        path: snapshot.file.path,
        original: snapshot.file.original,
        content: snapshot.file.content,
        isNew: snapshot.file.isNew,
        stagedPath: snapshot.file.stagedPath
      },
      title: snapshot.title,
      project: snapshot.project,
      draft_id: snapshot.draft_id,
      publication: snapshot.publication,
      saved_at: snapshot.saved_at
    });
    if (bytes(raw) > 1_200_000) throw new Error("Oversize workspace");
    storage.setItem(workspaceKey, raw);
    return null;
  } catch {
    return "Последние правки не сохранены для reload. Оставьте вкладку открытой или скачайте файлы; лимиты хранения — 8 файлов, 160 КБ изменений и 1,2 МБ записи, без секретов.";
  }
}
export const changeBytes = (changes: Array<{ content: string }>) =>
  changes.reduce((sum, item) => sum + bytes(item.content), 0);
