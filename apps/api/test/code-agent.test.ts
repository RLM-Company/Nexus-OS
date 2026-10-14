import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { loadServerConfig } from "@cosmora/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutonomyLevel, ModelRegistryDocument, ModelRegistryEntry } from "@cosmora/contracts";
import { ManagerService } from "@cosmora/core";
import {
  EmergencyStopStore,
  PolicyStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  OpenAICompatibleAdapter
} from "@cosmora/model-gateway";
import {
  createCodeAgentExecutorServer,
  createCodeAgentHttpExecutor,
  computeCodeAgentSnapshotDigest,
  type CodeAgentWorkspaceRunner,
  type CodeAgentWorkspaceRunInput
} from "@cosmora/tool-runtime";
import type { CodeOwnerBudget } from "../src/code-agent/owner-budget.js";
import { CodeAgentService } from "../src/code-agent/service.js";
import { CodeAgentStore } from "../src/code-agent/store.js";
import { registerCodeAgentRoutes } from "../src/code-agent/routes.js";
import { GithubDraftStore, GithubIntegration } from "../src/github-integration.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import { buildApp } from "../src/app.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { SharedOwnerBudget } from "../src/account-settings/shared-owner-budget.js";

const owner = "local-owner",
  head = "a".repeat(40),
  tree = "b".repeat(40),
  commit = "d".repeat(40);
const originals: Record<string, string> = {
  "src/add.js": "export const add = (a,b) => a-b;\n",
  "src/add.test.js": "import {add} from './add.js';\n"
};
const changes = [
  { path: "src/add.js", content: "export const add = (a,b) => a+b;\n" },
  {
    path: "src/add.test.js",
    content:
      "import {add} from './add.js';\nimport assert from 'node:assert/strict';\nassert.equal(add(2,3),5);\n"
  }
];
const resources: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of resources.splice(0)) await close();
});
const sse = (...events: unknown[]) =>
  events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
const toolResponse = (name: string, args: unknown, id: string) =>
  sse(
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          }
        }
      ]
    },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 40 } },
    "[DONE]"
  );
const proposalResponse = () =>
  toolResponse(
    "propose_patch",
    { summary: "Исправлено сложение и добавлена проверка", files: changes },
    "patch"
  );
const entry = (toolCalling: boolean): ModelRegistryEntry => ({
  provider_id: "fixture",
  model_id: "fixture-code",
  aliases: [],
  protocol: "openai-compatible",
  status: "active",
  roles: ["analyst"],
  task_types: ["manager_work_draft"],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: toolCalling,
    vision: false
  },
  context_window_tokens: 64000,
  max_output_tokens: 2000,
  quality_tier: 1,
  latency_tier: 1,
  pricing: null,
  privacy: { confidential_compatible: false, training_usage: "unknown", retention: "unknown" },
  source: {
    kind: "authorized_discovery",
    verified_at: "2026-10-08T00:00:00.000Z",
    valid_until: "2099-10-08T00:00:00.000Z",
    reference: "deterministic transport fixture"
  }
});

