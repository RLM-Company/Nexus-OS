import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../../scripts/intelligence-graph-scale.mjs", import.meta.url)
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Intelligence Graph scale harness", () => {
  it("generates a deterministic bounded synthetic graph and matching manifest", () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-graph-scale-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "graph.ndjson.gz");

    const result = spawnSync(
      process.execPath,
      [
        script,
        "--edges=1000",
        "--projects=10",
        "--nodes-per-project=100",
        `--output=${output}`
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    const manifest = JSON.parse(result.stdout) as {
      edge_count: number;
      project_count: number;
      total_logical_nodes: number;
      logical_sha256: string;
      invariants: Record<string, boolean>;
      traversal: {
        bounded_query_runs: number;
        bounded_query_max_nodes_visited: number;
        bounded_query_max_edges_visited: number;
      };
    };

    expect(manifest).toMatchObject({
      edge_count: 1000,
      project_count: 10,
      total_logical_nodes: 1000,
      invariants: {
        same_owner: true,
        same_project_endpoints: true,
        no_self_edges: true,
        deterministic_ids: true,
        deterministic_content: true
      }
    });

    const logical = gunzipSync(readFileSync(output));
    const lines = logical.toString("utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1000);
    expect(createHash("sha256").update(logical).digest("hex")).toBe(manifest.logical_sha256);

    const first = JSON.parse(lines[0] ?? "{}") as {
      edge_id?: string;
      project_id?: string;
      from?: { id?: string };
      to?: { id?: string };
    };
    const last = JSON.parse(lines.at(-1) ?? "{}") as { edge_id?: string };

    expect(first).toMatchObject({
      edge_id: "synthetic:p0:e0",
      project_id: "synthetic-project-0"
    });
    expect(first.from?.id).toMatch(/^synthetic:p0:n/);
    expect(first.to?.id).toMatch(/^synthetic:p0:n/);
    expect(last.edge_id).toBe("synthetic:p9:e99");

    expect(manifest.traversal.bounded_query_runs).toBe(100);
    expect(manifest.traversal.bounded_query_max_nodes_visited).toBeLessThanOrEqual(64);
    expect(manifest.traversal.bounded_query_max_edges_visited).toBeLessThanOrEqual(128);
  });

  it("rejects impossible scale parameters before generation", () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-graph-scale-invalid-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "graph.ndjson.gz");

    const result = spawnSync(
      process.execPath,
      [
        script,
        "--edges=10",
        "--projects=20",
        "--nodes-per-project=100",
        `--output=${output}`
      ],
      { encoding: "utf8" }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--projects cannot exceed --edges");
  });
});
