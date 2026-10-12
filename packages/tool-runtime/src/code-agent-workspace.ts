import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { codeAgentSnapshotArchive, redactCodeAgentOutput } from "./code-agent-snapshot.js";

export interface CodeAgentWorkspaceFile {
  path: string;
  content: string;
}

export type CodeAgentCheck = "node-test" | "syntax";
export interface CodeAgentWorkspaceJournalEntry {
  at: string;
  event:
    "snapshot" | "started" | "output_limit" | "timeout" | "cancelled" | "finished" | "unavailable";
  detail: string;
}
export interface CodeAgentWorkspaceResult {
  status: "passed" | "failed" | "timed_out" | "cancelled" | "unavailable";
  snapshotDigest: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  journal: CodeAgentWorkspaceJournalEntry[];
  cleanupVerified?: boolean;
}
export type CodeAgentCheckResult = CodeAgentWorkspaceResult;
export interface CodeAgentWorkspaceRunInput {
  files: readonly CodeAgentWorkspaceFile[];
  check: CodeAgentCheck;
  expectedDigest?: string;
  signal?: AbortSignal;
}
export interface CodeAgentWorkspaceRunnerOptions {
  /** Operator-only configuration. Never accept this object from a tool-call/request body. */
  runtime: "docker" | "podman";
  /** Locally provisioned, immutable OCI image ID/digest. Pulling an image is never automatic. */
  image: string;
  executable?: string;
  limits?: {
    timeoutMs?: number;
    outputBytes?: number;
    memoryMb?: number;
    pids?: number;
    cpus?: number;
  };
}
export interface CodeAgentWorkspaceRunner {
  run(input: CodeAgentWorkspaceRunInput): Promise<CodeAgentWorkspaceResult>;
}

const MAX_FILES = 2_000;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;

function validatedFiles(files: readonly CodeAgentWorkspaceFile[]): CodeAgentWorkspaceFile[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new Error("CODE_AGENT_SNAPSHOT_FILE_LIMIT");
  }
  let bytes = 0;
  const paths = new Set<string>();
  const result = files
    .map((file: CodeAgentWorkspaceFile) => {
      if (
        !file ||
        typeof file.path !== "string" ||
        typeof file.content !== "string" ||
        file.path.length > 512 ||
        file.path.startsWith("/") ||
        file.path.includes("\\") ||
        [...file.path].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === ":"
        ) ||
        file.path
          .split("/")
          .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
      )
        throw new Error("CODE_AGENT_UNSAFE_PATH");
      const pathKey = file.path.normalize("NFKC").toLowerCase();
      if (paths.has(pathKey)) throw new Error("CODE_AGENT_DUPLICATE_PATH");
      paths.add(pathKey);
      const length = Buffer.byteLength(file.content, "utf8");
      bytes += length;
      if (length > MAX_FILE_BYTES || bytes > MAX_BYTES)
        throw new Error("CODE_AGENT_SNAPSHOT_BYTE_LIMIT");
      // Copy values before asynchronous work; callers cannot change the approved snapshot in flight.
      return { path: file.path, content: file.content };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of result) {
    const parts = file.path.normalize("NFKC").toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join("/"))) throw new Error("CODE_AGENT_PATH_CONFLICT");
    }
  }
  return result;
}

function digestFiles(files: readonly CodeAgentWorkspaceFile[]): string {
  const hash = createHash("sha256").update("kosmora-code-agent-snapshot-v1\0");
  for (const file of files) {
    const path = Buffer.from(file.path, "utf8");
    const content = Buffer.from(file.content, "utf8");
    hash.update(`${path.length}:`).update(path).update(`${content.length}:`).update(content);
  }
  return hash.digest("hex");
}

export function computeCodeAgentSnapshotDigest(files: readonly CodeAgentWorkspaceFile[]): string {
  return digestFiles(validatedFiles(files));
}