async function fixture(
  options: {
    ownerBudget?: CodeOwnerBudget;
    level?: AutonomyLevel;
    toolCalling?: boolean;
    responses?: string[];
    runner?: CodeAgentWorkspaceRunner;
    onGithub?: (path: string, method: string) => void;
    registry?: ModelRegistryDocument;
  } = {}
) {
  const database = openDatabase(":memory:");
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite),
    policy = new PolicyStore(database.sqlite),
    emergency = new EmergencyStopStore(database.sqlite),
    store = new CodeAgentStore(database.sqlite),
    drafts = new GithubDraftStore(database.sqlite);
  const project = projects.createProject("Code agent integration", "code-agent-test").project.id;
  policy.ensureProfile(project);
  policy.updateProfile({
    projectId: project,
    baseLevel: options.level ?? "A2",
    overrides: [],
    expectedVersion: 1
  });
  const githubCalls: Array<{ path: string; method: string; body: Record<string, unknown> | null }> =
    [];
  let loseResponse = false,
    prExists = false;
  const github = new GithubIntegration({
    token: "fixture-token",
    fetchImplementation: (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      );
      expect(url.origin).toBe("https://api.github.com");
      expect(url.pathname.startsWith("/repos/RLM-Company/Nexus-OS")).toBe(true);
      const path = url.pathname.replace("/repos/RLM-Company/Nexus-OS", ""),
        method = init?.method ?? "GET",
        body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
      githubCalls.push({ path, method, body });
      options.onGithub?.(path, method);
      let value: unknown;
      if (path.startsWith("/git/ref/heads/"))
        value = {
          ref: `refs/heads/${decodeURIComponent(path.slice(15))}`,
          object: { type: "commit", sha: head }
        };
      else if (path.startsWith("/commits/")) value = { sha: head, commit: { tree: { sha: tree } } };
      else if (path.startsWith("/git/trees/"))
        value = {
          truncated: false,
          tree: Object.keys(originals).map((path, i) => ({
            path,
            type: "blob",
            mode: "100644",
            sha: String(i + 1).repeat(40)
          }))
        };
      else if (path.startsWith("/git/blobs/")) {
        const content = Object.values(originals)[Number(path.at(-1)) - 1]!;
        value = {
          encoding: "base64",
          content: Buffer.from(content).toString("base64"),
          size: Buffer.byteLength(content)
        };
      } else if (path === "/git/trees") value = { sha: tree };
      else if (path === "/git/commits") value = { sha: commit };
      else if (path === "/git/refs")
        value = { ref: body!.ref, object: { type: "commit", sha: commit } };
      else if (path === "/pulls" && method === "POST") {
        prExists = true;
        if (loseResponse) throw new Error("Accepted PR but transport response lost");
        value = {
          html_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000",
          draft: true,
          head: { sha: commit, ref: body!.head },
          base: { ref: body!.base }
        };
      } else if (path === "/pulls")
        value = prExists
          ? [
              {
                html_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000",
                head: { sha: commit },
                base: { ref: "main" }
              }
            ]
          : [];
      else value = { default_branch: "main", private: true };
      return Promise.resolve(
        new Response(JSON.stringify(value), {
          headers: { "content-type": "application/json" }
        })
      );
    }
  });
  const providerCalls: Array<Record<string, unknown>> = [];
  const responses = options.responses ?? [
    toolResponse("list_files", {}, "list"),
    toolResponse("read_file", { path: "src/add.test.js" }, "read"),
    proposalResponse()
  ];
  const modelEntry =
    options.registry?.entries.find((e) => e.provider_id === "cheapvibecode") ??
    entry(options.toolCalling ?? true);
  const adapter = new OpenAICompatibleAdapter({
    id: modelEntry.provider_id,
    model: modelEntry.model_id,
    apiKey: "deterministic-fixture",
    baseUrl: "https://unused.invalid",
    fetchImplementation: (_input, init) => {
      if (typeof init?.body !== "string") throw new Error("Missing JSON request");
      providerCalls.push(JSON.parse(init.body) as Record<string, unknown>);
      const response = responses[providerCalls.length - 1];
      if (!response) throw new Error("Unexpected provider turn");
      return Promise.resolve(
        new Response(response, { headers: { "content-type": "text/event-stream" } })
      );
    }
  });
  const gateway = new ModelGateway(
    [adapter],
    new ModelRouter(
      new ModelRegistry(
        options.registry ?? {
          schema_version: 1,
          registry_version: "code-fixture",
          generated_at: "2026-10-08T00:00:00.000Z",
          entries: [modelEntry]
        }
      )
    ),
    [],
    { maxAttemptsPerRoute: 1 }
  );
  const manager = new ManagerService({
    preferredProvider: modelEntry.provider_id,
    preferredModelAlias: modelEntry.model_id,
    fallbackAllowed: false,
    maxOutputTokens: 1000,
    timeoutMs: 2000
  });
  const checked: CodeAgentWorkspaceRunInput[] = [];
  // Intentionally synthetic runner result: these tests exercise API orchestration; the isolated
  // OCI executor has its own tests and no host-shell execution happens in this fixture.
  const runner: CodeAgentWorkspaceRunner = options.runner ?? {
    run(input) {
      checked.push(input);
      expect(input.expectedDigest).toBe(computeCodeAgentSnapshotDigest(input.files));
      return Promise.resolve({
        status: "passed",
        cleanupVerified: true,
        snapshotDigest: input.expectedDigest!,
        exitCode: 0,
        stdout: "synthetic API fixture",
        stderr: "",
        truncated: false,
        journal: [
          { at: new Date().toISOString(), event: "finished", detail: "synthetic API fixture" }
        ]
      });
    }
  };
  const service = new CodeAgentService({
    store,
    github,
    drafts,
    projects,
    policy,
    emergency,
    gateway,
    manager,
    runner,
    ownerBudget:
      options.ownerBudget ?? new SharedOwnerBudget(new AccountStore(database.sqlite), projects)
  });
  let requestOwner = owner;
  const app = Fastify();
  registerCodeAgentRoutes(app, service, () => ({
    ...LOCAL_DEVELOPMENT_IDENTITY,
    owner_id: requestOwner,
    actor_id: requestOwner
  }));
  resources.push(async () => {
    await app.close();
    database.close();
  });
  const get = (id: string) => store.get(id, owner)!;
  const wait = async (id: string, status: string) => {
    await expect.poll(() => get(id).status, { timeout: 3000 }).toBe(status);
    return get(id);
  };
  const start = () => {
    const run = service.create(project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Исправь баг в src/add.js",
      base_branch: "main",
      files: ["src/add.js"]
    });
    return Promise.resolve(run.id);
  };
  const review = async (id: string, files = changes) => {
    const run = get(id).status === "running" ? await wait(id, "proposed") : get(id);
    return service.review(id, owner, { proposal_hash: run.proposal_hash!, files });
  };
  const check = async (id: string, reviewHash: string) => {
    service.check(id, owner, { review_hash: reviewHash, check: "node-test", approve: true });
    return wait(id, "checked");
  };
  return {
    database,
    app,
    service,
    store,
    drafts,
    project,
    projects,
    policy,
    emergency,
    githubCalls,
    providerCalls,
    checked,
    get,
    wait,
    start,
    review,
    check,
    base: `/api/v1/projects/${project}/code-agent`,
    losePrResponse: () => {
      loseResponse = true;
    },
    requestOwner: (value: string) => {
      requestOwner = value;
    }
  };
}

