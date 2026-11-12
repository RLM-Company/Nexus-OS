import { describe, expect, it } from "vitest";
import { GithubIntegration } from "../src/github-integration.js";

const head = "a".repeat(40),
  root = "b".repeat(40),
  child = "c".repeat(40),
  blob = "d".repeat(40);
function fixture(mode = "valid", onRoot = () => {}) {
  const calls: string[] = [];
  const integration = new GithubIntegration({
    token: "fixture-only",
    fetchImplementation: (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      );
      expect(url.origin).toBe("https://api.github.com");
      expect(init?.method).toBe("GET");
      calls.push(url.pathname + url.search);
      let value: unknown;
      if (url.pathname.includes("/commits/"))
        value = { sha: head, commit: { tree: { sha: root } } };
      else if (url.searchParams.has("recursive"))
        value = {
          sha: root,
          truncated: true,
          tree: [{ path: "partial-only", type: "blob", mode: "100644", sha: blob }]
        };
      else if (url.pathname.endsWith(root)) {
        onRoot();
        const dirs =
          mode === "wide" ? Array.from({ length: 130 }, (_, i) => `dir-${i}`) : ["a", "b"];
        const entries =
          mode === "duplicate" ? ["same", "same"] : mode === "slip" ? ["../escape"] : dirs;
        value = {
          sha: mode === "wrong-object" ? blob : root,
          truncated: mode === "partial",
          tree: entries.map((path) => ({
            path,
            type: "tree",
            mode: "040000",
            sha: mode === "cycle" ? root : child
          }))
        };
      } else
        value = {
          sha: child,
          truncated: false,
          tree: [{ path: "file.js", type: "blob", mode: "100755", sha: blob }]
        };
      return Promise.resolve(
        new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
      );
    }
  });
  return { integration, calls };
}

describe("Code repository complete tree recovery through the existing GitHub adapter", () => {
  it("expands immutable trees, preserves shared subtrees and executable mode, and discards recursive partial data", async () => {
    const f = fixture();
    const result = await f.integration.tree("main");
    expect(result).toMatchObject({ sha: head, tree_sha: root, truncated: false });
    expect(result.items.map((entry) => entry.path)).toEqual(["a", "b", "a/file.js", "b/file.js"]);
    expect(result.items.find((entry) => entry.path === "b/file.js")).toMatchObject({
      sha: blob,
      mode: "100755"
    });
    expect(f.calls.filter((path) => path.includes("/commits/"))).toHaveLength(1);
    expect(f.calls).toHaveLength(5);
  });
  it.each(["cycle", "wrong-object", "slip", "duplicate"])(
    "refuses malformed nonrecursive coverage: %s",
    async (mode) => {
      await expect(fixture(mode).integration.tree("main")).rejects.toThrow("GITHUB_INVALID_FILE");
    }
  );
  it.each(["partial", "wide"])(
    "never marks incomplete or over-budget coverage as complete: %s",
    async (mode) => {
      const f = fixture(mode);
      expect(await f.integration.tree("main")).toMatchObject({
        truncated: true,
        items: [{ path: "partial-only" }]
      });
      expect(f.calls.length).toBeLessThanOrEqual(130);
    }
  );
  it.each(["cancel", "revoke"])(
    "stops before child reads when scope changes during root retrieval: %s",
    async (action) => {
      const controller = new AbortController();
      let permitted = true;
      const f = fixture("valid", () => {
        if (action === "cancel") controller.abort();
        else permitted = false;
      });
      await expect(
        f.integration.tree("main", { signal: controller.signal, allowed: () => permitted })
      ).rejects.toThrow("GITHUB_CONFLICT");
      expect(f.calls).toHaveLength(3);
    }
  );
});
