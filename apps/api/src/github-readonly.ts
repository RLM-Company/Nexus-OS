import type { GitHubTokenResolver } from "@cosmora/config";
import type {
  GitHubBranch,
  GitHubCiStatus,
  GitHubCommit,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepository,
  GitHubRepositorySummary
} from "@cosmora/contracts";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_ITEMS = 20;
const repositorySegment = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

export type GitHubReadonlyResult<T> =
  { kind: "ok"; value: T } | { kind: "not_configured" } | { kind: "unavailable" };

export interface GitHubReadonlyService {
  status(): Promise<{ configured: boolean }>;
  listRepositories(): Promise<GitHubReadonlyResult<GitHubRepository[]>>;
  getRepositorySummary(
    owner: string,
    repository: string
  ): Promise<GitHubReadonlyResult<GitHubRepositorySummary>>;
}

type FetchLike = typeof fetch;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown, fallback = "Unknown"): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

const boundedMessage = (value: unknown): string => asString(value).slice(0, 500);

const isRepositorySegment = (value: string): boolean => repositorySegment.test(value);

const mapRepository = (value: unknown): GitHubRepository | null => {
  const repository = asRecord(value);
  const owner = asRecord(repository?.owner);
  if (!repository || !owner) return null;
  const ownerLogin = asString(owner.login, "");
  const name = asString(repository.name, "");
  const htmlUrl = asString(repository.html_url, "");
  if (!isRepositorySegment(ownerLogin) || !isRepositorySegment(name)) return null;
  if (htmlUrl !== `https://github.com/${ownerLogin}/${name}`) return null;
  return {
    id: asString(repository.id, `${ownerLogin}/${name}`),
    owner: ownerLogin,
    name,
    default_branch: asString(repository.default_branch, "main"),
    visibility: repository.private === true ? "private" : "public",
    web_url: htmlUrl
  };
};

const mapBranches = (value: unknown): GitHubBranch[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const branch = asRecord(entry);
    const commit = asRecord(branch?.commit);
    const name = asString(branch?.name, "");
    const sha = asString(commit?.sha, "");
    return name && sha
      ? [{ name, protected: branch?.protected === true, last_commit_sha: sha.slice(0, 128) }]
      : [];
  });

const mapCommits = (value: unknown): GitHubCommit[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const commit = asRecord(entry);
    const nestedCommit = asRecord(commit?.commit);
    const author = asRecord(nestedCommit?.author);
    const sha = asString(commit?.sha, "");
    return sha
      ? [
          {
            sha: sha.slice(0, 128),
            short_sha: sha.slice(0, 7),
            message: boundedMessage(nestedCommit?.message),
            author: asString(author?.name)
          }
        ]
      : [];
  });

const mapIssues = (value: unknown): GitHubIssue[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const issue = asRecord(entry);
    if (!issue || issue.pull_request !== undefined) return [];
    const number = asNumber(issue.number);
    return Number.isInteger(number) && number > 0
      ? [
          {
            number,
            title: boundedMessage(issue.title),
            state: issue.state === "closed" ? "closed" : "open"
          }
        ]
      : [];
  });

const mapPullRequests = (value: unknown): GitHubPullRequest[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const pullRequest = asRecord(entry);
    const head = asRecord(pullRequest?.head);
    const base = asRecord(pullRequest?.base);
    const number = asNumber(pullRequest?.number);
    if (!Number.isInteger(number) || number < 1 || !head || !base) return [];
    return [
      {
        number,
        title: boundedMessage(pullRequest?.title),
        state: pullRequest?.merged_at
          ? "merged"
          : pullRequest?.state === "closed"
            ? "closed"
            : "open",
        source_branch: asString(head.ref),
        target_branch: asString(base.ref)
      }
    ];
  });

const mapCiStatus = (sha: string, value: unknown): GitHubCiStatus => {
  const response = asRecord(value);
  const runs = Array.isArray(response?.check_runs) ? response.check_runs : [];
  const checks = runs.slice(0, MAX_ITEMS).map((entry) => {
    const run = asRecord(entry);
    const conclusion = run?.conclusion;
    return {
      name: asString(run?.name),
      conclusion:
        conclusion === "success"
          ? "success"
          : conclusion === null || conclusion === undefined
            ? "pending"
            : "failure"
    } as const;
  });
  const state = checks.some((check) => check.conclusion === "pending")
    ? "pending"
    : checks.some((check) => check.conclusion === "failure")
      ? "failure"
      : checks.length > 0
        ? "success"
        : "pending";
  return { sha, state, checks };
};