// This program belongs to the operator, not the model. Neither npm lifecycle scripts nor
// command strings from repository files are executed. Tests themselves execute only inside OCI.
const CHECK_PROGRAM = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mode = process.argv[1];
const files = [];
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, item.name);
    if (item.isDirectory()) walk(name);
    else if (item.isFile()) files.push(name);
  }
}
walk('/workspace');
const selected = files.filter(name => mode === 'syntax'
  ? /\.(?:[cm]?js|ts)$/.test(name)
  : /(?:^|\/)(?:[^/]+\.(?:test|spec)|test[^/]*)\.(?:[cm]?js|ts)$/.test(name)).sort();
if (!selected.length) { console.error('NO_SUPPORTED_CHECK_FILES'); process.exit(2); }
if (mode === 'node-test') {
  const result = spawnSync(process.execPath, ['--test-concurrency=1', '--test', ...selected], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}
for (const file of selected) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}
console.log('SYNTAX_CHECK_PASSED ' + selected.length);
`;

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isFinite(n) || n < min || n > max) throw new Error("CODE_AGENT_INVALID_LIMIT");
  return n;
}

function boundedUtf8(chunks: readonly Buffer[]): string {
  const bytes = Buffer.concat(chunks);
  let count = 0;
  const chars: string[] = [];
  // Invalid UTF-8 expands into replacement characters. Keep even this expanded string
  // within the original byte budget rather than accidentally returning three times the cap.
  for (const char of bytes.toString("utf8")) {
    const length = Buffer.byteLength(char);
    if (count + length > bytes.length) break;
    chars.push(char);
    count += length;
  }
  return chars.join("");
}

export function createCodeAgentWorkspaceRunner(
  options: CodeAgentWorkspaceRunnerOptions
): CodeAgentWorkspaceRunner {
  if (options.runtime !== "docker" && options.runtime !== "podman")
    throw new Error("CODE_AGENT_UNSUPPORTED_SANDBOX");
  if (!/^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/u.test(options.image)) {
    throw new Error("CODE_AGENT_IMMUTABLE_IMAGE_REQUIRED");
  }
  if (
    options.executable !== undefined &&
    (!isAbsolute(options.executable) ||
      [...options.executable].some((char) => char.charCodeAt(0) < 32))
  ) {
    throw new Error("CODE_AGENT_INVALID_EXECUTABLE");
  }
  const executable =
    options.executable ?? (options.runtime === "docker" ? "/usr/bin/docker" : "/usr/bin/podman");
  const image = options.image;
  const timeoutMs = bounded(options.limits?.timeoutMs, 30_000, 50, 120_000);
  const outputBytes = bounded(options.limits?.outputBytes, 128 * 1024, 256, 1024 * 1024);
  const memoryMb = bounded(options.limits?.memoryMb, 256, 64, 1024);
  const pids = bounded(options.limits?.pids, 64, 8, 128);
  const cpus = bounded(options.limits?.cpus, 1, 0.1, 2);
  // A failed cleanup requires operator reconciliation. Do not accumulate additional
  // potentially live containers by automatically trying another check on this runner.
  let quarantined = false;

  return {
    async run(input) {
      const files = validatedFiles(input.files);
      if (input.check !== "node-test" && input.check !== "syntax")
        throw new Error("CODE_AGENT_UNSUPPORTED_CHECK");
      const snapshotDigest = digestFiles(files);
      if (input.expectedDigest !== undefined && input.expectedDigest !== snapshotDigest) {
        throw new Error("CODE_AGENT_SNAPSHOT_CHANGED");
      }
      const journal: CodeAgentWorkspaceJournalEntry[] = [];
      const log = (event: CodeAgentWorkspaceJournalEntry["event"], detail: string) => {
        journal.push({ at: new Date().toISOString(), event, detail });
      };
      log("snapshot", snapshotDigest);
      const quarantinedResult = (): CodeAgentWorkspaceResult => {
        log("unavailable", "runner_quarantined_after_unverified_cleanup");
        return {
          status: "unavailable",
          snapshotDigest,
          exitCode: null,
          stdout: "",
          stderr: "",
          truncated: false,
          journal,
          cleanupVerified: false
        };
      };
      if (quarantined) return quarantinedResult();
      const cancelledResult = (): CodeAgentWorkspaceResult => ({
        status: "cancelled",
        snapshotDigest,
        exitCode: null,
        stdout: "",
        stderr: "",
        truncated: false,
        journal
      });
      if (input.signal?.aborted) {
        log("cancelled", "before_start");
        return cancelledResult();
      }
      const jobId = randomUUID();
      const name = `kosmora-check-${jobId}`;
      const loaderName = `kosmora-load-${jobId}`;
      const volumeName = `kosmora-snapshot-${jobId}`;
      const jobLabel = `kosmora.code-job=${jobId}`;
      const commonArgs = [
        "create",
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        `--pids-limit=${pids}`,
        `--memory=${memoryMb}m`,
        `--memory-swap=${memoryMb}m`,
        `--cpus=${cpus}`,
        "--ipc=none",
        "--log-driver=none",
        "--restart=no",
        "--ulimit=nofile=128:128",
        "--ulimit=fsize=16777216:16777216",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
        "--label=kosmora.code-executor=true",
        `--label=${jobLabel}`,
        "--env=HOME=/tmp",
        "--env=NODE_OPTIONS="
      ];
      // Populate a daemon-managed volume with a trusted tar command, never repository code.
      // The actual check receives the same snapshot as a read-only mount. docker cp into a
      // read-only rootfs is unsupported, and writable tmpfs plus chmod is not immutable.
      const loaderArgs = [
        ...commonArgs,
        "--name",
        loaderName,
        "--user=0:0",
        "--interactive",
        "--workdir=/snapshot",
        `--mount=type=volume,src=${volumeName},dst=/snapshot,volume-nocopy`,
        "--entrypoint=tar",
        image,
        "--extract",
        "--file=-",
        "--directory=/snapshot",
        "--no-same-owner"
      ];
      const args = [
        ...commonArgs,
        "--name",
        name,
        "--user=65534:65534",
        "--workdir=/snapshot/workspace",
        `--mount=type=volume,src=${volumeName},dst=/snapshot,readonly,volume-nocopy`,
        "--entrypoint=node",
        image,
        "--max-old-space-size=128",
        "-e",
        CHECK_PROGRAM.replaceAll("/workspace", "/snapshot/workspace"),
        input.check
      ];
      log("started", `${input.check}:oci:no-network:non-root:read-only`);
      return await new Promise<CodeAgentWorkspaceResult>((resolve) => {
        // Inherit no credentials, proxy settings, NODE_OPTIONS, or Docker remote endpoint.
        const environment = {
          PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          HOME: "/nonexistent"
        };
        let child: ReturnType<typeof spawn> | undefined;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let retained = 0;
        let truncated = false;
        let stopped: "cancelled" | "timed_out" | "failed" | undefined;
        let settled = false;
        let termination: Promise<boolean> | undefined;
        const cleanupCommand = (cleanupArgs: string[]) =>
          new Promise<{ ok: boolean; output: string }>((done) => {
            const removal = spawn(executable, cleanupArgs, {
              shell: false,
              stdio: ["ignore", "pipe", "ignore"],
              env: environment
            });
            let output = "";
            let overflow = false;
            removal.stdout.on("data", (chunk: Buffer) => {
              if (output.length + chunk.length > 4096) overflow = true;
              else output += chunk.toString("utf8");
            });
            const timer = setTimeout(() => {
              removal.kill("SIGKILL");
              done({ ok: false, output: "" });
            }, 2_000);
            const finish = (success: boolean) => {
              clearTimeout(timer);
              done({ ok: success && !overflow, output: output.trim() });
            };
            removal.once("error", () => finish(false));
            removal.once("close", (code) => finish(code === 0));
          });
        const removeResources = async () => {
          // rm may report a missing resource after cancellation during create. Prove absence
          // using successful daemon queries, rather than treating an error as successful cleanup.
          await cleanupCommand(["rm", "--force", name, loaderName]);
          const containers = await cleanupCommand(["ps", "-aq", "--filter", `label=${jobLabel}`]);
          if (!containers.ok || containers.output) return false;
          await cleanupCommand(["volume", "rm", volumeName]);
          const volumes = await cleanupCommand([
            "volume",
            "ls",
            "--filter",
            `label=${jobLabel}`,
            "--format",
            "{{.Name}}"
          ]);
          return volumes.ok && !volumes.output;
        };
        const kill = (status: "cancelled" | "timed_out" | "failed") => {
          if (stopped || settled) return;
          stopped = status;
          // Create and start are separate. An uncertain create response can leave only a
          // stopped container; it can never launch repository code after cancellation.
          // Explicit daemon removal also stops descendants even after the CLI is killed.
          termination = removeResources();
          if (child?.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };
        const collect = (output: Buffer[], chunk: Buffer) => {
          const remaining = Math.max(0, outputBytes - retained);
          if (remaining) {
            output.push(chunk.subarray(0, remaining));
            retained += Math.min(chunk.length, remaining);
          }
          if (chunk.length > remaining && !truncated) {
            truncated = true;
            log("output_limit", String(outputBytes));
            kill("failed");
          }
        };
        const cancel = () => {
          log("cancelled", "requested");
          kill("cancelled");
        };
        input.signal?.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(() => {
          log("timeout", String(timeoutMs));
          kill("timed_out");
        }, timeoutMs);
        if (input.signal?.aborted) cancel();
        const finish = async (exitCode: number | null, unavailable: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          input.signal?.removeEventListener("abort", cancel);
          await termination;
          // Normal completion also removes the stopped container. Never retain a snapshot
          // mount after this request, and retry removal after an interrupted create/start.
          const cleanupVerified = await removeResources();
          if (!cleanupVerified) {
            quarantined = true;
            log("unavailable", "container_cleanup_unverified");
          }
          const status = !cleanupVerified
            ? "unavailable"
            : (stopped ??
              (unavailable || exitCode === 125 || exitCode === 126 || exitCode === 127
                ? "unavailable"
                : exitCode === 0
                  ? "passed"
                  : "failed"));
          log(
            status === "unavailable" ? "unavailable" : "finished",
            `${status}:${exitCode ?? "none"}`
          );
          const safeStdout = boundedUtf8([
            Buffer.from(redactCodeAgentOutput(boundedUtf8(stdout))).subarray(0, outputBytes)
          ]);
          const safeStderr = boundedUtf8([
            Buffer.from(redactCodeAgentOutput(boundedUtf8(stderr))).subarray(
              0,
              outputBytes - Buffer.byteLength(safeStdout)
            )
          ]);
          resolve({
            status,
            snapshotDigest,
            exitCode,
            stdout: safeStdout,
            stderr: safeStderr,
            truncated,
            journal,
            cleanupVerified
          });
        };
        type Stage = "volume" | "loader-create" | "load" | "create" | "start";
        const launch = (arguments_: string[], stage: Stage) => {
          child = spawn(executable, arguments_, {
            shell: false,
            detached: true,
            stdio: [stage === "load" ? "pipe" : "ignore", "pipe", "pipe"],
            env: environment
          });
          child.stdout!.on("data", (chunk: Buffer) => {
            if (stage === "start") collect(stdout, chunk);
          });
          child.stderr!.on("data", (chunk: Buffer) => collect(stderr, chunk));
          child.once("error", () => {
            void finish(null, true);
          });
          child.once("close", (code) => {
            if (code === 0 && !stopped && stage === "volume") launch(loaderArgs, "loader-create");
            else if (code === 0 && !stopped && stage === "loader-create")
              launch(["start", "--attach", "--interactive", loaderName], "load");
            else if (code === 0 && !stopped && stage === "load") launch(args, "create");
            else if (code === 0 && !stopped && stage === "create")
              launch(["start", "--attach", name], "start");
            else void finish(code, stage !== "start");
          });
          if (stage === "load") {
            child.stdin!.on("error", () => {
              /* close/error determines cleanup */
            });
            child.stdin!.end(codeAgentSnapshotArchive(files));
          }
        };
        if (!stopped)
          launch(
            [
              "volume",
              "create",
              "--driver=local",
              "--label=kosmora.code-executor=true",
              `--label=${jobLabel}`,
              volumeName
            ],
            "volume"
          );
        else void finish(null, false);
      });
    }
  };
}