describe("Code agent real gateway/GitHub/policy vertical", () => {
  it("creates an active isolated Code project with explicit A2 approval, no initial model run, and idempotent replay", async () => {
    const f = await fixture(),
      id = randomUUID(),
      payload = { client_project_id: id, title: "My Code project", approve_local_execution: true };
    const first = await f.app.inject({ method: "POST", url: "/api/v1/code-projects", payload });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ project: { id: string; status: string } }>().project).toMatchObject({
      id,
      status: "ACTIVE"
    });
    expect(f.service.deps.policy.getProfile(id)?.base_level).toBe("A2");
    expect(f.service.deps.projects.listMessages(id, owner)).toEqual([]);
    expect(f.providerCalls).toHaveLength(0);
    expect(f.githubCalls).toHaveLength(0);
    expect(
      (await f.app.inject({ method: "POST", url: "/api/v1/code-projects", payload })).statusCode
    ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/code-projects",
          payload: { ...payload, approve_local_execution: false }
        })
      ).statusCode
    ).toBe(400);
    f.requestOwner("foreign");
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/code-projects",
          payload: { ...payload, client_project_id: randomUUID() }
        })
      ).statusCode
    ).toBe(404);
  });
  it("replays a durable creation request once, rejects changed retries and recovers by owner-scoped request ID", async () => {
    const f = await fixture({
      toolCalling: false,
      responses: [
        sse(
          {
            choices: [
              {
                delta: { content: JSON.stringify({ summary: "Fix", files: [changes[0]] }) },
                finish_reason: null
              }
            ]
          },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 20, completion_tokens: 20 } },
          "[DONE]"
        )
      ]
    });
    const key = randomUUID(),
      payload = { client_request_id: key, task: "Fix sum", base_branch: "main" };
    const first = await f.app.inject({ method: "POST", url: f.base, payload });
    expect(first.statusCode).toBe(200);
    const id = first.json<{ id: string }>().id;
    const again = await f.app.inject({ method: "POST", url: f.base, payload });
    expect(again.json<{ id: string }>().id).toBe(id);
    await f.wait(id, "proposed");
    const calls = f.providerCalls.length;
    expect(
      (await f.app.inject({ method: "POST", url: f.base, payload })).json<{ id: string }>().id
    ).toBe(id);
    expect(f.providerCalls).toHaveLength(calls);
    expect(
      (await f.app.inject({ method: "GET", url: f.base + "/by-request/" + key })).json<{
        id: string;
      }>().id
    ).toBe(id);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: f.base,
          payload: { ...payload, task: "Different" }
        })
      ).statusCode
    ).toBe(409);
    f.requestOwner("foreign-owner");
    expect(
      (await f.app.inject({ method: "GET", url: f.base + "/by-request/" + key })).statusCode
    ).toBe(404);
  });
  it("reads immutable source, carries authoritative tools through gateway, edits selection, checks exact snapshot and creates confirmed draft PR", async () => {
    const f = await fixture(),
      id = await f.start(),
      proposal = await f.wait(id, "proposed");
    expect(proposal.base_sha).toBe(head);
    expect(proposal.proposal).toHaveLength(2);
    expect(f.githubCalls.some((c) => c.method !== "GET")).toBe(false);
    const last = f.providerCalls.at(-1)!,
      messages = last.messages as Array<Record<string, unknown>>;
    expect(messages.filter((m) => m.role === "tool")).toEqual([
      {
        role: "tool",
        tool_call_id: "list",
        content: JSON.stringify({ files: Object.keys(originals) })
      },
      {
        role: "tool",
        tool_call_id: "read",
        content: JSON.stringify({ path: "src/add.test.js", content: originals["src/add.test.js"] })
      }
    ]);
    expect(messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);
    const selected = [{ path: "src/add.js", content: "export const add = (a,b) => a + b;\n" }];
    const review = await f.review(id, selected),
      reviewHash = review.draft!.plan.review_hash;
    expect(review.draft!.plan.files.map((file) => file.path)).toEqual(["src/add.js"]);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
    await expect(
      f.service.publish(id, owner, {
        review_hash: reviewHash,
        publication_token: f.get(id).publication_token ?? randomUUID(),
        approve: true
      })
    ).rejects.toThrow("CHECK_REQUIRED");
    await f.check(id, reviewHash);
    expect(f.checked).toHaveLength(1);
    expect(f.checked[0]!.files.find((file) => file.path === "src/add.js")!.content).toBe(
      selected[0]!.content
    );
    const response = await f.app.inject({
      method: "POST",
      url: `${f.base}/${id}/publish`,
      payload: {
        review_hash: reviewHash,
        publication_token: f.get(id).publication_token ?? randomUUID(),
        approve: true
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "published",
      draft: { status: "published", pr_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000" }
    });
    expect(f.githubCalls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/git/trees",
      "/git/commits",
      "/git/refs",
      "/pulls"
    ]);
    expect(
      f.githubCalls.find((c) => c.path === "/pulls" && c.method === "POST")!.body
    ).toMatchObject({ draft: true, base: "main" });
    expect(f.githubCalls.find((c) => c.path === "/git/refs")!.body!.ref).toMatch(
      /^refs\/heads\/kosmora\/change-/
    );
  });

  it("reconciles a lost publication response by reading GitHub without repeating writes", async () => {
    const f = await fixture(),
      id = await f.start(),
      review = await f.review(id),
      hash = review.draft!.plan.review_hash;
    await f.check(id, hash);
    f.losePrResponse();
    expect(
      (
        await f.service.publish(id, owner, {
          review_hash: hash,
          publication_token: f.get(id).publication_token ?? randomUUID(),
          approve: true
        })
      ).status
    ).toBe("uncertain");
    const writes = f.githubCalls.filter((c) => c.method === "POST").length;
    await expect(
      f.service.publish(id, owner, {
        review_hash: hash,
        publication_token: f.get(id).publication_token ?? randomUUID(),
        approve: true
      })
    ).rejects.toThrow("STALE_REVIEW");
    expect((await f.service.reconcile(id, owner)).status).toBe("published");
    expect(f.githubCalls.filter((c) => c.method === "POST")).toHaveLength(writes);
    expect(f.githubCalls.at(-1)).toMatchObject({ path: "/pulls", method: "GET" });
  });

  it("uses strict text JSON fallback through actual gateway when registry forbids tool calling", async () => {
    const response = sse(
      {
        choices: [
          {
            delta: { content: JSON.stringify({ summary: "Fix", files: [changes[0]] }) },
            finish_reason: null
          }
        ]
      },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      "[DONE]"
    );
    const f = await fixture({ toolCalling: false, responses: [response] }),
      id = await f.start();
    await f.wait(id, "proposed");
    expect(f.providerCalls).toHaveLength(1);
    expect(f.providerCalls[0]!.tools).toBeUndefined();
  });

  it("A0 denies reads and A1 permits proposal but denies workspace writes", async () => {
    const a0 = await fixture({ level: "A0" }),
      a0id = await a0.start();
    expect((await a0.wait(a0id, "failed")).error).toBe("POLICY_DENIED");
    expect(a0.githubCalls).toHaveLength(0);
    const a1 = await fixture({ level: "A1" }),
      a1id = await a1.start(),
      proposal = await a1.wait(a1id, "proposed");
    await expect(
      a1.service.review(a1id, owner, { proposal_hash: proposal.proposal_hash!, files: changes })
    ).rejects.toThrow("POLICY_DENIED");
    expect(a1.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });

  it("rejects traversal and secret paths before GitHub access and does not accept arbitrary command strings", async () => {
    const f = await fixture();
    for (const path of [
      "../outside.js",
      "/etc/passwd",
      "src\\bad.js",
      ".env",
      ".github/workflows/pwn.yml",
      "credentials.json"
    ])
      expect(() =>
        f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
          task: "Fix",
          base_branch: "main",
          files: [path]
        })
      ).toThrow("INVALID_INPUT");
    expect(f.githubCalls).toHaveLength(0);
    const id = await f.start(),
      review = await f.review(id),
      hash = review.draft!.plan.review_hash;
    for (const payload of [
      { review_hash: hash, check: "sh -c curl attacker", approve: true },
      { review_hash: hash, check: "syntax", approve: false }
    ])
      expect(
        (await f.app.inject({ method: "POST", url: `${f.base}/${id}/check`, payload })).statusCode
      ).toBe(400);
    expect(f.checked).toHaveLength(0);
  });

  it("requires current proposal/review hash and invalidates successful checks after edited review", async () => {
    const f = await fixture(),
      id = await f.start(),
      proposal = await f.wait(id, "proposed");
    await expect(
      f.service.review(id, owner, { proposal_hash: "0".repeat(64), files: changes })
    ).rejects.toThrow("STALE_REVIEW");
    await expect(
      f.service.review(id, owner, {
        proposal_hash: proposal.proposal_hash!,
        files: [{ path: "other.js", content: "x" }]
      })
    ).rejects.toThrow("STALE_REVIEW");
    const first = await f.review(id),
      hash = first.draft!.plan.review_hash;
    await f.check(id, hash);
    const second = await f.review(id, [
      { path: "src/add.js", content: "export const add=(a,b)=>Number(a)+Number(b);\n" }
    ]);
    expect(second.check).toBeUndefined();
    expect(second.draft!.plan.review_hash).not.toBe(hash);
    await expect(
      f.service.publish(id, owner, {
        review_hash: hash,
        publication_token: f.get(id).publication_token ?? randomUUID(),
        approve: true
      })
    ).rejects.toThrow("STALE_REVIEW");
    await expect(
      f.service.publish(id, owner, {
        review_hash: second.draft!.plan.review_hash,
        publication_token: f.get(id).publication_token ?? randomUUID(),
        approve: true
      })
    ).rejects.toThrow("CHECK_REQUIRED");
  });

  it("route publication requires explicit confirmation and exact hash", async () => {
    const f = await fixture(),
      id = await f.start(),
      review = await f.review(id),
      hash = review.draft!.plan.review_hash;
    await f.check(id, hash);
    for (const payload of [{ review_hash: hash }, { review_hash: hash, approve: false }])
      expect(
        (await f.app.inject({ method: "POST", url: `${f.base}/${id}/publish`, payload })).statusCode
      ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.base}/${id}/publish`,
          payload: {
            review_hash: "0".repeat(64),
            publication_token: f.get(id).publication_token ?? randomUUID(),
            approve: true
          }
        })
      ).statusCode
    ).toBe(409);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });

  it("binds routes to project and owner and omits immutable file contents from views", async () => {
    const f = await fixture(),
      id = await f.start();
    await f.wait(id, "proposed");
    const view = (await f.app.inject({ url: `${f.base}/${id}` })).json<Record<string, unknown>>();
    expect(view.snapshot).toBeUndefined();
    expect(view.workspace_scope).toBeUndefined();
    expect(view.owner_id).toBeUndefined();
    const other = f.projects.createProject("Other", randomUUID()).project.id;
    expect(
      (await f.app.inject({ url: `/api/v1/projects/${other}/code-agent/${id}` })).statusCode
    ).toBe(404);
    f.requestOwner("someone-else");
    expect((await f.app.inject({ url: `${f.base}/${id}` })).statusCode).toBe(404);
    expect(f.store.get(id, "someone-else")).toBeNull();
  });

  it("cancels an in-flight approved check without a late-result overwrite or GitHub write", async () => {
    let entered = false,
      aborted = false;
    const runner: CodeAgentWorkspaceRunner = {
      async run(input) {
        entered = true;
        await new Promise<void>((resolve) => {
          input.signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          );
        });
        return {
          status: "cancelled",
          snapshotDigest: input.expectedDigest!,
          exitCode: null,
          stdout: "",
          stderr: "",
          truncated: false,
          journal: []
        };
      }
    };
    const f = await fixture({ runner }),
      id = await f.start(),
      review = await f.review(id);
    f.service.check(id, owner, {
      review_hash: review.draft!.plan.review_hash,
      check: "node-test",
      approve: true
    });
    await expect.poll(() => entered).toBe(true);
    f.service.cancel(id, owner);
    await f.service.stop();
    expect(aborted).toBe(true);
    expect(f.get(id).status).toBe("checked");
    expect(f.get(id).check?.status).toBe("cancelled");
    expect(f.get(id).publication_token).toBeUndefined();
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });

  it("rejects model attempts to use an unregistered tool and modifications of unread existing files", async () => {
    const badTool = await fixture({
        responses: [toolResponse("root_shell", { command: "rm -rf /" }, "illegal")]
      }),
      badId = await badTool.start();
    expect(["PROVIDER_ERROR", "RECONCILIATION_REQUIRED"]).toContain(
      (await badTool.wait(badId, "failed")).error
    );
    expect(badTool.githubCalls.every((call) => call.method === "GET")).toBe(true);
    const unread = await fixture({ responses: [proposalResponse()] }),
      id = await unread.start();
    expect((await unread.wait(id, "failed")).error).toBe("FILE_NOT_READ");
    expect(unread.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });

  it("revokes policy during a GitHub write and stops before branch or PR publication", async () => {
    let revoke = () => {};
    const f = await fixture({
        onGithub: (path, method) => {
          if (path === "/git/trees" && method === "POST") revoke();
        }
      }),
      id = await f.start(),
      review = await f.review(id),
      hash = review.draft!.plan.review_hash;
    await f.check(id, hash);
    revoke = () => {
      f.policy.updateProfile({
        projectId: f.project,
        baseLevel: "A0",
        overrides: [],
        expectedVersion: f.policy.getProfile(f.project)!.version
      });
    };
    expect(
      (
        await f.service.publish(id, owner, {
          review_hash: hash,
          publication_token: f.get(id).publication_token!,
          approve: true
        })
      ).status
    ).toBe("uncertain");
    expect(f.githubCalls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/git/trees"
    ]);
  });

  it("invalidates delayed publication approval during reconciliation and accepts a fresh confirmation", async () => {
    const f = await fixture(),
      id = await f.start(),
      review = await f.review(id),
      hash = review.draft!.plan.review_hash;
    const checked = await f.check(id, hash),
      oldToken = checked.publication_token!;
    const reconciled = await f.service.reconcile(id, owner);
    expect(reconciled.status).toBe("checked");
    expect(reconciled.publication_token).not.toBe(oldToken);
    await expect(
      f.service.publish(id, owner, {
        review_hash: hash,
        publication_token: oldToken,
        approve: true
      })
    ).rejects.toThrow("CHECK_REQUIRED");
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
    const published = await f.service.publish(id, owner, {
      review_hash: hash,
      publication_token: reconciled.publication_token!,
      approve: true
    });
    expect(published.status).toBe("published");
    const count = f.githubCalls.length;
    expect((await f.service.reconcile(id, owner)).status).toBe("published");
    expect(f.githubCalls).toHaveLength(count);
  });

  it("does not accept a passed check whose container cleanup or snapshot identity was not verified", async () => {
    for (const mismatch of [false, true]) {
      const runner: CodeAgentWorkspaceRunner = {
        run: (input) =>
          Promise.resolve({
            status: "passed",
            snapshotDigest: mismatch ? "0".repeat(64) : input.expectedDigest!,
            cleanupVerified: mismatch,
            exitCode: 0,
            stdout: "fixture",
            stderr: "",
            truncated: false,
            journal: []
          })
      };
      const f = await fixture({ runner }),
        id = await f.start(),
        review = await f.review(id),
        hash = review.draft!.plan.review_hash;
      f.service.check(id, owner, { review_hash: hash, check: "syntax", approve: true });
      expect((await f.wait(id, "failed")).error).toBe("CHECK_SNAPSHOT_MISMATCH");
      await expect(
        f.service.publish(id, owner, {
          review_hash: hash,
          publication_token: randomUUID(),
          approve: true
        })
      ).rejects.toThrow("CHECK_REQUIRED");
      expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
    }
  });

  it("registers the feature in the actual API application with its existing dependencies", async () => {
    const f = await fixture();
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: f.database,
      projectStore: f.projects,
      policyStore: f.policy,
      emergencyStopStore: f.emergency,
      modelGateway: f.service.deps.gateway,
      manager: f.service.deps.manager,
      githubIntegration: f.service.deps.github,
      githubDraftStore: f.drafts,
      codeAgentRunner: f.service.deps.runner,
      ownerBudget: f.service.deps.ownerBudget!
    });
    try {
      expect((await app.inject({ url: f.base })).statusCode).toBe(200);
      const response = await app.inject({
        method: "POST",
        url: f.base,
        payload: { task: "Fix src/add.js", base_branch: "main", files: ["src/add.js"] }
      });
      expect(response.statusCode).toBe(200);
      const id = response.json<{ id: string }>().id;
      await f.wait(id, "proposed");
    } finally {
      await app.close();
    }
  });

  it("runs the same approved check again after unavailable executor provisioning instead of replaying its old result", async () => {
    let provisioned = false,
      calls = 0;
    const runner: CodeAgentWorkspaceRunner = {
      run(input) {
        calls++;
        return Promise.resolve({
          status: provisioned ? "passed" : "unavailable",
          snapshotDigest: input.expectedDigest!,
          cleanupVerified: provisioned,
          exitCode: provisioned ? 0 : null,
          stdout: "fixture",
          stderr: "",
          truncated: false,
          journal: []
        });
      }
    };
    const f = await fixture({ runner }),
      id = await f.start(),
      review = await f.review(id),
      hash = review.draft!.plan.review_hash;
    const first = await f.check(id, hash);
    expect(first.check!.status).toBe("unavailable");
    await expect(
      f.service.publish(id, owner, {
        review_hash: hash,
        publication_token: first.publication_token!,
        approve: true
      })
    ).rejects.toThrow("CHECK_REQUIRED");
    provisioned = true;
    const second = await f.check(id, hash);
    expect(calls).toBe(2);
    expect(second.check!.status).toBe("passed");
    expect(second.publication_token).not.toBe(first.publication_token);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });

  it("routes the real funded registry through permitted analyst drafting and strict JSON fallback without network access", async () => {
    const registry = JSON.parse(
      readFileSync(
        new URL(
          "../../../config/model-registry.cheapvibecode.manager-work-preview.v1.json",
          import.meta.url
        ),
        "utf8"
      )
    ) as ModelRegistryDocument;
    const response = sse(
      {
        choices: [
          {
            index: 0,
            delta: { content: JSON.stringify({ summary: "Fix", files: [changes[0]] }) },
            finish_reason: null
          }
        ]
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]"
    );
    const f = await fixture({ registry, responses: [response] }),
      assertRoute = vi.spyOn(f.service.deps.gateway, "assertRoute"),
      id = await f.start();
    const run = await f.wait(id, "proposed");
    expect(assertRoute.mock.calls[0]![0]).toMatchObject({
      role: "analyst",
      task_type: "manager_work_draft",
      agent_id: "kosmora-code-agent",
      routing: {
        preferred_provider: "cheapvibecode",
        preferred_model_alias: "gpt-5.5",
        fallback_allowed: false
      }
    });
    expect(assertRoute.mock.results[0]!.type).toBe("throw");
    expect(assertRoute.mock.results[1]!.type).toBe("return");
    expect(assertRoute.mock.calls[0]![0].tools).toBeDefined();
    expect(assertRoute.mock.calls[1]![0].tools).toBeUndefined();
    expect(f.providerCalls).toHaveLength(1);
    expect(f.providerCalls[0]!.model).toBe("gpt-5.5");
    expect(f.providerCalls[0]!.tools).toBeUndefined();
    expect(run.proposal?.map((file) => file.path)).toEqual(["src/add.js"]);
    expect(f.githubCalls.every((call) => call.method === "GET")).toBe(true);
  });

  it("selects a bounded immutable context locally before the sole text-only generation", async () => {
    const jsonResponse = (value: unknown) =>
      sse(
        { choices: [{ index: 0, delta: { content: JSON.stringify(value) }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        "[DONE]"
      );
    const readTurns: number[] = [];
    let providerCalls: Array<Record<string, unknown>> = [];
    const f = await fixture({
      toolCalling: false,
      responses: [jsonResponse({ summary: "Fix addition", files: [changes[0]] })],
      onGithub: (path) => {
        if (path.startsWith("/git/blobs/")) readTurns.push(providerCalls.length);
      }
    });
    providerCalls = f.providerCalls;
    const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Fix addition bug",
      base_branch: "main"
    }).id;
    const run = await f.wait(id, "proposed");
    expect(providerCalls).toHaveLength(1);
    expect(readTurns).toEqual([0, 0]);
    expect(run.snapshot).toEqual(
      Object.entries(originals).map(([path, content]) => ({ path, content }))
    );
    expect(run.proposal?.[0]?.before).toBe(originals["src/add.js"]);
    const messages = providerCalls[0]!.messages as Array<{ role: string; content: string }>;
    expect(
      JSON.parse(messages.find((message) => message.role === "user")!.content) as unknown
    ).toMatchObject({
      commit: head,
      files: Object.entries(originals).map(([path, content]) => ({ path, content }))
    });
    expect(providerCalls.every((call) => call.tools === undefined)).toBe(true);
    expect(f.githubCalls.every((call) => call.method === "GET")).toBe(true);
  });

  it("never treats a model file-selection response as authority or sends a repair generation", async () => {
    for (const path of ["../outside.js", "src/missing.js", ".env"]) {
      const response = sse(
        {
          choices: [
            { index: 0, delta: { content: JSON.stringify({ paths: [path] }) }, finish_reason: null }
          ]
        },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        "[DONE]"
      );
      const f = await fixture({ toolCalling: false, responses: [response] });
      const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
        task: "Fix addition bug",
        base_branch: "main"
      }).id;
      expect((await f.wait(id, "failed")).error).toBe("INVALID_PATCH");
      expect(f.providerCalls).toHaveLength(1);
      expect(f.githubCalls.filter((call) => call.path.startsWith("/git/blobs/"))).toHaveLength(2);
      expect(f.githubCalls.every((call) => call.method === "GET")).toBe(true);
      expect(f.checked).toHaveLength(0);
    }
  });
});

describe("Code owner budget via shared AccountStore port", () => {
  it("reserves before HTTP and reconciles only canonical committed ledger", async () => {
    const reserves: unknown[] = [],
      ledgers: unknown[] = [];
    const f = await fixture({
      ownerBudget: {
        reserve: (input) => {
          reserves.push(input);
          return true;
        },
        reconcile: (input) => {
          ledgers.push(input.ledger);
        },
        releaseBeforeDispatch: () => {
          throw new Error("unexpected release");
        }
      }
    });
    const id = await f.start();
    await f.wait(id, "proposed");
    expect(f.service.view(f.get(id)).usage).toMatchObject({
      input_tokens: 300,
      output_tokens: 120,
      unknown_attempts: 3,
      owner_budget_connected: true
    });
    await f.service.reconcileOwnerBudget();
    expect(f.providerCalls).toHaveLength(3);
    expect(reserves).toHaveLength(3);
    expect(ledgers).toHaveLength(6);
    for (const rows of ledgers)
      expect(rows).toEqual([
        expect.objectContaining({
          status: "committed",
          actual_input_tokens: 100,
          actual_output_tokens: 40
        })
      ]);
  });
  it("budget denial prevents provider dispatch", async () => {
    const f = await fixture({
      ownerBudget: {
        reserve: () => false,
        reconcile: () => {
          throw new Error("unexpected reconcile");
        },
        releaseBeforeDispatch: () => {
          throw new Error("unexpected release");
        }
      }
    });
    await f.wait(await f.start(), "failed");
    expect(f.providerCalls).toHaveLength(0);
  });
  it("post-dispatch malformed stream keeps unknown usage in reconciliation", async () => {
    const reconciled: unknown[] = [];
    const releases: unknown[] = [];
    const f = await fixture({
      responses: ["data: malformed\n\n"],
      ownerBudget: {
        reserve: () => true,
        reconcile: (input) => {
          reconciled.push(input.ledger);
        },
        releaseBeforeDispatch: (input) => {
          releases.push(input);
        }
      }
    });
    await f.wait(await f.start(), "failed");
    expect(f.providerCalls).toHaveLength(1);
    expect(releases).toHaveLength(0);
    expect(reconciled).toEqual([
      [
        expect.objectContaining({
          status: "failed",
          actual_input_tokens: null,
          calculated_cost_amount: null
        })
      ]
    ]);
  });
  it("proven cancellation inside reserve releases before gateway resumes HTTP", async () => {
    const releases: unknown[] = [];
    const f: Awaited<ReturnType<typeof fixture>> = await fixture({
      ownerBudget: {
        reserve: () => {
          const run = f.store.list(f.project, owner)[0]!;
          f.service.cancel(run.id, owner);
          return true;
        },
        reconcile: () => {
          throw new Error("unexpected reconciliation");
        },
        releaseBeforeDispatch: (input) => {
          releases.push(input);
        }
      }
    });
    await f.wait(await f.start(), "cancelled");
    await f.service.stop();
    expect(f.providerCalls).toHaveLength(0);
    expect(releases).toHaveLength(1);
  });
  it("unavailable check retries same reviewed snapshot; old pass cannot publish during retry", async () => {
    let attempts = 0;
    const f = await fixture({
      runner: {
        run: (input) =>
          Promise.resolve({
            status: attempts++ === 0 ? "unavailable" : "passed",
            snapshotDigest: input.expectedDigest!,
            exitCode: attempts === 1 ? null : 0,
            stdout: "",
            stderr: "",
            truncated: false,
            cleanupVerified: attempts !== 1,
            journal: []
          })
      }
    });
    const id = await f.start();
    const reviewed = await f.review(id);
    const hash = reviewed.draft!.plan.review_hash;
    const unavailable = await f.check(id, hash);
    expect(unavailable.check!.status).toBe("unavailable");
    expect(unavailable.publication_token).toBeUndefined();
    await expect(
      f.service.publish(id, owner, {
        review_hash: hash,
        publication_token: "invalid",
        approve: true
      })
    ).rejects.toThrow("CHECK_REQUIRED");
    const passed = await f.check(id, hash);
    expect(passed.check!.status).toBe("passed");
    expect(f.githubCalls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

const textResponse = (value: unknown) =>
  sse(
    {
      choices: [
        {
          index: 0,
          delta: { content: typeof value === "string" ? value : JSON.stringify(value) },
          finish_reason: null
        }
      ]
    },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 40 } },
    "[DONE]"
  );
const wrongCountsDiff =
  "diff --git a/src/add.js b/src/add.js\n--- a/src/add.js\n+++ b/src/add.js\n@@ -1,18 +1,19 @@\n-export const add = (a,b) => a-b;\n+export const add = (a,b) => a+b;\n";

describe("one text proposal → exact diff → optional approved automatic check → owner review", () => {
  it("normalizes only hunk counts in one paid turn and reuses auto-check only after exact owner review", async () => {
    const reserves: unknown[] = [];
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse({ summary: "Fix", diff: wrongCountsDiff })],
      ownerBudget: {
        reserve: (input) => {
          expect(f.providerCalls).toHaveLength(0);
          reserves.push(input);
          return true;
        },
        reconcile: () => undefined,
        releaseBeforeDispatch: () => {
          throw new Error("not local failure");
        }
      }
    });
    const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Fix src/add.js",
      base_branch: "main",
      files: ["src/add.js"],
      auto_check: { check: "syntax", approve: true }
    }).id;
    await expect.poll(() => f.get(id).proposal_check?.status).toBe("passed");
    const proposal = f.get(id);
    expect(proposal.status).toBe("proposed");
    expect(proposal.proposal_diff).toBe(wrongCountsDiff.replace("-1,18 +1,19", "-1,1 +1,1"));
    expect(proposal.proposal_normalizations).toHaveLength(1);
    expect(f.providerCalls).toHaveLength(1);
    expect(reserves).toHaveLength(1);
    expect(f.providerCalls[0]!.tools).toBeUndefined();
    expect(f.checked).toHaveLength(1);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
    expect(proposal.publication_token).toBeUndefined();
    const reviewed = await f.review(id, [changes[0]!]);
    expect(reviewed.status).toBe("checked");
    expect(reviewed.check!.snapshotDigest).toBe(proposal.proposal_check!.snapshotDigest);
    expect(reviewed.publication_token).toBeDefined();
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });
  it("never reruns the model to repair foreign deletions, positions or ambiguous paths", async () => {
    for (const diff of [
      wrongCountsDiff.replace("a-b", "a*b"),
      wrongCountsDiff.replace("-1,18", "-2,18"),
      wrongCountsDiff.replace("b/src/add.js", "b/../add.js")
    ]) {
      const f = await fixture({
        toolCalling: false,
        responses: [textResponse({ summary: "wrong", diff })]
      });
      const run = await f.wait(await f.start(), "failed");
      expect(run.error).toMatch(/^PATCH_/);
      expect(f.providerCalls).toHaveLength(1);
      expect(f.checked).toHaveLength(0);
      expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
    }
  });
  it("raw fenced diff works without capabilities or another model request", async () => {
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse("```diff\n" + wrongCountsDiff + "```\n")]
    });
    expect((await f.wait(await f.start(), "proposed")).proposal?.[0]?.content).toBe(
      changes[0]!.content
    );
    expect(f.providerCalls).toHaveLength(1);
  });
  it("legacy import is owner-scoped, validates remote base and reads immutable blobs without a model call", async () => {
    const f = await fixture();
    const imported = await f.app.inject({
      method: "POST",
      url: f.base + "/import-diff",
      payload: { task: "Import", base_branch: "main", base_sha: head, diff: wrongCountsDiff }
    });
    expect(imported.statusCode).toBe(200);
    const id = imported.json<{ id: string }>().id;
    await f.wait(id, "proposed");
    expect(f.providerCalls).toHaveLength(0);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
    const other = await f.app.inject({
      method: "POST",
      url: f.base.replace(f.project, "other-project") + "/import-diff",
      payload: { task: "Import", base_branch: "main", base_sha: head, diff: wrongCountsDiff }
    });
    expect(other.statusCode).toBe(404);
    const stale = f.service.importDiff(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Import",
      base_branch: "main",
      base_sha: "f".repeat(40),
      diff: wrongCountsDiff
    });
    expect((await f.wait(stale.id, "failed")).error).toBe("PATCH_BASE");
    expect(f.providerCalls).toHaveLength(0);
  });
  it("edit immediately invalidates automatic proof/token; new contents cannot reuse the old check", async () => {
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse({ summary: "Fix", diff: wrongCountsDiff })]
    });
    const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Fix",
      base_branch: "main",
      files: ["src/add.js"],
      auto_check: { check: "syntax", approve: true }
    }).id;
    await expect.poll(() => f.get(id).proposal_check?.status).toBe("passed");
    const reviewed = await f.review(id, [changes[0]!]);
    const oldToken = reviewed.publication_token!;
    const invalidated = f.service.invalidateReview(id, owner, f.get(id).proposal_hash!);
    expect(invalidated.check).toBeUndefined();
    expect(invalidated.proposal_check).toBeUndefined();
    expect(invalidated.publication_token).toBeUndefined();
    await expect(
      f.service.publish(id, owner, {
        review_hash: reviewed.draft!.plan.review_hash,
        publication_token: oldToken,
        approve: true
      })
    ).rejects.toThrow("CHECK_REQUIRED");
    const edited = await f.review(id, [
      { ...changes[0]!, content: changes[0]!.content + "// owner edit\n" }
    ]);
    expect(edited.status).toBe("review");
    expect(edited.check).toBeUndefined();
    expect(f.providerCalls).toHaveLength(1);
  });
  it("preview rejects stale snapshot/base and reports exact path/line without mutating the proposal", async () => {
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse({ summary: "Fix", diff: wrongCountsDiff })]
    });
    const id = await f.start();
    const run = await f.wait(id, "proposed");
    const body = {
      proposal_hash: run.proposal_hash,
      base_sha: head,
      snapshot_digest: run.proposal_snapshot_digest,
      diff: wrongCountsDiff
    };
    const result = await f.app.inject({
      method: "POST",
      url: f.base + `/${id}/preview-diff`,
      payload: body
    });
    expect(result.statusCode).toBe(200);
    expect(f.get(id).version).toBe(run.version);
    const invalid = await f.app.inject({
      method: "POST",
      url: f.base + `/${id}/preview-diff`,
      payload: { ...body, diff: wrongCountsDiff.replace("a-b", "a*b") }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<unknown>()).toMatchObject({
      error: { code: "PATCH_CONTEXT", diagnostic: { path: "src/add.js", line: 4 } }
    });
    expect(() =>
      f.service.previewDiff(id, owner, {
        ...body,
        proposal_hash: run.proposal_hash!,
        snapshot_digest: "b".repeat(64)
      })
    ).toThrow("PATCH_SNAPSHOT");
    f.store.save({ ...f.get(id), snapshot: [{ path: "src/add.js", content: "changed\n" }] });
    await expect(f.review(id, [changes[0]!])).rejects.toThrow("PATCH_SNAPSHOT");
  });
  it("offline and timeout checks retry for free; no premature publication and no hidden model retry", async () => {
    let attempts = 0;
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse({ summary: "Fix", diff: wrongCountsDiff })],
      runner: {
        run: (input) =>
          Promise.resolve({
            status: ["unavailable", "timed_out", "passed"][attempts++] as
              "unavailable" | "timed_out" | "passed",
            snapshotDigest: input.expectedDigest!,
            exitCode: attempts === 3 ? 0 : null,
            stdout: "",
            stderr: "",
            truncated: false,
            cleanupVerified: attempts !== 1,
            journal: []
          })
      }
    });
    const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Fix",
      base_branch: "main",
      files: ["src/add.js"],
      auto_check: { check: "syntax", approve: true }
    }).id;
    await expect.poll(() => f.get(id).proposal_check?.status).toBe("unavailable");
    await f.service.stop();
    const request = {
      proposal_hash: f.get(id).proposal_hash!,
      check: "syntax" as const,
      approve: true as const
    };
    expect(f.service.retryProposalCheck(id, owner, request).status).toBe("checking");
    await expect.poll(() => f.get(id).proposal_check?.status).toBe("timed_out");
    await f.service.stop();
    f.service.retryProposalCheck(id, owner, request);
    await expect.poll(() => f.get(id).proposal_check?.status).toBe("passed");
    expect(f.providerCalls).toHaveLength(1);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("Code automatic execution lifecycle", () => {
  it("uses actual authenticated HTTP client/server for normalized diff check (OCI result explicitly synthetic)", async () => {
    let calls = 0;
    const sidecar = createCodeAgentExecutorServer({
      token: "t".repeat(48),
      runner: {
        run: (input) => {
          calls++;
          expect(input.files[0]!.content).toBe(changes[0]!.content);
          return Promise.resolve({
            status: "passed",
            snapshotDigest: input.expectedDigest!,
            exitCode: 0,
            stdout: "HTTP transport fixture; no OCI runtime",
            stderr: "",
            truncated: false,
            cleanupVerified: true,
            journal: []
          });
        }
      }
    });
    await new Promise<void>((resolve) => sidecar.server.listen(0, "127.0.0.1", resolve));
    const address = sidecar.server.address();
    if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
    resources.push(() => sidecar.stop());
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse({ summary: "Fix", diff: wrongCountsDiff })],
      runner: createCodeAgentHttpExecutor({
        url: `http://127.0.0.1:${address.port}`,
        token: "t".repeat(48),
        pollMs: 5
      })
    });
    const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Fix",
      base_branch: "main",
      files: ["src/add.js"],
      auto_check: { check: "syntax", approve: true }
    }).id;
    await expect.poll(() => f.get(id).proposal_check?.status).toBe("passed");
    expect(calls).toBe(1);
    expect(f.providerCalls).toHaveLength(1);
    expect(f.githubCalls.every((c) => c.method === "GET")).toBe(true);
  });
  it("cancellation with unverified cleanup remains unavailable, never a checked/publishable proposal", async () => {
    let entered = false;
    const f = await fixture({
      toolCalling: false,
      responses: [textResponse({ summary: "Fix", diff: wrongCountsDiff })],
      runner: {
        run: (input) =>
          new Promise((resolve) => {
            entered = true;
            input.signal!.addEventListener(
              "abort",
              () =>
                resolve({
                  status: "unavailable",
                  snapshotDigest: input.expectedDigest!,
                  exitCode: null,
                  stdout: "",
                  stderr: "cleanup not proven",
                  truncated: false,
                  cleanupVerified: false,
                  journal: []
                }),
              { once: true }
            );
          })
      }
    });
    const id = f.service.create(f.project, LOCAL_DEVELOPMENT_IDENTITY, {
      task: "Fix",
      base_branch: "main",
      files: ["src/add.js"],
      auto_check: { check: "syntax", approve: true }
    }).id;
    await expect.poll(() => entered).toBe(true);
    f.service.cancel(id, owner);
    await f.service.stop();
    expect(f.get(id).proposal_check).toMatchObject({
      status: "unavailable",
      cleanupVerified: false
    });
    expect(f.get(id).publication_token).toBeUndefined();
    const reviewed = await f.review(id, [changes[0]!]);
    expect(reviewed.status).toBe("review");
    expect(reviewed.check).toBeUndefined();
  });
});
