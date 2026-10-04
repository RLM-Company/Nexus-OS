import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export class GithubIntegrationError extends Error {
  constructor(
    readonly code:
      | "GITHUB_UNAVAILABLE"
      | "GITHUB_NOT_CONFIGURED"
      | "GITHUB_INVALID_FILE"
      | "GITHUB_BASE_CHANGED"
      | "GITHUB_CONFLICT"
  ) {
    super(code);
  }
}
export interface GithubFileChange {
  path: string;
  content: string;
}
interface TreeEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
interface ChangePlan {
  repository: string;
  base_branch: string;
  base_sha: string;
  base_tree: string;
  branch: string;
  title: string;
  files: Array<GithubFileChange & { before: string | null; mode: string }>;
  review_hash: string;
}
export interface GithubDraft {
  id: string;
  project_id: string;
  status: "review" | "publishing" | "published" | "uncertain";
  plan: ChangePlan;
  pr_url: string | null;
  published_sha: string | null;
  created_at: string;
}
const validPath = (path: string): boolean => {
  const parts = path.split("/");
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.includes("\\") &&
    parts.every(
      (part) =>
        /^[\p{L}\p{N}._ -]+$/u.test(part) &&
        part !== "." &&
        part !== ".." &&
        !/^\.git$|^\.env(?:\.|$)|secret|credential|\.pem$|\.key$/i.test(part)
    ) &&
    !path.toLowerCase().startsWith(".github/")
  );
};
const text = (bytes: Uint8Array): string => {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0")) throw new Error("binary");
    return content;
  } catch {
    throw new GithubIntegrationError("GITHUB_INVALID_FILE");
  }
};
const sha = (value: string): string => {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new GithubIntegrationError("GITHUB_INVALID_FILE");
  return value;
};

