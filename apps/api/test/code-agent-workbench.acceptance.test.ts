/**
 * Runnable Koscode workbench acceptance on a local synthetic git repository.
 *
 * Exercises the production CodeAgentService and real HTTP routes with a real
 * Node test run inside an isolated git repository. No model provider, external
 * GitHub or OCI image is used. The opt-in live GitHub script remains separate:
 * it requires an assigned test repository, GH_TOKEN and a pinned OCI image.
 *
 * Run:
 *   pnpm --filter @cosmora/api exec vitest run test/code-agent-workbench.acceptance.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { ManagerService } from "@cosmora/core";
import {
  EmergencyStopStore,
  PolicyStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { ModelGateway, ModelRegistry, ModelRouter } from "@cosmora/model-gateway";
import {
  renderCodeAgentUnifiedDiff,
  type CodeAgentWorkspaceRunner
} from "@cosmora/tool-runtime";
import { CodeAgentService } from "../src/code-agent/service.js";
import { CodeAgentStore } from "../src/code-agent/store.js";
import { registerCodeAgentRoutes } from "../src/code-agent/routes.js";
import { GithubDraftStore, GithubIntegration } from "../src/github-integration.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";

const baseSha = "a".repeat(40);
const baseTree = "b".repeat(40);
const sources: Record<string, string> = {
  "src/add.mjs": "export const add = (a, b) => a - b;\n",
  "src/add.test.mjs":
    "import assert from 'node:assert/strict';\nimport { add } from './add.mjs';\nconst baselineSum = add(2, 3);\nassert.equal(baselineSum, 5, 'baseline sum must be five');\n",
  "README.md": "# Synthetic workbench fixture\n"
};
const directories: string[] = [];
afterAll(async () => {
  await Promise.all(directories.map((d) => rm(d, { recursive: true, force: true })));
});

/** A real local git repository holding the small function and its test. */
async function createTestRepository() {
  const directory = await mkdtemp(join(tmpdir(), "oc5-koscode-test-repo-"));
  directories.push(directory);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  await mkdir(join(directory, "src"), { recursive: true });
  for (const [path, content] of Object.entries(sources))
    await writeFile(join(directory, path), content, "utf8");
  git("init", "-q");
  git("config", "user.email", "oc5@example.invalid");
  git("config", "user.name", "OpenCode 5");
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git("commit", "-qm", "baseline: small function and its test");
  return { directory, git };
}

