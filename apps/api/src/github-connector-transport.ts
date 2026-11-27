import type { ConnectorTransport } from "@cosmora/tool-runtime";
import type { GithubIntegration } from "./github-integration.js";

/**
 * Read-only GitHub connector transport. It reuses the existing server-owned
 * integration (token, owner isolation, rate limits) and never exposes the token
 * to the descriptor/catalog. Draft PR publication remains owned by the existing
 * Koscode confirmation flow and is deliberately NOT bound here.
 */
export function githubConnectorTransports(github: GithubIntegration): ConnectorTransport {
  return {
    async execute(input: unknown, context) {
      const value = input as { ref?: string; path?: string };
      const path = value?.path;
      if (typeof path !== "string" || !path || path.includes("..") || path.startsWith("/"))
        throw new Error("GITHUB_INVALID_PATH");
      const branch = typeof value.ref === "string" && value.ref ? value.ref : "main";
      const tree = await github.tree(branch, { allowed: () => true });
      const match = tree.items.find((entry) => entry.path === path && entry.type === "blob");
      if (!match) throw new Error("GITHUB_FILE_NOT_FOUND");
      const file = await github.file(match.sha, { allowed: () => true });
      return {
        path,
        ref: branch,
        sha: match.sha,
        content: file.content
      };
    }
  };
}