export class GithubIntegration {
  readonly repository: string;
  readonly ownerId: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  constructor(
    options: {
      token?: string;
      repository?: string;
      ownerId?: string;
      fetchImplementation?: typeof fetch;
    } = {}
  ) {
    this.repository = options.repository ?? "RLM-Company/Nexus-OS";
    this.ownerId = options.ownerId ?? "local-owner";
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(this.repository))
      throw new Error("Invalid configured GitHub repository");
    this.#token = options.token?.trim() ?? "";
    this.#fetch = options.fetchImplementation ?? fetch;
  }
  get configured(): boolean {
    return this.#token.length > 0 && this.ownerId.length > 0;
  }
  async #request<T>(path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new GithubIntegrationError("GITHUB_NOT_CONFIGURED");
    try {
      const response = await this.#fetch(`https://api.github.com/repos/${this.repository}${path}`, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.#token}`,
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "content-type": "application/json"
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok || !response.body) throw new Error("GitHub unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 8_000_000) {
            await reader.cancel();
            throw new Error("Response too large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    } catch {
      throw new GithubIntegrationError("GITHUB_UNAVAILABLE");
    }
  }
  async status() {
    if (!this.configured)
      return { configured: false, repository: this.repository, default_branch: null };
    const repository = await this.#request<{ default_branch: string; private: boolean }>("");
    return {
      configured: true,
      repository: this.repository,
      default_branch: repository.default_branch,
      private: repository.private
    };
  }
  async branches() {
    const result =
      await this.#request<Array<{ name: string; commit: { sha: string } }>>(
        "/branches?per_page=100"
      );
    return {
      items: result.map((item) => ({ name: item.name, sha: item.commit.sha })),
      limited: result.length === 100
    };
  }
  async tree(ref: string) {
    if (!ref || ref.length > 240) throw new GithubIntegrationError("GITHUB_INVALID_FILE");
    const commit = await this.#request<{ sha: string; commit: { tree: { sha: string } } }>(
      `/commits/${encodeURIComponent(ref)}`
    );
    const result = await this.#request<{ tree: TreeEntry[]; truncated: boolean }>(
      `/git/trees/${sha(commit.commit.tree.sha)}?recursive=1`
    );
    return {
      sha: sha(commit.sha),
      tree_sha: sha(commit.commit.tree.sha),
      items: result.tree,
      truncated: result.truncated
    };
  }
  async file(blobSha: string) {
    const blob = await this.#request<{ content: string; encoding: string; size: number }>(
      `/git/blobs/${sha(blobSha)}`
    );
    if (blob.encoding !== "base64" || blob.size > 50_000 || blob.content.length > 70_000)
      throw new GithubIntegrationError("GITHUB_INVALID_FILE");
    const bytes = Buffer.from(blob.content, "base64");
    if (bytes.length > 50_000) throw new GithubIntegrationError("GITHUB_INVALID_FILE");
    return { sha: blobSha, content: text(bytes) };
  }
  async prepare(
    id: string,
    input: { base_branch: string; base_sha: string; title: string; files: GithubFileChange[] }
  ): Promise<ChangePlan> {
    if (!this.configured) throw new GithubIntegrationError("GITHUB_NOT_CONFIGURED");
    if (
      !input.title.trim() ||
      input.title.length > 160 ||
      input.files.length < 1 ||
      input.files.length > 8 ||
      new Set(input.files.map((file) => file.path)).size !== input.files.length ||
      input.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > 160_000
    )
      throw new GithubIntegrationError("GITHUB_INVALID_FILE");
    for (const file of input.files) {
      if (
        !validPath(file.path) ||
        Buffer.byteLength(file.content) > 50_000 ||
        file.content.includes("\0") ||
        file.content.includes(this.#token) ||
        /github_pat_|ghp_|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(file.content)
      )
        throw new GithubIntegrationError("GITHUB_INVALID_FILE");
    }
    const tree = await this.tree(input.base_branch);
    if (tree.sha !== input.base_sha) throw new GithubIntegrationError("GITHUB_BASE_CHANGED");
    if (tree.truncated) throw new GithubIntegrationError("GITHUB_INVALID_FILE");
    const files: ChangePlan["files"] = [];
    for (const file of input.files) {
      const entry = tree.items.find((item) => item.path === file.path);
      const parts = file.path.split("/");
      for (let index = 1; index < parts.length; index++) {
        const parent = tree.items.find((item) => item.path === parts.slice(0, index).join("/"));
        if (parent && parent.type !== "tree")
          throw new GithubIntegrationError("GITHUB_INVALID_FILE");
      }
      if (entry && (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)))
        throw new GithubIntegrationError("GITHUB_INVALID_FILE");
      const before = entry ? (await this.file(entry.sha)).content : null;
      if (before === file.content) throw new GithubIntegrationError("GITHUB_INVALID_FILE");
      files.push({ ...file, before, mode: entry?.mode ?? "100644" });
    }
    const plan = {
      repository: this.repository,
      base_branch: input.base_branch,
      base_sha: input.base_sha,
      base_tree: tree.tree_sha,
      branch: `cosmora/change-${id}`,
      title: input.title.trim(),
      files
    };
    return {
      ...plan,
      review_hash: createHash("sha256").update(JSON.stringify(plan)).digest("hex")
    };
  }
  async publish(
    plan: ChangePlan,
    allowed: () => boolean,
    onCommit: (sha: string) => void
  ): Promise<string> {
    if (plan.repository !== this.repository) throw new GithubIntegrationError("GITHUB_CONFLICT");
    const head = await this.tree(plan.base_branch);
    if (head.sha !== plan.base_sha) throw new GithubIntegrationError("GITHUB_BASE_CHANGED");
    const write = async <T>(path: string, body: unknown): Promise<T> => {
      if (!allowed()) throw new GithubIntegrationError("GITHUB_CONFLICT");
      return this.#request<T>(path, body);
    };
    const tree = await write<{ sha: string }>("/git/trees", {
      base_tree: plan.base_tree,
      tree: plan.files.map(({ path, content, mode }) => ({ path, content, mode, type: "blob" }))
    });
    const commit = await write<{ sha: string }>("/git/commits", {
      message: plan.title,
      tree: sha(tree.sha),
      parents: [plan.base_sha]
    });
    onCommit(sha(commit.sha));
    await write("/git/refs", { ref: `refs/heads/${plan.branch}`, sha: sha(commit.sha) });
    const pr = await write<{ html_url: string }>("/pulls", {
      title: plan.title,
      head: plan.branch,
      base: plan.base_branch,
      draft: true,
      body: "Изменения просмотрены и подтверждены владельцем в Cosmora.\n\nСоздана отдельная ветка. Требуется проверка перед слиянием."
    });
    const url = new URL(pr.html_url);
    if (
      url.origin !== "https://github.com" ||
      !url.pathname.startsWith(`/${this.repository}/pull/`)
    )
      throw new GithubIntegrationError("GITHUB_UNAVAILABLE");
    return url.href;
  }
  async reconcile(draft: GithubDraft): Promise<string | null> {
    if (draft.plan.repository !== this.repository)
      throw new GithubIntegrationError("GITHUB_CONFLICT");
    if (!draft.published_sha) return null;
    const owner = this.repository.split("/")[0]!;
    const prs = await this.#request<
      Array<{ html_url: string; head: { sha: string }; base: { ref: string } }>
    >(`/pulls?state=all&head=${encodeURIComponent(`${owner}:${draft.plan.branch}`)}&per_page=10`);
    const pr = prs.find(
      (item) => item.head.sha === draft.published_sha && item.base.ref === draft.plan.base_branch
    );
    if (!pr) return null;
    const url = new URL(pr.html_url);
    if (
      url.origin !== "https://github.com" ||
      !url.pathname.startsWith(`/${this.repository}/pull/`)
    )
      throw new GithubIntegrationError("GITHUB_UNAVAILABLE");
    return url.href;
  }
}

