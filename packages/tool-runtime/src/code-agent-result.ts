import { redactCodeAgentOutput } from "./code-agent-snapshot.js";
import type { CodeAgentWorkspaceResult } from "./code-agent-workspace.js";

/** Evidence is data, not authority: validate both transport and injected-runner results. */
export function validateCodeAgentCheckResult(
  value: unknown,
  expectedDigest: string
): CodeAgentWorkspaceResult {
  const invalid = () => new Error("INVALID_EXECUTOR_RESULT");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const result = value as Record<string, unknown>;
  if (
    !/^[a-f0-9]{64}$/.test(expectedDigest) ||
    result.snapshotDigest !== expectedDigest ||
    typeof result.status !== "string" ||
    !["passed", "failed", "cancelled", "timed_out", "unavailable"].includes(result.status) ||
    !(
      result.exitCode === null ||
      (typeof result.exitCode === "number" &&
        Number.isInteger(result.exitCode) &&
        result.exitCode >= 0 &&
        result.exitCode <= 255)
    ) ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    typeof result.truncated !== "boolean" ||
    (result.cleanupVerified !== undefined && typeof result.cleanupVerified !== "boolean") ||
    !Array.isArray(result.journal) ||
    result.journal.length > 32 ||
    Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 * 1024 ||
    (result.status === "passed" && (result.exitCode !== 0 || result.cleanupVerified !== true)) ||
    (result.status === "failed" && result.exitCode === 0 && result.truncated !== true)
  )
    throw invalid();
  const events = [
    "snapshot",
    "started",
    "output_limit",
    "timeout",
    "cancelled",
    "finished",
    "unavailable"
  ];
  const journal = (result.journal as unknown[]).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const item = value as Record<string, unknown>;
    if (
      typeof item.at !== "string" ||
      item.at.length > 40 ||
      !/^\d{4}-\d\d-\d\dT/.test(item.at) ||
      !Number.isFinite(Date.parse(item.at)) ||
      typeof item.event !== "string" ||
      !events.includes(item.event) ||
      typeof item.detail !== "string" ||
      item.detail.length > 4096
    )
      throw invalid();
    return {
      at: item.at,
      event: item.event as CodeAgentWorkspaceResult["journal"][number]["event"],
      detail: redactCodeAgentOutput(item.detail)
    };
  });
  return {
    status: result.status as CodeAgentWorkspaceResult["status"],
    snapshotDigest: expectedDigest,
    exitCode: result.exitCode,
    stdout: redactCodeAgentOutput(result.stdout),
    stderr: redactCodeAgentOutput(result.stderr),
    truncated: result.truncated,
    ...(typeof result.cleanupVerified === "boolean"
      ? { cleanupVerified: result.cleanupVerified }
      : {}),
    journal
  };
}

/** Old durable rows also need current proof requirements before reuse/publication. */
export function isVerifiedCodeAgentCheck(value: unknown, expectedDigest: string): boolean {
  try {
    return validateCodeAgentCheckResult(value, expectedDigest).status === "passed";
  } catch {
    return false;
  }
}
