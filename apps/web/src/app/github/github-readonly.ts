export type GitHubFailureKind = "offline" | "unavailable" | "unknown";

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

const safeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : "https://github.com/";
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
  webUrl: safeUrl(repository.webUrl)
});

export async function loadGitHubPanel(adapter: GitHubReadonlyAdapter): Promise<GitHubPanelState> {
  const repositories = await adapter.listRepositories();
  if (!repositories.ok)
    return repositories.kind === "offline" ? { kind: "offline" } : { kind: "error" };
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
    return failed.kind === "offline" ? { kind: "offline" } : { kind: "error" };
  if (!branches.ok || !commits.ok || !issues.ok || !pullRequests.ok) return { kind: "error" };

  const ci = await adapter.getCiStatus({ ...query, sha: commits.data[0]?.sha ?? "" });
  if (!ci.ok) return ci.kind === "offline" ? { kind: "offline" } : { kind: "error" };

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
