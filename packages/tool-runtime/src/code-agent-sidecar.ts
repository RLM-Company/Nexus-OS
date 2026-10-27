import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import {
  computeCodeAgentSnapshotDigest,
  type CodeAgentWorkspaceRunner,
  type CodeAgentWorkspaceResult
} from "./code-agent-workspace.js";
import { redactCodeAgentOutput } from "./code-agent-snapshot.js";

const MAX_BODY = 3_200_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
async function readJson(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const raw of request) {
    const chunk = raw as Buffer;
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new Error("BODY_LIMIT");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Private listener. Authentication precedes parsing; no arbitrary paths, commands or config. */
export function createCodeAgentExecutorServer(options: {
  token: string;
  runner: CodeAgentWorkspaceRunner;
}) {
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(options.token)) throw new Error("EXECUTOR_TOKEN_REQUIRED");
  type Job = {
    digest: string;
    check: string;
    controller: AbortController;
    done: Promise<void>;
    result?: CodeAgentWorkspaceResult;
    at: number;
  };
  const jobs = new Map<string, Job>();
  let closing = false;
  const server = createServer((request, response) => {
    const send = (code: number, body: unknown) => {
      response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const auth = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      send(401, { error: "UNAUTHORIZED" });
      request.resume();
      return;
    }
    void (async () => {
      const match = /^\/v1\/jobs\/([a-f0-9-]+)$/u.exec(request.url ?? "");
      const id = match?.[1];
      if (!id || !UUID.test(id)) {
        send(404, { error: "NOT_FOUND" });
        request.resume();
        return;
      }
      if (request.method === "PUT") {
        if (closing) {
          send(503, { error: "UNAVAILABLE" });
          return;
        }
        const input = (await readJson(request)) as Record<string, unknown>;
        if (
          !input ||
          Object.keys(input).sort().join(",") !== "check,expectedDigest,files" ||
          !["syntax", "node-test"].includes(String(input.check)) ||
          typeof input.expectedDigest !== "string"
        )
          throw new Error("INVALID_JOB");
        const files = input.files as Array<{ path: string; content: string }>;
        if (
          !Array.isArray(files) ||
          files.some((f) => !f || Object.keys(f).sort().join(",") !== "content,path")
        )
          throw new Error("INVALID_JOB");
        const digest = computeCodeAgentSnapshotDigest(files);
        if (digest !== input.expectedDigest) throw new Error("SNAPSHOT_CHANGED");
        const old = jobs.get(id);
        if (old) {
          send(old.digest === digest && old.check === input.check ? 200 : 409, {
            accepted: old.digest === digest && old.check === input.check
          });
          return;
        }
        for (const [key, job] of jobs)
          if (job.result && Date.now() - job.at > 600_000) jobs.delete(key);
        if (jobs.size >= 64 || [...jobs.values()].filter((j) => !j.result).length >= 2) {
          send(429, { error: "BUSY" });
          return;
        }
        const controller = new AbortController();
        const job: Job = {
          digest,
          check: String(input.check),
          controller,
          done: Promise.resolve(),
          at: Date.now()
        };
        jobs.set(id, job);
        job.done = Promise.resolve()
          .then(() =>
            options.runner.run({
              files,
              check: input.check as "syntax" | "node-test",
              expectedDigest: digest,
              signal: controller.signal
            })
          )
          .then((result) => {
            job.result = {
              ...result,
              stdout: redactCodeAgentOutput(result.stdout),
              stderr: redactCodeAgentOutput(result.stderr)
            };
          })
          .catch(() => {
            job.result = {
              status: "unavailable",
              snapshotDigest: digest,
              exitCode: null,
              stdout: "",
              stderr: "EXECUTOR_FAILED",
              truncated: false,
              cleanupVerified: false,
              journal: []
            };
          })
          .finally(() => {
            job.at = Date.now();
          });
        send(202, { accepted: true });
        return;
      }
      const job = jobs.get(id);
      if (!job) {
        send(404, { error: "NOT_FOUND" });
        return;
      }
      if (request.method === "DELETE") {
        job.controller.abort();
        await job.done;
        send(200, job.result);
        return;
      }
      if (request.method === "GET") {
        send(job.result ? 200 : 202, job.result ?? { running: true });
        return;
      }
      send(405, { error: "METHOD_NOT_ALLOWED" });
    })().catch(() => {
      if (!response.headersSent) send(400, { error: "INVALID_JOB" });
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.maxConnections = 32;
  return {
    server,
    async stop() {
      closing = true;
      for (const job of jobs.values()) job.controller.abort();
      await Promise.all([...jobs.values()].map((j) => j.done));
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
    }
  };
}