async function harness(runner: CodeAgentWorkspaceRunner) {
  const directory = await mkdtemp(join(tmpdir(), "oc5-koscode-workbench-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "workbench.sqlite"));
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite),
    policy = new PolicyStore(database.sqlite),
    emergency = new EmergencyStopStore(database.sqlite),
    store = new CodeAgentStore(database.sqlite),
    drafts = new GithubDraftStore(database.sqlite);
  const project = projects.createProject("Koscode workbench acceptance", "oc5").project.id;
  policy.ensureProfile(project);
  policy.updateProfile({ projectId: project, baseLevel: "A2", overrides: [], expectedVersion: 1 });
  const githubCalls: Array<{ method: string; path: string }> = [];
  const github = new GithubIntegration({
    repository: "RLM-Company/Nexus-OS",
    token: "fixture-token",
    fetchImplementation: (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      );
      const path = url.pathname.replace("/repos/RLM-Company/Nexus-OS", "");
      const method = init?.method ?? "GET";
      githubCalls.push({ method, path });
      assert.equal(url.origin, "https://api.github.com");
      let value: unknown;
      if (path.startsWith("/git/ref/heads/"))
        value = {
          ref: `refs/heads/${decodeURIComponent(path.slice(15))}`,
          object: { type: "commit", sha: baseSha }
        };
      else if (path.startsWith("/commits/"))
        value = { sha: baseSha, commit: { tree: { sha: baseTree } } };
      else if (path.startsWith("/git/trees/"))
        value = {
          sha: baseTree,
          truncated: false,
          tree: Object.entries(sources).map(([path, content], i) => ({
            path,
            type: "blob",
            mode: "100644",
            sha: String(i + 1).repeat(40),
            size: Buffer.byteLength(content)
          }))
        };
      else if (path.startsWith("/git/blobs/")) {
        const index = Number(path.slice(path.lastIndexOf("/") + 1)[0]) - 1;
        const content = Object.values(sources)[index]!;
        value = {
          sha: String(index + 1).repeat(40),
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
          size: Buffer.byteLength(content)
        };
      } else if (path === "/git/trees" && method === "POST")
        value = { sha: "c".repeat(40) };
      else if (path === "/git/commits" && method === "POST")
        value = { sha: "d".repeat(40) };
      else if (path === "/git/refs" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { ref: string };
        value = { ref: body.ref, object: { type: "commit", sha: "d".repeat(40) } };
      } else if (path === "/pulls" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { head: string; base: string };
        value = {
          html_url: "https://github.com/RLM-Company/Nexus-OS/pull/901",
          draft: true,
          head: { sha: "d".repeat(40), ref: body.head },
          base: { ref: body.base }
        };
      } else if (path.startsWith("/pulls?state=all"))
        value = [];
      else if (path === "" || path === "/")
        value = { default_branch: "main", private: true };
      else
        throw new Error(`Unexpected GitHub fixture call ${method} ${path}`);
      return Promise.resolve(
        new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
      );
    }
  });
  const service = new CodeAgentService({
    store,
    drafts,
    github,
    projects,
    policy,
    emergency,
    gateway: new ModelGateway(
      [],
      new ModelRouter(
        new ModelRegistry({
          schema_version: 1,
          registry_version: "oc5-no-model",
          generated_at: new Date().toISOString(),
          entries: []
        })
      )
    ),
    manager: new ManagerService({
      preferredProvider: "none",
      preferredModelAlias: "none",
      fallbackAllowed: false,
      maxOutputTokens: 1000,
      timeoutMs: 2000
    }),
    runner
  });
  const app = Fastify();
  registerCodeAgentRoutes(app, service, () => LOCAL_DEVELOPMENT_IDENTITY);
  const root = `/api/v1/projects/${project}/code-agent`;
  const call = async <T = ReturnType<typeof service.view>>(
    suffix: string,
    body: unknown
  ): Promise<T> => {
    const response = await app.inject({
      method: "POST",
      url: root + suffix,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body)
    });
    return response.json<T>();
  };
  const get = (id: string) => store.get(id, LOCAL_DEVELOPMENT_IDENTITY.owner_id)!;
  const view = async (id: string) =>
    (await app.inject({ url: `${root}/${id}` })).json<Record<string, unknown>>();
  const wait = async (id: string, status: string) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (get(id).status === status) {
        await service.whenIdle();
        return get(id);
      }
      if (get(id).status === "failed") throw new Error(get(id).error ?? "RUN_FAILED");
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `WAIT_TIMEOUT_${status}: status=${get(id).status} error=${get(id).error} draft=${get(id).draft?.status} log=${JSON.stringify(get(id).log.slice(-4))}`
    );
  };
  return { app, service, store, drafts, project, root, call, get, view, wait, githubCalls, database };
}

