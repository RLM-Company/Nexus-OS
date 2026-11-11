import { describe, expect, it } from "vitest";
import {
  isVerifiedCodeAgentCheck,
  validateCodeAgentCheckResult
} from "../src/code-agent-result.js";
const digest = "a".repeat(64);
const result = {
  status: "passed",
  snapshotDigest: digest,
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  truncated: false,
  cleanupVerified: true,
  journal: []
};
describe("Code check evidence", () => {
  it("requires exit zero and verified cleanup for success, including old durable rows", () => {
    expect(isVerifiedCodeAgentCheck(result, digest)).toBe(true);
    for (const patch of [
      { status: ["passed"] },
      { exitCode: 1 },
      { exitCode: null },
      { exitCode: undefined },
      { cleanupVerified: false },
      { truncated: "false" },
      { exitCode: -1 },
      { exitCode: 256 },
      { exitCode: 0.5 },
      { snapshotDigest: "b".repeat(64) }
    ]) {
      expect(() => validateCodeAgentCheckResult({ ...result, ...patch }, digest)).toThrow(
        "INVALID_EXECUTOR_RESULT"
      );
      expect(isVerifiedCodeAgentCheck({ ...result, ...patch }, digest)).toBe(false);
    }
    expect(() => validateCodeAgentCheckResult({ ...result, status: "failed" }, digest)).toThrow();
  });
  it("preserves actual failure, timeout and cancellation evidence without granting success", () => {
    for (const status of ["failed", "timed_out", "cancelled", "unavailable"]) {
      const value = { ...result, status, exitCode: status === "failed" ? 1 : null };
      expect(validateCodeAgentCheckResult(value, digest)).toMatchObject(value);
      expect(isVerifiedCodeAgentCheck(value, digest)).toBe(false);
    }
    // Truncated diagnostics do not negate a real exit=0; the UI must announce truncation.
    expect(isVerifiedCodeAgentCheck({ ...result, truncated: true }, digest)).toBe(true);
  });
  it("redacts every stored diagnostic channel and drops unrecognized response fields", () => {
    const value = {
      ...result,
      stdout: "password=sample-value",
      stderr: "Bearer sample-value",
      private: "never persist",
      journal: [
        {
          at: "2026-11-10T00:00:00Z",
          event: "finished",
          detail: "secret=sample-value\u001b[31m",
          extra: "never persist"
        }
      ]
    };
    const checked = validateCodeAgentCheckResult(value, digest);
    expect(checked.stdout).toBe("password=[REDACTED]");
    expect(checked.stderr).toBe("Bearer [REDACTED]");
    expect(checked.journal[0]).toEqual({
      at: "2026-11-10T00:00:00Z",
      event: "finished",
      detail: "secret=[REDACTED]"
    });
    expect(checked).not.toHaveProperty("private");
  });
  it("rejects malformed, unbounded or invented journal entries", () => {
    for (const journal of [
      [null],
      [{ at: "bad", event: "finished", detail: "x" }],
      [{ at: "2026-11-10T00:00:00Z", event: "invented", detail: "x" }],
      [{ at: "2026-11-10T00:00:00Z", event: "finished", detail: "x".repeat(4097) }],
      Array(33).fill({ at: "2026-11-10T00:00:00Z", event: "finished", detail: "x" })
    ])
      expect(() => validateCodeAgentCheckResult({ ...result, journal }, digest)).toThrow();
  });
});
