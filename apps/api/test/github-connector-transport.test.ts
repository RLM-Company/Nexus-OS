/* eslint-disable @typescript-eslint/require-await -- Deterministic local fetch adapter. */
import { describe, expect, it } from "vitest";
import { GithubIntegration } from "../src/github-integration.js";
import { githubConnectorTransports } from "../src/github-connector-transport.js";

const fetchImpl = (async (url: string) => {
  const path = new URL(url).pathname;
  if (path.includes("/commits/")) {
    return new Response(
      JSON.stringify({ sha: "b".repeat(40), commit: { tree: { sha: "c".repeat(40) } } }),
      { status: 200 }
    );
  }
  if (path.includes("/git/trees/")) {
    return new Response(
      JSON.stringify({
        sha: "tree-1",
        tree_sha: "tree-1",
        tree: [{ path: "src/value.js", type: "blob", mode: "100644", sha: "a".repeat(40) }],
        truncated: false
      }),
      { status: 200 }
    );
  }
  if (path.endsWith("/git/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")) {
    const content = Buffer.from("export const value = 42;").toString("base64");
    return new Response(JSON.stringify({ content, encoding: "base64", size: 24 }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

describe("GitHub read connector transport", () => {
  it("reads a permitted repository file through the existing owner-scoped integration", async () => {
    const github = new GithubIntegration({
      repository: "RLM-Company/Nexus-OS",
      ownerId: "actor-a",
      token: "fixture-token",
      fetchImplementation: fetchImpl
    });
    const transport = githubConnectorTransports(github);
    const result = (await transport.execute(
      { ref: "main", path: "src/value.js" },
      {
        operationId: "op-1",
        projectId: "project-a",
        actorId: "actor-a",
        idempotencyKey: "key-1",
        objectIds: [],
        verdict: { decision: "allow" } as never
      }
    )) as { content: string; sha: string };
    expect(result.content).toBe("export const value = 42;");
    expect(result.sha).toBe("a".repeat(40));
    await expect(
      transport.execute(
        { path: "../secret" },
        {
          operationId: "op-2",
          projectId: "project-a",
          actorId: "actor-a",
          idempotencyKey: "key-2",
          objectIds: [],
          verdict: { decision: "allow" } as never
        }
      )
    ).rejects.toThrow("GITHUB_INVALID_PATH");
  });
});
