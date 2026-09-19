export type GitHubFailureKind = "not_configured" | "offline" | "unavailable" | "unknown";

export type GitHubResult<T> = { ok: true; data: T } | { ok: false; kind: GitHubFailureKind };

export type GitHubRepository = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: "private" | "public";
  webUrl: string;
};

export type GitHubBranch = {
  name: string;
  protected: boolean;
  lastCommitSha: string;
};

export type GitHubCommit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  sourceBranch: string;
  targetBranch: string;
};

export type GitHubCiStatus = {
  sha: string;
  state: "success" | "failure" | "pending" | "cancelled";
  checks: Array<{ name: string; conclusion: "success" | "failure" | "pending" }>;
};

type RepositoryQuery = { owner: string; repository: string };

export interface GitHubReadonlyAdapter {
  listRepositories(): Promise<GitHubResult<GitHubRepository[]>>;
  listBranches(query: RepositoryQuery): Promise<GitHubResult<GitHubBranch[]>>;
  listCommits(query: RepositoryQuery): Promise<GitHubResult<GitHubCommit[]>>;
  listIssues(query: RepositoryQuery): Promise<GitHubResult<GitHubIssue[]>>;
  listPullRequests(query: RepositoryQuery): Promise<GitHubResult<GitHubPullRequest[]>>;
  getCiStatus(query: RepositoryQuery & { sha: string }): Promise<GitHubResult<GitHubCiStatus>>;
}

export type GitHubPanelState =
  | { kind: "loading" }
  | { kind: "not_configured" }
  | { kind: "empty" }
  | { kind: "offline" }
  | { kind: "error" }
  | {
      kind: "ready";
      repository: GitHubRepository;
      branches: GitHubBranch[];
      commits: GitHubCommit[];
      issues: GitHubIssue[];
      pullRequests: GitHubPullRequest[];
      ci: GitHubCiStatus;
    };

export type MockGitHubMode = "ready" | "empty" | "offline" | "error";

const mockRepository: GitHubRepository = {
  id: "github-preview-repository",
  owner: "RLM-Company",
  name: "Nexus-OS",
  defaultBranch: "main",
  visibility: "private",
  webUrl: "https://github.com/RLM-Company/Nexus-OS"
};

const mockCommit: GitHubCommit = {
  sha: "403ed7143f062bb005a21c2fe1dde53434394e2a",
  shortSha: "403ed71",
  message: "Guarded live model smoke test",
  author: "Cosmora"
};

const failureFor = (mode: MockGitHubMode): GitHubResult<never> | null => {
  if (mode === "offline") return { ok: false, kind: "offline" };
  if (mode === "error") return { ok: false, kind: "unavailable" };
  return null;
};

export class MockGitHubReadonlyAdapter implements GitHubReadonlyAdapter {
  public constructor(private readonly mode: MockGitHubMode) {}

  private result<T>(value: T): GitHubResult<T> {
    const failure = failureFor(this.mode);
    if (failure) return failure;
    return { ok: true, data: this.mode === "empty" ? ([] as T) : value };
  }

  public listRepositories(): Promise<GitHubResult<GitHubRepository[]>> {
    return Promise.resolve(this.result([mockRepository]));
  }

  public listBranches(): Promise<GitHubResult<GitHubBranch[]>> {
    return Promise.resolve(
      this.result([
        { name: "main", protected: true, lastCommitSha: mockCommit.shortSha },
        {
          name: "codex/overnight-github-readonly",
          protected: false,
          lastCommitSha: mockCommit.shortSha
        }
      ])
    );
  }

  public listCommits(): Promise<GitHubResult<GitHubCommit[]>> {
    return Promise.resolve(this.result([mockCommit]));
  }

  public listIssues(): Promise<GitHubResult<GitHubIssue[]>> {
    return Promise.resolve(
      this.result([{ number: 150, title: "Read-only integration preview", state: "open" }])
    );
  }

  public listPullRequests(): Promise<GitHubResult<GitHubPullRequest[]>> {
    return Promise.resolve(
      this.result([
        {
          number: 151,
          title: "GitHub read-only layer",
          state: "open",
          sourceBranch: "codex/overnight-github-readonly",
          targetBranch: "main"
        }
      ])
    );
  }

  public getCiStatus(): Promise<GitHubResult<GitHubCiStatus>> {
    return Promise.resolve(
      this.result({
        sha: mockCommit.sha,
        state: "success",
        checks: [
          { name: "format", conclusion: "success" },
          { name: "typecheck", conclusion: "success" }
        ]
      })
    );
  }
}

type ApiErrorResponse = { error?: { code?: string } };

type ApiRepository = {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  visibility: "private" | "public";
  web_url: string;
};

type ApiRepositorySummary = {
  repository: ApiRepository;
  branches: Array<{ name: string; protected: boolean; last_commit_sha: string }>;
  commits: Array<{ sha: string; short_sha: string; message: string; author: string }>;
  issues: Array<{ number: number; title: string; state: "open" | "closed" }>;
  pull_requests: Array<{
    number: number;
    title: string;
    state: "open" | "closed" | "merged";
    source_branch: string;
    target_branch: string;
  }>;
  ci: GitHubCiStatus;
};

const toRepository = (repository: ApiRepository): GitHubRepository => ({
  id: repository.id,
  owner: repository.owner,
  name: repository.name,
  defaultBranch: repository.default_branch,
  visibility: repository.visibility,
  webUrl: safeGitHubUrl(repository.web_url)
});

export class ServerGitHubReadonlyAdapter implements GitHubReadonlyAdapter {
  readonly #summaries = new Map<string, Promise<GitHubResult<ApiRepositorySummary>>>();

