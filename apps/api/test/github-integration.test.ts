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
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let currentHead = head;
  let failPr = false;
  let prExists = false;
  const integration = new GithubIntegration({
    token: "fixture-key",
    fetchImplementation: (input, init) => {
      const path = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      ).pathname.replace("/repos/RLM-Company/Nexus-OS", "");
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ path, method: init?.method ?? "GET", body });
      const data = path.startsWith("/commits/")
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
                  ? {}
                  : path === "/pulls" && init?.method === "POST"
                    ? { html_url: "https://github.com/RLM-Company/Nexus-OS/pull/1000" }
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
      return Promise.resolve(
        new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } })
      );
    }
  });
  return {
    integration,
    calls,
    changeHead: () => {
      currentHead = "e".repeat(40);
    },
    losePrResponse: () => {
      failPr = true;
    }
  };
}

describe("GitHub owner workflow", () => {
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
