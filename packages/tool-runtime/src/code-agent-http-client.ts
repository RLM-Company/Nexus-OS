import { randomUUID } from "node:crypto";
import {
  computeCodeAgentSnapshotDigest,
  type CodeAgentWorkspaceRunner,
  type CodeAgentWorkspaceResult
} from "./code-agent-workspace.js";
import { redactCodeAgentOutput } from "./code-agent-snapshot.js";

/** Fixed operator origin only. Never follow redirects or accept a job-supplied URL. */
export function createCodeAgentHttpExecutor(options: {
  url: string;
  token: string;
  fetchImplementation?: typeof fetch;
  pollMs?: number;
}): CodeAgentWorkspaceRunner {
  const origin = new URL(options.url);
  if (
    !/^https?:$/u.test(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    !/^[A-Za-z0-9_-]{32,256}$/u.test(options.token)
  )
    throw new Error("INVALID_EXECUTOR_CONFIGURATION");
  const request = options.fetchImplementation ?? fetch;
  const call = async (id: string, method: string, body?: unknown) => {
    const response = await request(new URL(`/v1/jobs/${id}`, origin), {
      method,
      redirect: "error",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8_000)
    });
    // Bound decoded results too, even from a compromised/misconfigured internal service.
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (!response.body) throw new Error("EMPTY_EXECUTOR_RESPONSE");
    const reader = response.body.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.length;
        if (bytes > 1_200_000) throw new Error("EXECUTOR_OUTPUT_LIMIT");
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return {
      code: response.status,
      data: JSON.parse(Buffer.concat(chunks).toString("utf8")) as CodeAgentWorkspaceResult
    };
  };
  return {
    async run(input) {
      // Copy once before await; the digest and HTTP body refer to precisely the same snapshot.
      const files = input.files.map((f) => ({ path: f.path, content: f.content }));
      const digest = computeCodeAgentSnapshotDigest(files);
      if (input.expectedDigest !== undefined && input.expectedDigest !== digest)
        throw new Error("CODE_AGENT_SNAPSHOT_CHANGED");
      const unavailable = (): CodeAgentWorkspaceResult => ({
        status: "unavailable",
        snapshotDigest: digest,
        exitCode: null,
        stdout: "",
        stderr: "CODE_AGENT_EXECUTOR_UNAVAILABLE",
        truncated: false,
        cleanupVerified: false,
        journal: [
          {
            at: new Date().toISOString(),
            event: "unavailable",
            detail: "transport_or_cleanup_unverified"
          }
        ]
      });
      if (input.signal?.aborted)
        return { ...unavailable(), status: "cancelled", cleanupVerified: true };
      const id = randomUUID();
      const validate = (value: CodeAgentWorkspaceResult) => {
        if (
          !value ||
          value.snapshotDigest !== digest ||
          !["passed", "failed", "cancelled", "timed_out", "unavailable"].includes(value.status) ||
          typeof value.stdout !== "string" ||
          typeof value.stderr !== "string" ||
          !Array.isArray(value.journal) ||
          value.journal.length > 32 ||
          Buffer.byteLength(value.stdout) + Buffer.byteLength(value.stderr) > 1024 * 1024 ||
          (value.status === "passed" && value.cleanupVerified !== true)
        )
          throw new Error("INVALID_EXECUTOR_RESULT");
        return {
          ...value,
          stdout: redactCodeAgentOutput(value.stdout),
          stderr: redactCodeAgentOutput(value.stderr)
        };
      };
      try {
        const created = await call(id, "PUT", {
          files,
          check: input.check,
          expectedDigest: digest
        });
        if (![200, 202].includes(created.code)) return unavailable();
        const deadline = Date.now() + 135_000;
        while (true) {
          if (input.signal?.aborted || Date.now() >= deadline) {
            const cancelled = await call(id, "DELETE");
            if (cancelled.code !== 200) return unavailable();
            const result = validate(cancelled.data);
            if (result.cleanupVerified !== true) return unavailable();
            return { ...result, status: input.signal?.aborted ? "cancelled" : "timed_out" };
          }
          const result = await call(id, "GET");
          if (result.code === 200) return validate(result.data);
          if (result.code !== 202) throw new Error("EXECUTOR_LOST_JOB");
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              input.signal?.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, options.pollMs ?? 200);
            input.signal?.addEventListener("abort", finish, { once: true });
            if (input.signal?.aborted) finish();
          });
        }
      } catch {
        // PUT/start may have reached sidecar. Cancellation uses the same job id; never resubmit.
        try {
          await call(id, "DELETE");
        } catch {
          /* sidecar retains bounded deadline */
        }
        return unavailable();
      }
    }
  };
}
