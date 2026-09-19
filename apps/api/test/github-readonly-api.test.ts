import { loadServerConfig, type GitHubTokenResolver } from "@cosmora/config";
import type { GitHubRepositorySummary } from "@cosmora/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { GitHubReadonlyClient, type GitHubReadonlyService } from "../src/github-readonly.js";

const config = loadServerConfig({ NODE_ENV: "test" });

const repository = {
  id: "1",
  owner: "RLM-Company",
  name: "Nexus-OS",
  default_branch: "main",
  visibility: "private" as const,
  web_url: "https://github.com/RLM-Company/Nexus-OS"
};

const summary: GitHubRepositorySummary = {
  repository,
  branches: [{ name: "main", protected: true, last_commit_sha: "abc123" }],
  commits: [{ sha: "abc123", short_sha: "abc123", message: "Safe read", author: "Cosmora" }],
  issues: [{ number: 1, title: "Read-only", state: "open" }],
  pull_requests: [
    {
      number: 2,
      title: "No write actions",
      state: "open",
      source_branch: "safe",
      target_branch: "main"
    }
  ],
  ci: { sha: "abc123", state: "success", checks: [{ name: "check", conclusion: "success" }] }
};

const service = (configured = true): GitHubReadonlyService => ({
  status: () => Promise.resolve({ configured }),
  listRepositories: () =>
    Promise.resolve(
      configured
        ? { kind: "ok" as const, value: [repository] }
        : { kind: "not_configured" as const }
    ),
  getRepositorySummary: () =>
    Promise.resolve(
      configured ? { kind: "ok" as const, value: summary } : { kind: "not_configured" as const }
    )
});

describe("GitHub read-only API", () => {
  it("exposes only owner-side read-only data and no token", async () => {
    const app = buildApp({
      config,
      database: { ping: () => undefined },
      githubReadonly: service()
    });

    const status = await app.inject({ method: "GET", url: "/api/v1/github/status" });
    const repositories = await app.inject({ method: "GET", url: "/api/v1/github/repositories" });
    const loadedSummary = await app.inject({
      method: "GET",
      url: "/api/v1/github/repositories/RLM-Company/Nexus-OS/summary"
    });

    expect(status.json()).toEqual({ configured: true, mode: "read_only" });
    expect(repositories.json()).toEqual({ items: [repository] });
    expect(loadedSummary.json()).toEqual(summary);
    for (const response of [status, repositories, loadedSummary]) {
      expect(response.body).not.toContain("test-github-token");
      expect(response.body).not.toContain("Authorization");
    }
    await app.close();
  });

  it("fails closed when GitHub has not been configured", async () => {
    const app = buildApp({
      config,
      database: { ping: () => undefined },
      githubReadonly: service(false)
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/github/repositories" });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("GITHUB_NOT_CONFIGURED");
    expect(response.body).not.toContain("GITHUB_TOKEN");
    await app.close();
  });

  it("uses only fixed GitHub API GET URLs and rejects malformed repository paths", async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>();
    mockFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const resolver: GitHubTokenResolver = {
      resolve: () => Promise.resolve("test-github-token")
    };
    const client = new GitHubReadonlyClient({ secretResolver: resolver, fetch: mockFetch });

    await client.listRepositories();
    const malformed = await client.getRepositorySummary("owner/escape", "repository");

    expect(malformed).toEqual({ kind: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.github.com/user/repos?affiliation=owner%2Ccollaborator&sort=updated&per_page=50"
    );
    expect(options).toMatchObject({ method: "GET", redirect: "error" });
    expect(options?.headers).toMatchObject({ Authorization: "Bearer test-github-token" });
  });
});
