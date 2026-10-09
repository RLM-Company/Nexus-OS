/* eslint-disable @typescript-eslint/require-await -- asynchronous transport fixtures */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodeAgentExecutorServer } from "../src/code-agent-sidecar.js";
import { createCodeAgentHttpExecutor } from "../src/code-agent-http-client.js";
import { codeAgentSnapshotArchive, redactCodeAgentOutput } from "../src/code-agent-snapshot.js";
import {
  computeCodeAgentSnapshotDigest,
  type CodeAgentWorkspaceRunner,
  type CodeAgentWorkspaceResult
} from "../src/code-agent-workspace.js";
const token = "t".repeat(48);
const files = [{ path: "a.js", content: "console.log('ok');" }];
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});
async function listener(runner: CodeAgentWorkspaceRunner) {
  const sidecar = createCodeAgentExecutorServer({ token, runner });
  await new Promise<void>((resolve) => sidecar.server.listen(0, "127.0.0.1", resolve));
  const address = sidecar.server.address();
  if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
  const url = `http://127.0.0.1:${address.port}`;
  stops.push(() => sidecar.stop());
  return { url, client: createCodeAgentHttpExecutor({ url, token, pollMs: 5 }) };
}
const result = (
  status: CodeAgentWorkspaceResult["status"] = "passed"
): CodeAgentWorkspaceResult => ({
  status,
  snapshotDigest: computeCodeAgentSnapshotDigest(files),
  exitCode: status === "passed" ? 0 : null,
  stdout: "Bearer sensitive-value\u001b[31m",
  stderr: "",
  truncated: false,
  cleanupVerified: true,
  journal: []
});

describe("authenticated executor HTTP protocol (transport only)", () => {
  it("rejects unauthenticated and malformed jobs before execution; idempotent PUT cannot mutate snapshot", async () => {
    let calls = 0;
    const { url } = await listener({
      run: async () => {
        calls++;
        return result();
      }
    });
    const id = "11111111-1111-4111-8111-111111111111";
    const path = `${url}/v1/jobs/${id}`;
    expect((await fetch(path, { method: "PUT", body: "{bad" })).status).toBe(401);
    const put = (body: unknown) =>
      fetch(path, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
    const input = { files, check: "syntax", expectedDigest: computeCodeAgentSnapshotDigest(files) };
    expect((await put({ ...input, command: "sh" })).status).toBe(400);
    expect((await put({ ...input, expectedDigest: "f".repeat(64) })).status).toBe(400);
    expect((await put(input)).status).toBe(202);
    expect((await put(input)).status).toBe(200);
    const other = [{ path: "a.js", content: "changed" }];
    expect(
      (await put({ ...input, files: other, expectedDigest: computeCodeAgentSnapshotDigest(other) }))
        .status
    ).toBe(409);
    expect(calls).toBe(1);
  });
  it("returns exact digest, redacted output and acknowledges daemon cleanup through real HTTP", async () => {
    const { client } = await listener({ run: async () => result() });
    expect(await client.run({ files, check: "syntax" })).toMatchObject({
      status: "passed",
      stdout: "Bearer [REDACTED]",
      cleanupVerified: true
    });
  });
  it("DELETE waits for actual runner cancellation and records cleanup", async () => {
    let observed = false;
    const { client } = await listener({
      run: (input) =>
        new Promise((resolve) => {
          input.signal!.addEventListener(
            "abort",
            () => {
              observed = true;
              resolve(result("cancelled"));
            },
            { once: true }
          );
        })
    });
    const controller = new AbortController();
    const done = client.run({ files, check: "syntax", signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expect(await done).toMatchObject({ status: "cancelled", cleanupVerified: true });
    expect(observed).toBe(true);
  });
  it("propagates timeout/unavailable and never marks unverified cleanup passed", async () => {
    const timeout = await listener({ run: async () => result("timed_out") });
    expect((await timeout.client.run({ files, check: "syntax" })).status).toBe("timed_out");
    const unavailable = await listener({
      run: async () => ({ ...result(), cleanupVerified: false })
    });
    expect((await unavailable.client.run({ files, check: "syntax" })).status).toBe("unavailable");
  });
  it("lost PUT response sends DELETE with same id and never resubmits; mismatch fails closed", async () => {
    const methods: string[] = [];
    const paths: string[] = [];
    const client = createCodeAgentHttpExecutor({
      url: "http://code-executor:3210",
      token,
      fetchImplementation: async (url, init) => {
        methods.push(init!.method!);
        paths.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
        throw new Error("lost response");
      }
    });
    expect((await client.run({ files, check: "syntax" })).status).toBe("unavailable");
    expect(methods).toEqual(["PUT", "DELETE"]);
    expect(paths[0]).toBe(paths[1]);
    const bad = await listener({
      run: async () => ({ ...result(), snapshotDigest: "a".repeat(64) })
    });
    expect((await bad.client.run({ files, check: "syntax" })).status).toBe("unavailable");
  });
  it("copies approved content before awaiting HTTP and rejects redirects", async () => {
    let seen: unknown;
    const mutable = files.map((f) => ({ ...f }));
    const client = createCodeAgentHttpExecutor({
      url: "http://code-executor:3210",
      token,
      fetchImplementation: async (_url, init) => {
        expect(init!.redirect).toBe("error");
        if (init!.method === "PUT") {
          if (typeof init!.body !== "string") throw new Error("INVALID_BODY");
          seen = JSON.parse(init!.body);
          mutable[0]!.content = "mutated";
          return new Response("{}", { status: 202 });
        }
        return Response.json(result());
      }
    });
    expect((await client.run({ files: mutable, check: "syntax" })).status).toBe("passed");
    expect(seen).toMatchObject({ files });
  });
  it("PAX archive preserves Unicode, long paths and empty files without links or mounts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "snapshot-test-"));
    try {
      const snapshot = [
        { path: "папка/" + "x".repeat(120) + ".js", content: "текст\r\n" },
        { path: "empty.js", content: "" }
      ];
      await writeFile(join(directory, "files.tar"), codeAgentSnapshotArchive(snapshot));
      const listing = execFileSync("tar", ["-tvf", join(directory, "files.tar")], {
        encoding: "utf8"
      });
      expect(listing).toContain("workspace/папка/");
      expect(listing).toContain("empty.js");
      expect(listing).not.toContain(" -> ");
      const content = execFileSync(
        "tar",
        ["-xOf", join(directory, "files.tar"), "workspace/" + snapshot[0]!.path],
        { encoding: "utf8" }
      );
      expect(content).toBe(snapshot[0]!.content);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("redacts credentials and terminal controls", () => {
    expect(
      redactCodeAgentOutput(
        "api_key=example ghp_abcdefghijk sk-abcdefghijklmnop \u001b[31mred\u0000"
      )
    ).toBe("api_key=[REDACTED] [REDACTED] [REDACTED] red");
  });
});
