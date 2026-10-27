import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { loadServerConfig } from "@cosmora/config";
import { ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { GithubIntegration } from "../src/github-integration.js";
import { GithubIssuesClient } from "../src/github-issues-client.js";
import { registerGithubIssueRoutes } from "../src/github-issue-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";
import { buildApp } from "../src/app.js";
import {
  githubIssueHttpFixture,
  issueBody,
  issueData,
  issueRepository
} from "./fixtures/github-issues-http.js";

const resources: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
});
async function fixture() {
  const http = await githubIssueHttpFixture();
  resources.push(http.close);
  const database = openDatabase(":memory:");
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite);
  projects.createEmptyProject("project-1", "First");
  projects.createEmptyProject("foreign", "Foreign", "other-owner");
  const integration = new GithubIntegration({
    token: "issues-fixture-token",
    fetchImplementation: http.fetchImplementation
  });
  const app = Fastify();
  let identity = { ...LOCAL_DEVELOPMENT_IDENTITY };
  registerGithubIssueRoutes({ app, integration, projects, identityFor: () => identity });
  resources.push(async () => {
    await app.close();
    database.close();
  });
  return {
    http,
    database,
    projects,
    integration,
    app,
    changeIdentity: (value: typeof identity) => {
      identity = value;
    },
    base: "/api/v1/projects/project-1/github-issues"
  };
}
describe("configured GitHub Issues HTTP boundary", () => {
  it("lists only issues, searches literal text inside one fixed repository, and filters state", async () => {
    const f = await fixture();
    const listed = await f.app.inject({
      url: f.base + "?repository=Other/Repo&url=http://127.0.0.1"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json<{ items: unknown[] }>().items).toHaveLength(1);
    const closed = await f.app.inject({
      url: f.base + "?state=closed&query=" + encodeURIComponent("repo:Other/Repo OR is:pr")
    });
    expect(closed.json<{ items: Array<{ state: string }> }>().items[0]?.state).toBe("closed");
    const query = new URL(f.http.calls[1]!.url, "http://fixture.invalid").searchParams.get("q");
    expect(query).toBe(
      'repo:RLM-Company/Nexus-OS is:issue state:closed in:title,body "repo:Other/Repo OR is:pr"'
    );
    expect(
      f.http.calls.every(
        (call) => call.method === "GET" && call.authorization === "Bearer issues-fixture-token"
      )
    ).toBe(true);
    expect(listed.body).not.toContain("issues-fixture-token");
  });
  it("returns literal bounded body, canonical link and explicit truncation without loading issue URLs", async () => {
    const f = await fixture();
    const result = (await f.app.inject({ url: f.base + "/1" })).json<{
      issue: { body: string; url: string };
    }>();
    expect(result.issue.body).toBe(issueBody);
    expect(result.issue.url).toBe(`https://github.com/${issueRepository}/issues/1`);
    const large = (await f.app.inject({ url: f.base + "/2" })).json<{
      issue: { body: string; body_truncated: boolean; body_total_chars: number };
    }>();
    expect(large.issue).toMatchObject({ body_truncated: true, body_total_chars: 30_000 });
    expect(large.issue.body).toHaveLength(24_000);
    expect(f.http.calls).toHaveLength(2);
  });
  it("checks owner/project and rejects invalid page, number and search before network access", async () => {
    const f = await fixture();
    for (const suffix of [
      "?page=0",
      "?page=11",
      "/-1",
      "/2147483648",
      "/hello",
      "?state=any",
      "?query=" + encodeURIComponent('a" repo:Other/Repo'),
      "?query=" + "a".repeat(161)
    ])
      expect((await f.app.inject({ url: f.base + suffix })).statusCode).toBe(400);
    expect((await f.app.inject({ url: "/api/v1/projects/foreign/github-issues" })).statusCode).toBe(
      404
    );
    f.changeIdentity({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: "other-owner" });
    expect((await f.app.inject({ url: f.base })).statusCode).toBe(404);
    f.changeIdentity({ ...LOCAL_DEVELOPMENT_IDENTITY, actor_kind: "agent" });
    expect((await f.app.inject({ url: f.base })).statusCode).toBe(404);
    expect(f.http.calls).toHaveLength(0);
  });
  it("keeps page bounds and incomplete search explicit, without following GitHub Link headers", async () => {
    const f = await fixture();
    f.http.respond((_request, response) => {
      response.setHeader("link", '<https://evil.invalid>; rel="next"');
      response.end(JSON.stringify(Array.from({ length: 20 }, (_, i) => issueData(i + 1))));
      return true;
    });
    expect((await f.app.inject({ url: f.base + "?page=1" })).json()).toMatchObject({
      next_page: 2,
      limited: false
    });
    expect((await f.app.inject({ url: f.base + "?page=10" })).json()).toMatchObject({
      next_page: null,
      limited: true
    });
    f.http.respond((_request, response) => {
      response.end(
        JSON.stringify({ items: [issueData()], total_count: 500, incomplete_results: true })
      );
      return true;
    });
    expect((await f.app.inject({ url: f.base + "?query=bug" })).json()).toMatchObject({
      next_page: 2,
      limited: true
    });
    expect(f.http.calls).toHaveLength(3);
  });
  it.each([
    [401, 403],
    [403, 403],
    [404, 404],
    [410, 404],
    [429, 429],
    [500, 503]
  ])(
    "shows upstream %i honestly, without expanding permissions or retry",
    async (upstream, expected) => {
      const f = await fixture();
      f.http.respond((_request, response) => {
        response.statusCode = upstream;
        response.end("issues-fixture-token");
        return true;
      });
      const result = await f.app.inject({ url: f.base });
      expect(result.statusCode).toBe(expected);
      expect(result.body).not.toContain("issues-fixture-token");
      expect(f.http.calls).toHaveLength(1);
    }
  );
  it("fails closed on foreign repositories, PR details, malformed or oversized response bodies and redirects", async () => {
    const f = await fixture();
    for (const body of [
      JSON.stringify({ ...issueData(), repository_url: "https://api.github.com/repos/Other/Repo" }),
      JSON.stringify({ ...issueData(), pull_request: {} }),
      "{}",
      "{",
      "x".repeat(2_000_001)
    ]) {
      f.http.respond((_request, response) => {
        response.end(body);
        return true;
      });
      expect((await f.app.inject({ url: f.base + "/1" })).statusCode).toBeGreaterThanOrEqual(400);
    }
    f.http.respond((_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1:9/secret" });
      response.end();
      return true;
    });
    expect((await f.app.inject({ url: f.base })).statusCode).toBe(503);
    expect(f.http.calls).toHaveLength(6);
  });
  it("aborts a stalled real HTTP response on timeout and explicit cancellation; releases concurrency", async () => {
    const f = await fixture();
    let closed = 0;
    f.http.respond((_request, response) => {
      response.writeHead(200);
      response.write("[");
      response.once("close", () => {
        closed++;
      });
      return true;
    });
    const client = new GithubIssuesClient({
      repository: issueRepository,
      configured: true,
      fetchImplementation: f.http.fetchImplementation,
      timeoutMs: 60
    });
    await expect(client.list()).rejects.toThrow("GITHUB_ISSUES_TIMEOUT");
    await expect.poll(() => closed).toBe(1);
    const controller = new AbortController();
    const reads = Array.from({ length: 4 }, () => f.integration.issues.list({}, controller.signal));
    await expect(f.integration.issues.list()).rejects.toThrow("GITHUB_ISSUES_BUSY");
    controller.abort();
    expect((await Promise.allSettled(reads)).every((result) => result.status === "rejected")).toBe(
      true
    );
    f.http.respond((_request, response) => {
      response.end("[]");
      return true;
    });
    expect((await f.integration.issues.list()).items).toEqual([]);
  });
  it("closes upstream reading when the actual API caller disconnects", async () => {
    const f = await fixture();
    let closed = false;
    f.http.respond((_request, response) => {
      response.writeHead(200);
      response.write("[");
      response.once("close", () => {
        closed = true;
      });
      return true;
    });
    const url = await f.app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const pending = fetch(url + f.base, { signal: controller.signal }).catch(() => undefined);
    await expect.poll(() => f.http.calls.length).toBe(1);
    controller.abort();
    await pending;
    await expect.poll(() => closed).toBe(true);
  });
  it("wires the route into buildApp and reports unconfigured integration without network access", async () => {
    const f = await fixture();
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: f.database,
      projectStore: f.projects,
      githubIntegration: new GithubIntegration(),
      identityResolver: new StaticIdentityResolver(LOCAL_DEVELOPMENT_IDENTITY)
    });
    resources.push(() => app.close());
    expect((await app.inject({ url: f.base })).statusCode).toBe(503);
    expect(f.http.calls).toHaveLength(0);
  });
});
