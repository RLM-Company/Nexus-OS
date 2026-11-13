/** Opt-in synthetic live GitHub acceptance. No model adapter is configured or called. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  createCodeAgentExecutorServer,
  createCodeAgentHttpExecutor,
  createCodeAgentWorkspaceRunner,
  renderCodeAgentUnifiedDiff
} from "@cosmora/tool-runtime";
import { AccountStore } from "../src/account-settings/account-store.js";
import { SharedOwnerBudget } from "../src/account-settings/shared-owner-budget.js";
import { CodeAgentService } from "../src/code-agent/service.js";
import { CodeAgentStore } from "../src/code-agent/store.js";
import { registerCodeAgentRoutes } from "../src/code-agent/routes.js";
import { GithubDraftStore, GithubIntegration } from "../src/github-integration.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";

async function main() {
  const repository = "RLM-Company/Nexus-OS";
  const branch = "ops/coscode-live-base-2026-11-12";
  const expectedBase = "e03ba58f95189e72d8da5658808f1e845250e128";
  assert.equal(process.env.COSCODE_LIVE_GITHUB_APPROVE, `${repository}:${branch}`);
  const token = process.env.GH_TOKEN;
  const image = process.env.CODE_AGENT_TEST_IMAGE;
  assert(token && image, "AUTH_OR_PINNED_IMAGE_UNAVAILABLE");
  const out = process.env.COSCODE_LIVE_REPORT_DIR ?? "/tmp/coscode-github-live-2026-11-12";
  // Refuse replay after any prior attempt, including an uncertain GitHub response.
  await mkdir(out, { recursive: false });
  const events: Array<{ method: string; path: string }> = [];
  const realFetch: typeof fetch = (url, init) => {
    const target = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    assert.equal(target.origin, "https://api.github.com");
    assert(target.pathname.startsWith(`/repos/${repository}`));
    events.push({ method: init?.method ?? "GET", path: target.pathname });
    return fetch(url, init);
  };
  const github = new GithubIntegration({
    repository,
    ownerId: LOCAL_DEVELOPMENT_IDENTITY.owner_id,
    token,
    fetchImplementation: realFetch
  });
  const apiRead = async <T>(path: string): Promise<T> => {
    const response = await realFetch(`https://api.github.com/repos/${repository}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    assert.equal(response.status, 200, "GITHUB_READ_FAILED");
    return (await response.json()) as T;
  };
  const mainBefore = await apiRead<{ object: { sha: string } }>("/git/ref/heads/main");
  const tree = await github.tree(branch);
  assert.equal(tree.sha, expectedBase);
  assert.equal(tree.truncated, false);
  assert.deepEqual(
    tree.items
      .filter((item) => item.type === "blob")
      .map((item) => item.path)
      .sort(),
    ["README.md", "src/add.mjs", "src/add.test.mjs"]
  );
  const snapshot = await Promise.all(
    tree.items
      .filter((item) => item.type === "blob")
      .map(async (item) => ({ path: item.path, content: (await github.file(item.sha)).content }))
  );
  const original = (path: string) => snapshot.find((file) => file.path === path)!.content;
  const first = [
    {
      path: "src/add.mjs",
      before: original("src/add.mjs"),
      content: original("src/add.mjs") + "// accepted synthetic edit\n"
    },
    {
      path: "src/add.test.mjs",
      before: original("src/add.test.mjs"),
      content: original("src/add.test.mjs") + "assert.equal(add(-2, 1), -1);\n"
    }
  ];
  const database = openDatabase(join(out, "synthetic-workspace.sqlite"));
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite),
    policy = new PolicyStore(database.sqlite),
    emergency = new EmergencyStopStore(database.sqlite);
  const store = new CodeAgentStore(database.sqlite),
    drafts = new GithubDraftStore(database.sqlite);
  const project = projects.createProject("Synthetic live GitHub acceptance", "coscode-live").project
    .id;
  policy.ensureProfile(project);
  policy.updateProfile({ projectId: project, baseLevel: "A2", overrides: [], expectedVersion: 1 });
  const localToken = randomUUID() + randomUUID();
  const sidecar = createCodeAgentExecutorServer({
    token: localToken,
    runner: createCodeAgentWorkspaceRunner({
      runtime: "docker",
      executable: process.env.CODE_AGENT_TEST_EXECUTABLE ?? "/usr/local/bin/docker",
      image,
      limits: { timeoutMs: 30000 }
    })
  });
  await new Promise<void>((resolve) => sidecar.server.listen(0, "127.0.0.1", resolve));
  const address = sidecar.server.address();
  assert(address && typeof address !== "string");
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
          registry_version: "no-model-live-github",
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
    runner: createCodeAgentHttpExecutor({
      url: `http://127.0.0.1:${address.port}`,
      token: localToken,
      pollMs: 100
    }),
    ownerBudget: new SharedOwnerBudget(new AccountStore(database.sqlite), projects)
  });
  const app = Fastify();
  registerCodeAgentRoutes(app, service, () => LOCAL_DEVELOPMENT_IDENTITY);
  const root = `/api/v1/projects/${project}/code-agent`;
  const call = async (suffix: string, body: unknown) => {
    const response = await app.inject({
      method: "POST",
      url: root + suffix,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body)
    });
    assert.equal(response.statusCode, 200, `HTTP_${response.statusCode}:${response.body}`);
    return response.json<ReturnType<typeof service.view>>();
  };
  const read = (id: string) => store.get(id, LOCAL_DEVELOPMENT_IDENTITY.owner_id)!;
  const wait = async (id: string, status: string) => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const value = read(id);
      if (value.status === status) {
        await service.whenIdle();
        return read(id);
      }
      if (value.status === "failed") throw new Error(value.error ?? "RUN_FAILED");
      await delay(100);
    }
    throw new Error("ACCEPTANCE_WAIT_TIMEOUT");
  };
  let id: string | undefined;
  try {
    const imported = await call("/import-diff", {
      task: "Synthetic acceptance: manual diff; no model invocation",
      base_branch: branch,
      base_sha: expectedBase,
      diff: renderCodeAgentUnifiedDiff(first)
    });
    id = imported.id;
    await wait(id, "proposed");
    const review = await call(`/${id}/review`, {
      proposal_hash: read(id).proposal_hash,
      expected_review_hash: null,
      files: first.map(({ path, content }) => ({ path, content }))
    });
    const check = async (hash: string) => {
      await call(`/${id}/check`, { review_hash: hash, check: "node-test", approve: true });
      return wait(id!, "checked");
    };
    const failed = await check(review.draft!.plan.review_hash);
    assert.equal(failed.check?.status, "failed");
    assert.equal(failed.check.exitCode, 1);
    assert.equal(failed.check.cleanupVerified, true);
    assert.equal(failed.publication_token, undefined);
    const repeated = await check(review.draft!.plan.review_hash);
    const conflict = await app.inject({
      method: "POST",
      url: `${root}/${id}/repair-v2`,
      payload: {
        review_hash: review.draft!.plan.review_hash,
        expected_run_version: failed.version,
        client_request_id: randomUUID(),
        approve: true
      }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json<{ error: { code: string } }>().error.code, "STALE_CHECK");
    assert.deepEqual(read(id), repeated);
    const corrected = first.map((file) => ({
      path: file.path,
      content: file.path.endsWith("/add.mjs")
        ? file.content.replace("a - b", "a + b")
        : file.content
    }));
    const fresh = await call(`/${id}/review`, {
      proposal_hash: read(id).proposal_hash,
      expected_review_hash: review.draft!.plan.review_hash,
      files: corrected
    });
    const passed = await check(fresh.draft!.plan.review_hash);
    assert.equal(passed.check?.status, "passed");
    assert.equal(passed.check.exitCode, 0);
    assert.equal(passed.check.cleanupVerified, true);
    assert(passed.publication_token);
    assert.equal((passed.model_run_ids ?? []).length, 0);
    assert.equal(fresh.draft!.plan.base_branch, branch);
    // This is the only publication invocation. Never retry it after uncertain I/O.
    const published = await call(`/${id}/publish`, {
      review_hash: fresh.draft!.plan.review_hash,
      publication_token: passed.publication_token,
      approve: true
    });
    assert.equal(published.status, "published");
    const number = Number(published.draft!.pr_url!.split("/").at(-1));
    const pr = await apiRead<{
      number: number;
      draft: boolean;
      state: string;
      html_url: string;
      head: { sha: string; ref: string };
      base: { ref: string };
    }>(`/pulls/${number}`);
    assert.equal(pr.draft, true);
    assert.equal(pr.state, "open");
    assert.equal(pr.base.ref, branch);
    assert.equal(pr.head.ref, fresh.draft!.plan.branch);
    const outputTree = await github.tree(pr.head.ref);
    for (const file of corrected) {
      const entry = outputTree.items.find((item) => item.path === file.path)!;
      assert.equal((await github.file(entry.sha)).content, file.content);
    }
    assert.equal(
      outputTree.items.find((item) => item.path === "README.md")?.sha,
      tree.items.find((item) => item.path === "README.md")?.sha
    );
    assert.equal((await github.tree(branch)).sha, expectedBase);
    const writes = events.filter((event) => event.method === "POST").length;
    const replay = await app.inject({
      method: "POST",
      url: `${root}/${id}/publish`,
      payload: {
        review_hash: fresh.draft!.plan.review_hash,
        publication_token: passed.publication_token,
        approve: true
      }
    });
    assert.equal(replay.statusCode, 409);
    assert.equal(events.filter((event) => event.method === "POST").length, writes);
    const mainAfter = await apiRead<{ object: { sha: string } }>("/git/ref/heads/main");
    const receipt = {
      source_main: "ea2f4aafe8e9609b678f8743a08c43d43f911f9f",
      repository,
      base_branch: branch,
      base_sha: expectedBase,
      data: "synthetic only",
      real_github: true,
      real_http_executor: true,
      real_oci: true,
      real_model_called: false,
      model_adapter_count: 0,
      failed_check: failed.check,
      repeated_check: repeated.check,
      stale_conflict: "STALE_CHECK",
      passed_check: passed.check,
      output_sha: pr.head.sha,
      pr,
      publication_invocations: 1,
      github_post_count: writes,
      duplicate_publish_rejected: true,
      readme_preserved: true,
      main_before: mainBefore.object.sha,
      main_after: mainAfter.object.sha,
      main_same: mainBefore.object.sha === mainAfter.object.sha,
      release_accepted: false,
      limitations: [
        "Model provider is not connected; edits are manually supplied synthetic input.",
        "Isolated branch workspace in existing repository; separate repository creation denied."
      ]
    };
    for (const [name, value] of Object.entries({
      "receipt.json": receipt,
      "input.json": snapshot,
      "output.json": corrected,
      "github-requests.json": events
    }))
      await writeFile(join(out, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    await writeFile(
      join(out, "changes.patch"),
      renderCodeAgentUnifiedDiff(fresh.draft!.plan.files),
      { flag: "wx" }
    );
    console.log(
      JSON.stringify({
        status: "github_and_oci_passed_model_pending",
        pr: pr.html_url,
        base: branch,
        output_sha: pr.head.sha,
        real_model_called: false
      })
    );
  } catch (error) {
    await writeFile(
      join(out, "interrupted.json"),
      JSON.stringify(
        {
          id,
          run: id ? service.view(read(id)) : null,
          events,
          real_model_called: false,
          automatic_retry: false
        },
        null,
        2
      ) + "\n"
    );
    throw error;
  } finally {
    await app.close();
    await sidecar.stop();
    database.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "ACCEPTANCE_FAILED");
  process.exitCode = 1;
});