describe("OC5 Koscode workbench local acceptance", () => {
  it(
    "runs task → exact diff → failed check → fix → recheck → confirmed draft PR",
    async () => {
      const repo = await createTestRepository();
      // A deliberately wrong assertion is the small defect under repair.
      const goodTest = sources["src/add.test.mjs"]!;
      const goodAdd = sources["src/add.mjs"]!.replace("a - b", "a + b");
      // First proposal: broken function and a test that documents the bug.
      const brokenAdd = sources["src/add.mjs"]!;
      const brokenTest = goodTest.replace("baselineSum, 5", "baselineSum, 999");
      let checks = 0;
      const runner: CodeAgentWorkspaceRunner = {
        async run(input) {
          // Materialize the immutable reviewed snapshot into the isolated repo
          // and run its real Node test, as the pinned OCI executor would.
          for (const file of input.files)
            await writeFile(join(repo.directory, file.path), file.content, "utf8");
          let exitCode = 0;
          let stdout = "";
          try {
            stdout = execFileSync(process.execPath, ["--test", "src/add.test.mjs"], {
              cwd: repo.directory,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"]
            });
          } catch (error) {
            const failure = error as { status?: number; stdout?: string };
            exitCode = failure.status ?? 1;
            stdout = failure.stdout ?? "";
          }
          checks += 1;
          return {
            status: exitCode === 0 ? "passed" : "failed",
            snapshotDigest: input.expectedDigest!,
            exitCode,
            cleanupVerified: true,
            stdout: stdout.slice(0, 2000),
            stderr: "",
            truncated: false,
            journal: []
          };
        }
      };
      const f = await harness(runner);
      try {
        // Import an exact diff: fix add(), but keep a deliberately wrong assertion.
        const imported = await f.call("/import-diff", {
          task: "Fix add() and its failing test, then confirm the draft PR",
          base_branch: "main",
          base_sha: baseSha,
          diff: renderCodeAgentUnifiedDiff([
            { path: "src/add.mjs", before: brokenAdd, content: goodAdd },
            { path: "src/add.test.mjs", before: goodTest, content: brokenTest }
          ])
        });
        await f.wait(imported.id, "proposed");
        const reviewed = await f.call(`/${imported.id}/review`, {
          proposal_hash: f.get(imported.id).proposal_hash,
          expected_review_hash: null,
          files: [
            { path: "src/add.mjs", content: goodAdd },
            { path: "src/add.test.mjs", content: brokenTest }
          ]
        });
        await f.call(`/${imported.id}/check`, {
          review_hash: reviewed.draft!.plan.review_hash,
          check: "node-test",
          approve: true
        });
        const failed = await f.wait(imported.id, "checked");
        expect(failed.check?.status).toBe("failed");
        expect(failed.check?.exitCode).toBe(1);
        expect(failed.publication_token).toBeUndefined();
        // The view carries the exact diff and never leaks raw model output.
        const failedView = await f.view(imported.id);
        expect(failedView.output_checkpoint).toBeUndefined();
        expect(failedView.proposal_diff).toBeTruthy();
        // Repair the small test by restoring the correct expectation (plus a
        // verification marker so the proposal stays a real change), then
        // reapply the corrected bytes through a new review (fresh proof).
        const correctedTest = goodTest + "// проверено: сумма равна пяти\n";
        await writeFile(join(repo.directory, "src/add.test.mjs"), correctedTest, "utf8");
        const passedReview = await f.call(`/${imported.id}/review`, {
          proposal_hash: f.get(imported.id).proposal_hash,
          expected_review_hash: reviewed.draft!.plan.review_hash,
          files: [
            { path: "src/add.mjs", content: goodAdd },
            { path: "src/add.test.mjs", content: correctedTest }
          ]
        });
        await f.call(`/${imported.id}/check`, {
          review_hash: passedReview.draft!.plan.review_hash,
          check: "node-test",
          approve: true
        });
        const passed = await f.wait(imported.id, "checked");
        expect(passed.check?.status).toBe("passed");
        expect(passed.check?.exitCode).toBe(0);
        expect(passed.publication_token).toBeTruthy();
        expect(checks).toBe(2);
        // Confirmation creates one draft PR; a repeated confirmation must not
        // write to GitHub again.
        await f.call(`/${imported.id}/publish`, {
          review_hash: passedReview.draft!.plan.review_hash,
          publication_token: passed.publication_token,
          approve: true
        });
        const published = await f.wait(imported.id, "published");
        expect(published.draft_id).toBeTruthy();
        const publishedView = await f.view(imported.id);
        expect(publishedView.status).toBe("published");
        const draft = publishedView.draft as {
          status: string;
          pr_url: string;
          plan: { files: Array<{ path: string; content: string; before: string; mode: string }> };
        };
        expect(draft).toBeTruthy();
        expect(draft.status).toBe("published");
        expect(draft.pr_url).toBe("https://github.com/RLM-Company/Nexus-OS/pull/901");
        expect(draft.plan.files).toEqual([
          {
            path: "src/add.mjs",
            content: goodAdd,
            before: sources["src/add.mjs"]!,
            mode: "100644"
          },
          {
            path: "src/add.test.mjs",
            content: correctedTest,
            before: sources["src/add.test.mjs"]!,
            mode: "100644"
          }
        ]);
        const replayBefore = [...f.githubCalls];
        await f.call(`/${imported.id}/publish`, {
          review_hash: passedReview.draft!.plan.review_hash,
          publication_token: passed.publication_token,
          approve: true
        });
        expect(f.githubCalls.slice(replayBefore.length).every((c) => c.method === "GET")).toBe(true);
        expect(f.get(imported.id).status).toBe("published");
      } finally {
        await f.app.close();
        await f.service.stop();
        f.database.close();
      }
    },
    120000
  );
});