export class GithubDraftStore {
  constructor(readonly sqlite: DatabaseSync) {}
  get(id: string, owner: string): GithubDraft | null {
    const row = this.sqlite
      .prepare(
        "SELECT id, project_id, status, plan_json, pr_url, published_sha, created_at FROM github_change_drafts WHERE id = ? AND owner_id = ?"
      )
      .get(id, owner);
    if (!row) return null;
    const { plan_json, ...draft } = row;
    return { ...draft, plan: JSON.parse(String(plan_json)) as ChangePlan } as GithubDraft;
  }
  list(project: string, owner: string): GithubDraft[] {
    return this.sqlite
      .prepare(
        "SELECT id FROM github_change_drafts WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 20"
      )
      .all(project, owner)
      .map((row) => this.get(String(row.id), owner)!);
  }
  async create(
    owner: string,
    project: string,
    integration: GithubIntegration,
    input: Parameters<GithubIntegration["prepare"]>[1]
  ): Promise<GithubDraft> {
    const id = randomUUID();
    const plan = await integration.prepare(id, input);
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        "INSERT INTO github_change_drafts (id, owner_id, project_id, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, owner, project, JSON.stringify(plan), now, now);
    return this.get(id, owner)!;
  }
  claim(id: string, owner: string, hash: string): GithubDraft {
    const draft = this.get(id, owner);
    if (!draft || draft.status !== "review" || draft.plan.review_hash !== hash)
      throw new GithubIntegrationError("GITHUB_CONFLICT");
    const result = this.sqlite
      .prepare(
        "UPDATE github_change_drafts SET status = 'publishing', updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'review'"
      )
      .run(new Date().toISOString(), id, owner);
    if (result.changes !== 1) throw new GithubIntegrationError("GITHUB_CONFLICT");
    return draft;
  }
  finish(id: string, owner: string, url: string | null): void {
    this.sqlite
      .prepare(
        "UPDATE github_change_drafts SET status = ?, pr_url = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'publishing'"
      )
      .run(url ? "published" : "uncertain", url, new Date().toISOString(), id, owner);
  }
  checkpoint(id: string, owner: string, commit: string): void {
    this.sqlite
      .prepare(
        "UPDATE github_change_drafts SET published_sha = ? WHERE id = ? AND owner_id = ? AND status = 'publishing'"
      )
      .run(sha(commit), id, owner);
  }
  reconcile(id: string, owner: string, url: string): void {
    this.sqlite
      .prepare(
        "UPDATE github_change_drafts SET status = 'published', pr_url = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('publishing', 'uncertain')"
      )
      .run(url, new Date().toISOString(), id, owner);
  }
}