export class GitHubReadonlyClient implements GitHubReadonlyService {
  readonly #secretResolver: GitHubTokenResolver;
  readonly #fetch: FetchLike;

  constructor(options: { secretResolver: GitHubTokenResolver; fetch?: FetchLike }) {
    this.#secretResolver = options.secretResolver;
    this.#fetch = options.fetch ?? fetch;
  }

  async status(): Promise<{ configured: boolean }> {
    const token = await this.#secretResolver.resolve("GITHUB_TOKEN");
    return { configured: token !== null };
  }

  async listRepositories(): Promise<GitHubReadonlyResult<GitHubRepository[]>> {
    const response = await this.#request(
      "/user/repos?affiliation=owner%2Ccollaborator&sort=updated&per_page=50"
    );
    if (response.kind !== "ok") return response;
    return {
      kind: "ok",
      value: (Array.isArray(response.value) ? response.value : []).flatMap((entry) => {
        const repository = mapRepository(entry);
        return repository ? [repository] : [];
      })
    };
  }

  async getRepositorySummary(
    owner: string,
    repository: string
  ): Promise<GitHubReadonlyResult<GitHubRepositorySummary>> {
    if (!isRepositorySegment(owner) || !isRepositorySegment(repository)) {
      return { kind: "unavailable" };
    }
    const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
    const [repositoryResponse, branches, commits, issues, pullRequests] = await Promise.all([
      this.#request(basePath),
      this.#request(`${basePath}/branches?per_page=${MAX_ITEMS}`),
      this.#request(`${basePath}/commits?per_page=${MAX_ITEMS}`),
      this.#request(`${basePath}/issues?state=open&per_page=${MAX_ITEMS}`),
      this.#request(`${basePath}/pulls?state=open&per_page=${MAX_ITEMS}`)
    ]);
    if (repositoryResponse.kind !== "ok") return repositoryResponse;
    if (branches.kind !== "ok") return branches;
    if (commits.kind !== "ok") return commits;
    if (issues.kind !== "ok") return issues;
    if (pullRequests.kind !== "ok") return pullRequests;
    const mappedRepository = mapRepository(repositoryResponse.value);
    if (!mappedRepository) return { kind: "unavailable" };
    const mappedCommits = mapCommits(commits.value);
    if (mappedCommits.length === 0) {
      return {
        kind: "ok",
        value: {
          repository: mappedRepository,
          branches: mapBranches(branches.value),
          commits: mappedCommits,
          issues: mapIssues(issues.value),
          pull_requests: mapPullRequests(pullRequests.value),
          ci: { sha: mappedRepository.default_branch, state: "pending", checks: [] }
        }
      };
    }
    const latestCommit = mappedCommits[0];
    if (!latestCommit) return { kind: "unavailable" };
    const ci = await this.#request(
      `${basePath}/commits/${encodeURIComponent(latestCommit.sha)}/check-runs`
    );
    if (ci.kind !== "ok") return ci;
    return {
      kind: "ok",
      value: {
        repository: mappedRepository,
        branches: mapBranches(branches.value),
        commits: mappedCommits,
        issues: mapIssues(issues.value),
        pull_requests: mapPullRequests(pullRequests.value),
        ci: mapCiStatus(latestCommit.sha, ci.value)
      }
    };
  }

  async #request(path: string): Promise<GitHubReadonlyResult<unknown>> {
    const token = await this.#secretResolver.resolve("GITHUB_TOKEN");
    if (!token) return { kind: "not_configured" };
    try {
      const response = await this.#fetch(`${GITHUB_API_ORIGIN}${path}`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "Cosmora-local-alpha"
        }
      });
      if (!response.ok) return { kind: "unavailable" };
      return { kind: "ok", value: (await response.json()) as unknown };
    } catch {
      return { kind: "unavailable" };
    }
  }
}
