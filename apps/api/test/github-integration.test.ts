import { describe, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { EmergencyStopStore, ProjectStore, openDatabase, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver, LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import {
  GithubIntegration,
  GithubDraftStore,
  type GithubDraft
} from "../src/github-integration.js";

const head = "a".repeat(40),
  tree = "b".repeat(40),
  blob = "c".repeat(40),
  commit = "d".repeat(40);
function fixture() {
  const calls: Array<{ path: string; method: string; body: unknown; search: string }> = [];
  let currentHead = head;
  let failPr = false;
  let prExists = false;
  let override: ((path: string, method: string, data: unknown) => Response | null) | null = null;
  const integration = new GithubIntegration({
    token: "fixture-key",
    fetchImplementation: (input, init) => {
      const path = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      ).pathname.replace("/repos/RLM-Company/Nexus-OS", "");
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      calls.push({
        path,
        method: init?.method ?? "GET",
        body,
        search: new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        ).search
      });
      const data = path.startsWith("/git/ref/heads/")
        ? {
            ref: `refs/heads/${decodeURIComponent(path.slice("/git/ref/heads/".length))}`,
            object: { type: "commit", sha: currentHead }
          }
        : path.startsWith("/commits/")
          ? { sha: currentHead, commit: { tree: { sha: tree } } }
          : path.startsWith("/git/trees/")
            ? {
                tree: [{ path: "app.ts", type: "blob", mode: "100755", sha: blob }],
                truncated: false
              }
            : path.startsWith("/git/blobs/")
              ? {
                  content: Buffer.from("const value = 1;").toString("base64"),
                  encoding: "base64",
                  size: 16
                }
              : path === "/git/trees"
                ? { sha: tree }
                : path === "/git/commits"
                  ? { sha: commit }
                  : path === "/git/refs"
                    ? {
                        ref: (body as { ref: string }).ref,
                        object: { type: "commit", sha: commit }
                      }
                    : path === "/pulls" && init?.method === "POST"
                      ? {
                          html_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000",
                          draft: true,
                          head: { sha: commit, ref: (body as { head: string }).head },
                          base: { ref: (body as { base: string }).base }
                        }
                      : path === "/pulls"
                        ? prExists
                          ? [
                              {
                                html_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000",
                                head: { sha: commit },
                                base: { ref: "main" }
                              }
                            ]
                          : []
                        : { default_branch: "main", private: true };
      if (path === "/pulls" && init?.method === "POST") {
        prExists = true;
        if (failPr) throw new Error("Connection lost after GitHub accepted request: fixture-key");
      }
      const overridden = override?.(path, init?.method ?? "GET", data);
      if (overridden) return Promise.resolve(overridden);
      return Promise.resolve(
        new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } })
      );
    }
  });
  return {
    integration,
    calls,
    respond: (handler: NonNullable<typeof override>) => {
      override = handler;
    },
    changeHead: () => {
      currentHead = "e".repeat(40);
    },
    losePrResponse: () => {
      failPr = true;
    }
  };
}

