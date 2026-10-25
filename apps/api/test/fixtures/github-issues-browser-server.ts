/** Browser-only fixture: real Issues routes/SQLite/HTTP GitHub transport; no model/provider adapter. */
import Fastify from "fastify";
import { ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { GithubIntegration } from "../../src/github-integration.js";
import { registerGithubIssueRoutes } from "../../src/github-issue-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../../src/identity.js";
import { githubIssueHttpFixture, issueData, issueRepository } from "./github-issues-http.js";
const database = openDatabase(":memory:");
await runMigrations(database);
const projects = new ProjectStore(database.sqlite);
projects.createEmptyProject("issue-project-a", "Проект Issues A");
projects.createEmptyProject("issue-project-b", "Проект Issues B");
const github = await githubIssueHttpFixture();
github.respond((request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  const query = url.searchParams.get("q") ?? "";
  if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
    response.end(JSON.stringify([issueData(), issueData(2)]));
    return true;
  }
  if (query.includes('"denied"')) {
    response.writeHead(403);
    response.end("{}");
    return true;
  }
  if (query.includes('"slow"')) {
    const timer = setTimeout(() => {
      if (!response.destroyed)
        response.end(
          JSON.stringify({ total_count: 1, incomplete_results: false, items: [issueData(111)] })
        );
    }, 500);
    timer.unref();
    return true;
  }
  return false;
});
const app = Fastify();
let dispatches = 0;
const integration = new GithubIntegration({
  token: "issues-browser-fixture",
  fetchImplementation: github.fetchImplementation
});
registerGithubIssueRoutes({
  app,
  integration,
  projects,
  identityFor: () => LOCAL_DEVELOPMENT_IDENTITY
});
app.get("/api/v1/health", () => ({ status: "ok" }));
app.get("/api/v1/projects", () => ({ items: projects.listProjects("local-owner") }));
app.get("/api/v1/github/status", () => ({
  configured: true,
  repository: issueRepository,
  default_branch: "main"
}));
app.get("/api/v1/projects/:projectId/code-agent", () => ({ items: [] }));
app.post("/api/v1/projects/:projectId/code-agent", (_request, reply) => {
  dispatches++;
  return reply.code(503).send({ error: { code: "FIXTURE_DISPATCH_BLOCKED" } });
});
app.get("/api/v1/issues-fixture-counts", () => ({
  dispatches,
  githubReads: github.calls.length,
  writes: github.calls.filter((call) => call.method !== "GET").length
}));
await app.listen({ host: "127.0.0.1", port: 3219 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => github.close())
      .finally(() => database.close());
  });