  async listRepositories(): Promise<GitHubResult<GitHubRepository[]>> {
    const response = await this.#request<{ items: ApiRepository[] }>("/api/v1/github/repositories");
    return response.ok ? { ok: true, data: response.data.items.map(toRepository) } : response;
  }

  async listBranches(query: RepositoryQuery): Promise<GitHubResult<GitHubBranch[]>> {
    const summary = await this.#summary(query);
    return summary.ok
      ? {
          ok: true,
          data: summary.data.branches.map((branch) => ({
            name: branch.name,
            protected: branch.protected,
            lastCommitSha: branch.last_commit_sha
          }))
        }
      : summary;
  }

  async listCommits(query: RepositoryQuery): Promise<GitHubResult<GitHubCommit[]>> {
    const summary = await this.#summary(query);
    return summary.ok
      ? {
          ok: true,
          data: summary.data.commits.map((commit) => ({
            sha: commit.sha,
            shortSha: commit.short_sha,
            message: commit.message,
            author: commit.author
          }))
        }
      : summary;
  }

  async listIssues(query: RepositoryQuery): Promise<GitHubResult<GitHubIssue[]>> {
    const summary = await this.#summary(query);
    return summary.ok ? { ok: true, data: summary.data.issues } : summary;
  }

  async listPullRequests(query: RepositoryQuery): Promise<GitHubResult<GitHubPullRequest[]>> {
    const summary = await this.#summary(query);
    return summary.ok
      ? {
          ok: true,
          data: summary.data.pull_requests.map((pullRequest) => ({
            number: pullRequest.number,
            title: pullRequest.title,
            state: pullRequest.state,
            sourceBranch: pullRequest.source_branch,
            targetBranch: pullRequest.target_branch
          }))
        }
      : summary;
  }

  async getCiStatus(query: RepositoryQuery): Promise<GitHubResult<GitHubCiStatus>> {
    const summary = await this.#summary(query);
    return summary.ok ? { ok: true, data: summary.data.ci } : summary;
  }

  #summary(query: RepositoryQuery): Promise<GitHubResult<ApiRepositorySummary>> {
    const key = `${query.owner}/${query.repository}`;
    const existing = this.#summaries.get(key);
    if (existing) return existing;
    const request = this.#request<ApiRepositorySummary>(
      `/api/v1/github/repositories/${encodeURIComponent(query.owner)}/${encodeURIComponent(query.repository)}/summary`
    );
    this.#summaries.set(key, request);
    return request;
  }

  async #request<T>(path: string): Promise<GitHubResult<T>> {
    try {
      const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
      if (response.ok) return { ok: true, data: (await response.json()) as T };
      if (response.status === 503) {
        const error = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        if (error?.error?.code === "GITHUB_NOT_CONFIGURED") {
          return { ok: false, kind: "not_configured" };
        }
      }
      return { ok: false, kind: "unavailable" };
    } catch {
      return { ok: false, kind: "offline" };
    }
  }
}

export const safeGitHubUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const isSafeOrigin =
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "";

    return isSafeOrigin ? url.toString() : "https://github.com/";
  } catch {
    return "https://github.com/";
  }
};

const sanitizeRepository = (repository: GitHubRepository): GitHubRepository => ({
  id: repository.id,
  owner: repository.owner,
  name: repository.name,
  defaultBranch: repository.defaultBranch,
  visibility: repository.visibility,
  webUrl: safeGitHubUrl(repository.webUrl)
});

export async function loadGitHubPanel(adapter: GitHubReadonlyAdapter): Promise<GitHubPanelState> {
  const repositories = await adapter.listRepositories();
  if (!repositories.ok)
    return repositories.kind === "not_configured"
      ? { kind: "not_configured" }
      : repositories.kind === "offline"
        ? { kind: "offline" }
        : { kind: "error" };
  const firstRepository = repositories.data[0];
  if (!firstRepository) return { kind: "empty" };

  const repository = sanitizeRepository(firstRepository);
  const query = { owner: repository.owner, repository: repository.name };
  const [branches, commits, issues, pullRequests] = await Promise.all([
    adapter.listBranches(query),
    adapter.listCommits(query),
    adapter.listIssues(query),
    adapter.listPullRequests(query)
  ]);
  const failed = [branches, commits, issues, pullRequests].find((result) => !result.ok);
  if (failed && !failed.ok)
    return failed.kind === "not_configured"
      ? { kind: "not_configured" }
      : failed.kind === "offline"
        ? { kind: "offline" }
        : { kind: "error" };
  if (!branches.ok || !commits.ok || !issues.ok || !pullRequests.ok) return { kind: "error" };

  const ci = await adapter.getCiStatus({ ...query, sha: commits.data[0]?.sha ?? "" });
  if (!ci.ok)
    return ci.kind === "not_configured"
      ? { kind: "not_configured" }
      : ci.kind === "offline"
        ? { kind: "offline" }
        : { kind: "error" };

  return {
    kind: "ready",
    repository,
    branches: branches.data,
    commits: commits.data,
    issues: issues.data,
    pullRequests: pullRequests.data,
    ci: {
      sha: ci.data.sha,
      state: ci.data.state,
      checks: ci.data.checks.map(({ name, conclusion }) => ({ name, conclusion }))
    }
  };
}

export const githubWritePreviews = [
  "Создание ветки — только preview, действие не будет выполнено.",
  "Слияние pull request — только preview, действие не будет выполнено.",
  "Deploy — только preview, действие не будет выполнено."
] as const;