describe("GitHub owner workflow", () => {
  it("paginates bounded branch reads and rejects invalid pages before GitHub access", async () => {
    const f = fixture();
    f.respond((path) =>
      path === "/branches"
        ? new Response(
            JSON.stringify(
              new URLSearchParams(f.calls.at(-1)!.search).get("page") === "1"
                ? Array.from({ length: 100 }, (_, i) => ({
                    name: `branch-${i}`,
                    commit: { sha: head }
                  }))
                : [{ name: "feature/after-100", commit: { sha: head } }]
            )
          )
        : null
    );
    expect(await f.integration.branches()).toMatchObject({ page: 1, next_page: 2, limited: false });
    expect(await f.integration.branches(2)).toEqual({
      items: [{ name: "feature/after-100", sha: head }],
      page: 2,
      next_page: null,
      limited: false
    });
    expect(f.calls.at(-1)!.search).toBe("?per_page=100&page=2");
    const count = f.calls.length;
    for (const page of [0, -1, 1.5, 1001, NaN])
      await expect(f.integration.branches(page)).rejects.toThrow("GITHUB_INVALID_FILE");
    expect(f.calls).toHaveLength(count);
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      githubIntegration: f.integration
    });
    try {
      for (const query of ["page=0", "page=1.5", "page=1001"])
        expect(
          (await app.inject({ method: "GET", url: `/api/v1/github/branches?${query}` })).statusCode
        ).toBe(400);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/github/branches?page=2" })).json()
      ).toMatchObject({ page: 2, next_page: null });
      // Fastify strips extra query fields; they cannot select another repository.
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/github/branches?page=2&repository=Other/Repo"
          })
        ).json()
      ).toMatchObject({ page: 2, next_page: null });
      expect(f.integration.repository).toBe("RLM-Company/Nexus-OS");
    } finally {
      await app.close();
      database.close();
    }
  });
  it("binds recovery/reviews to owner, repository, token and effective permissions without exposing a credential", async () => {
    const f = fixture();
    const first = await f.integration.status();
    expect(first.workspace_scope).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("fixture-key");
    expect((await f.integration.status()).workspace_scope).toBe(first.workspace_scope);
    const statusFetch: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ default_branch: "main", private: true })));
    for (const config of [
      { ownerId: "other" },
      { repository: "Other/Repo" },
      { token: "other-key" }
    ]) {
      const other = new GithubIntegration({
        token: "fixture-key",
        fetchImplementation: statusFetch,
        ...config
      });
      expect((await other.status()).workspace_scope).not.toBe(first.workspace_scope);
    }
    const plan = await f.integration.prepare("bound", {
      base_branch: "main",
      base_sha: head,
      title: "Fix",
      files: [{ path: "app.ts", content: "2" }],
      workspace_scope: first.workspace_scope!
    });
    f.respond((path) =>
      path === ""
        ? new Response(
            JSON.stringify({
              default_branch: "main",
              private: true,
              permissions: { pull: true, push: false }
            })
          )
        : null
    );
    await expect(
      f.integration.prepare("bound", {
        base_branch: "main",
        base_sha: head,
        title: "Fix",
        files: [{ path: "app.ts", content: "2" }],
        workspace_scope: first.workspace_scope!
      })
    ).rejects.toThrow("GITHUB_CONFLICT");
    await expect(
      f.integration.publish(
        plan,
        () => true,
        () => {}
      )
    ).rejects.toThrow("GITHUB_CONFLICT");
    expect(f.calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("reviews multiple edits/new files as one immutable set and creates exactly one branch and draft PR", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const f = fixture();
    const drafts = new GithubDraftStore(database.sqlite);
    const projects = new ProjectStore(database.sqlite);
    const project = projects.createProject("Code", "multi-files").project.id;
    const input = {
      base_branch: "main",
      base_sha: head,
      title: "Several files",
      files: [
        { path: "app.ts", content: "2" },
        { path: "src/new.ts", content: "new" },
        { path: "src/empty.ts", content: "" }
      ]
    };
    const draft = await drafts.create("local-owner", project, f.integration, input);
    expect(draft.plan.files.map(({ path, before }) => ({ path, before }))).toEqual([
      { path: "app.ts", before: "const value = 1;" },
      { path: "src/new.ts", before: null },
      { path: "src/empty.ts", before: null }
    ]);
    const altered = await f.integration.prepare(draft.id, {
      ...input,
      files: [...input.files.slice(0, 2), { path: "src/empty.ts", content: "changed" }]
    });
    expect(altered.review_hash).not.toBe(draft.plan.review_hash);
    expect(() => drafts.claim(draft.id, "local-owner", altered.review_hash)).toThrow(
      "GITHUB_CONFLICT"
    );
    await expect(
      f.integration.prepare("duplicate", { ...input, files: [input.files[0]!, input.files[0]!] })
    ).rejects.toThrow("GITHUB_INVALID_FILE");
    await expect(
      f.integration.prepare("too-big", {
        ...input,
        files: Array.from({ length: 4 }, (_, i) => ({
          path: `${i}.ts`,
          content: "a".repeat(40001)
        }))
      })
    ).rejects.toThrow("GITHUB_INVALID_FILE");
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      projectStore: projects,
      githubDraftStore: drafts,
      githubIntegration: f.integration,
      emergencyStopStore: new EmergencyStopStore(database.sqlite)
    });
    try {
      const responses = await Promise.all(
        [1, 2].map(() =>
          app.inject({
            method: "POST",
            url: `/api/v1/projects/${project}/github-drafts/${draft.id}/publish`,
            payload: { approve: true, review_hash: draft.plan.review_hash }
          })
        )
      );
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      const writes = f.calls.filter((call) => call.method === "POST");
      expect(writes.map((call) => call.path)).toEqual([
        "/git/trees",
        "/git/commits",
        "/git/refs",
        "/pulls"
      ]);
      expect((writes[0]!.body as { tree: unknown[] }).tree).toHaveLength(3);
      expect(drafts.get(draft.id, "local-owner")?.status).toBe("published");
    } finally {
      await app.close();
      database.close();
    }
  });
  it("creates an empty new file, pins a slash-named base branch and reads it without writes", async () => {
    const f = fixture();
    const plan = await f.integration.prepare("new-file", {
      base_branch: "feature/code",
      base_sha: head,
      title: "Add file",
      files: [{ path: "src/empty.ts", content: "" }]
    });
    expect(plan.files).toEqual([
      { path: "src/empty.ts", content: "", before: null, mode: "100644" }
    ]);
    expect(f.calls.map((call) => call.path)).toEqual([
      "",
      "/git/ref/heads/feature%2Fcode",
      `/commits/${head}`,
      `/git/trees/${tree}`
    ]);
    expect(f.calls.every((call) => call.method === "GET")).toBe(true);
  });
  it.each([
    [401, {}, "GITHUB_ACCESS_DENIED"],
    [403, {}, "GITHUB_ACCESS_DENIED"],
    [403, { "x-ratelimit-remaining": "0" }, "GITHUB_RATE_LIMITED"],
    [429, {}, "GITHUB_RATE_LIMITED"]
  ])("returns a safe error for GitHub refusal %s", async (status, headers, code) => {
    const f = fixture();
    f.respond(() => new Response("fixture-key provider details", { status, headers }));
    await expect(f.integration.status()).rejects.toThrow(code);
  });
  it("rejects malformed successful reads and inconsistent blob sizes", async () => {
    const f = fixture();
    f.respond(() => new Response("null"));
    await expect(f.integration.status()).rejects.toThrow("GITHUB_UNAVAILABLE");
    await expect(f.integration.branches()).rejects.toThrow("GITHUB_UNAVAILABLE");
    await expect(f.integration.tree("main")).rejects.toThrow("GITHUB_UNAVAILABLE");
    f.respond(
      () =>
        new Response(
          JSON.stringify({
            default_branch: "main",
            private: true,
            permissions: { push: "unexpected" }
          })
        )
    );
    await expect(f.integration.status()).rejects.toThrow("GITHUB_UNAVAILABLE");
    f.respond(() => new Response(JSON.stringify({ content: "!!!", encoding: "base64", size: 0 })));
    await expect(f.integration.file(blob)).rejects.toThrow("GITHUB_INVALID_FILE");
    f.respond(() => new Response(JSON.stringify({ content: "YQ==", encoding: "base64", size: 2 })));
    await expect(f.integration.file(blob)).rejects.toThrow("GITHUB_INVALID_FILE");
  });
  it("does not create a PR after an ambiguous branch response", async () => {
    const f = fixture();
    const plan = await f.integration.prepare("id", {
      base_branch: "main",
      base_sha: head,
      title: "Fix",
      files: [{ path: "app.ts", content: "2" }]
    });
    f.respond((path) =>
      path === "/git/refs"
        ? new Response(
            JSON.stringify({
              ref: "refs/heads/wrong",
              object: { type: "commit", sha: commit }
            })
          )
        : null
    );
    const checkpoint: string[] = [];
    await expect(
      f.integration.publish(
        plan,
        () => true,
        (sha) => checkpoint.push(sha)
      )
    ).rejects.toThrow("GITHUB_UNAVAILABLE");
    expect(checkpoint).toEqual([commit]);
    expect(f.calls.some((call) => call.path === "/pulls")).toBe(false);
  });
  it.each([
    "invalid",
    "https://github.com/RLM-Company/Nexus-OS/pull/not-a-pr",
    "https://github.com/RLM-Company/Nexus-OS/pull/1000/other",
    "https://example.org/pull/1000"
  ])("keeps an invalid PR confirmation uncertain: %s", async (html_url) => {
    const f = fixture();
    const plan = await f.integration.prepare("id", {
      base_branch: "main",
      base_sha: head,
      title: "Fix",
      files: [{ path: "app.ts", content: "2" }]
    });
    f.respond((path, method, data) =>
      path === "/pulls" && method === "POST"
        ? new Response(JSON.stringify({ ...(data as object), html_url }))
        : null
    );
    await expect(
      f.integration.publish(
        plan,
        () => true,
        () => {}
      )
    ).rejects.toThrow("GITHUB_UNAVAILABLE");
    expect(f.calls.filter((call) => call.path === "/pulls" && call.method === "POST")).toHaveLength(
      1
    );
  });
  it("releases a draft when the base changed before any write", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const f = fixture();
    const projects = new ProjectStore(database.sqlite);
    const project = projects.createProject("Code", "github-preflight").project.id;
    const drafts = new GithubDraftStore(database.sqlite);
    const draft = await drafts.create("local-owner", project, f.integration, {
      base_branch: "main",
      base_sha: head,
      title: "Fix",
      files: [{ path: "app.ts", content: "2" }]
    });
    f.changeHead();
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      projectStore: projects,
      githubIntegration: f.integration,
      githubDraftStore: drafts,
      emergencyStopStore: new EmergencyStopStore(database.sqlite)
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${project}/github-drafts/${draft.id}/publish`,
        payload: { approve: true, review_hash: draft.plan.review_hash }
      });
      expect(response.statusCode).toBe(409);
      expect(drafts.get(draft.id, "local-owner")?.status).toBe("review");
      expect(f.calls.every((call) => call.method === "GET")).toBe(true);
    } finally {
      await app.close();
      database.close();
    }
  });
  it.each([{ draft: false }, { head: { sha: head, ref: "wrong" } }, { base: { ref: "other" } }])(
    "rejects a PR confirmation that differs from the reviewed publication: %j",
    async (mismatch) => {
      const f = fixture();
      const plan = await f.integration.prepare("id", {
        base_branch: "main",
        base_sha: head,
        title: "Fix",
        files: [{ path: "app.ts", content: "2" }]
      });
      f.respond((path, method, data) =>
        path === "/pulls" && method === "POST"
          ? new Response(JSON.stringify({ ...(data as object), ...mismatch }))
          : null
      );
      await expect(
        f.integration.publish(
          plan,
          () => true,
          () => {}
        )
      ).rejects.toThrow("GITHUB_UNAVAILABLE");
    }
  );
  it("binds repository reads to the configured owner without a GitHub request from another owner", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const f = fixture();
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      githubIntegration: f.integration,
      identityResolver: new StaticIdentityResolver({
        ...LOCAL_DEVELOPMENT_IDENTITY,
        owner_id: "other-owner"
      })
    });
    try {
      for (const url of [
        "/api/v1/github/status",
        "/api/v1/github/branches",
        "/api/v1/github/tree?ref=main",
        `/api/v1/github/file?sha=${blob}`
      ])
        expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
      expect(f.calls).toHaveLength(0);
    } finally {
      await app.close();
      database.close();
    }
  });
  it("prepares durable changes without writes; requires the exact review, publishes once and preserves file mode", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const f = fixture();
    const drafts = new GithubDraftStore(database.sqlite);
    const projects = new ProjectStore(database.sqlite);
    const project = projects.createProject("Код", "github-test").project.id;
    const draft = await drafts.create("local-owner", project, f.integration, {
      base_branch: "main",
      base_sha: head,
      title: "Fix value",
      files: [{ path: "app.ts", content: "const value = 2;" }]
    });
    expect(f.calls.every((call) => call.method === "GET")).toBe(true);
    expect(
      new GithubDraftStore(database.sqlite).get(draft.id, "local-owner")?.plan.files[0]?.before
    ).toBe("const value = 1;");
    expect(drafts.get(draft.id, "another-owner")).toBeNull();
    expect(() => drafts.claim(draft.id, "local-owner", "f".repeat(64))).toThrow("GITHUB_CONFLICT");
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      projectStore: projects,
      githubIntegration: f.integration,
      githubDraftStore: drafts,
      emergencyStopStore: new EmergencyStopStore(database.sqlite)
    });
    try {
      const url = `/api/v1/projects/${project}/github-drafts/${draft.id}/publish`;
      const published = await app.inject({
        method: "POST",
        url,
        payload: { approve: true, review_hash: draft.plan.review_hash }
      });
      expect(published.statusCode).toBe(200);
      expect(published.json<GithubDraft>().status).toBe("published");
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            payload: { approve: true, review_hash: draft.plan.review_hash }
          })
        ).statusCode
      ).toBe(409);
      const writes = f.calls.filter((call) => call.method === "POST");
      expect(writes.map((call) => call.path)).toEqual([
        "/git/trees",
        "/git/commits",
        "/git/refs",
        "/pulls"
      ]);
      expect(writes[0]?.body).toMatchObject({
        base_tree: tree,
        tree: [{ mode: "100755", content: "const value = 2;" }]
      });
      expect(writes[2]?.body).toMatchObject({ ref: `refs/heads/cosmora/change-${draft.id}` });
      expect(writes[3]?.body).toMatchObject({ draft: true, base: "main" });
    } finally {
      await app.close();
      database.close();
    }
  });
  it("denies a non-owner, cross-owner access, and publishing during emergency stop without a GitHub write", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const f = fixture();
    const projects = new ProjectStore(database.sqlite);
    const drafts = new GithubDraftStore(database.sqlite);
    const emergency = new EmergencyStopStore(database.sqlite);
    const project = projects.createProject("Код", "github-gate").project.id;
    const draft = await drafts.create("local-owner", project, f.integration, {
      base_branch: "main",
      base_sha: head,
      title: "Fix",
      files: [{ path: "app.ts", content: "2" }]
    });
    emergency.activateProcess("Paused", "owner");
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      projectStore: projects,
      githubIntegration: f.integration,
      githubDraftStore: drafts,
      emergencyStopStore: emergency
    });
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/projects/${project}/github-drafts/${draft.id}/publish`,
            payload: { approve: true, review_hash: draft.plan.review_hash }
          })
        ).statusCode
      ).toBe(403);
      expect(drafts.get(draft.id, "local-owner")?.status).toBe("review");
      expect(f.calls.every((call) => call.method === "GET")).toBe(true);
    } finally {
      await app.close();
    }
    const agent = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      githubIntegration: f.integration,
      identityResolver: new StaticIdentityResolver({
        ...LOCAL_DEVELOPMENT_IDENTITY,
        actor_kind: "agent"
      })
    });
    try {
      expect((await agent.inject({ method: "GET", url: "/api/v1/github/status" })).statusCode).toBe(
        403
      );
    } finally {
      await agent.close();
      database.close();
    }
  });
  it("rejects changed bases, secret paths, links and credential text before writes", async () => {
    const f = fixture();
    for (const path of [
      "../evil.ts",
      ".env",
      ".github/workflows/ci.yml",
      "private/secret.txt",
      "a\\b.ts"
    ]) {
      await expect(
        f.integration.prepare("id", {
          base_branch: "main",
          base_sha: head,
          title: "Fix",
          files: [{ path, content: "2" }]
        })
      ).rejects.toThrow("GITHUB_INVALID_FILE");
    }
    await expect(
      f.integration.prepare("id", {
        base_branch: "main",
        base_sha: head,
        title: "Fix",
        files: [{ path: "app.ts", content: "fixture-key" }]
      })
    ).rejects.toThrow("GITHUB_INVALID_FILE");
    f.changeHead();
    await expect(
      f.integration.prepare("id", {
        base_branch: "main",
        base_sha: head,
        title: "Fix",
        files: [{ path: "app.ts", content: "2" }]
      })
    ).rejects.toThrow("GITHUB_BASE_CHANGED");
    expect(f.calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("reconciles a lost PR response with reads, without a second publication or leaking provider details", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    const f = fixture();
    const projects = new ProjectStore(database.sqlite);
    const project = projects.createProject("Code", "github-uncertain").project.id;
    const store = new GithubDraftStore(database.sqlite);
    const draft = await store.create("local-owner", project, f.integration, {
      base_branch: "main",
      base_sha: head,
      title: "Fix",
      files: [{ path: "app.ts", content: "2" }]
    });
    const claimed = store.claim(draft.id, "local-owner", draft.plan.review_hash);
    f.losePrResponse();
    await expect(
      f.integration.publish(
        claimed.plan,
        () => true,
        (sha) => store.checkpoint(draft.id, "local-owner", sha)
      )
    ).rejects.toThrow("GITHUB_UNAVAILABLE");
    store.finish(draft.id, "local-owner", null);
    const url = await f.integration.reconcile(store.get(draft.id, "local-owner")!);
    expect(url).toBe("https://github.com/RLM-Company/Nexus-OS/pull/1000");
    store.reconcile(draft.id, "local-owner", url!);
    expect(store.get(draft.id, "local-owner")?.status).toBe("published");
    expect(f.calls.filter((call) => call.path === "/pulls" && call.method === "POST")).toHaveLength(
      1
    );
    database.close();
  });
});
