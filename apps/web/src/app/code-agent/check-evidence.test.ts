import { describe, expect, it } from "vitest";
import { hasVerifiedCodeCheck } from "./check-evidence";
describe("Coscode check display eligibility", () => {
  it("requires a real zero exit and confirmed cleanup", () => {
    expect(hasVerifiedCodeCheck({ status: "passed", exitCode: 0, cleanupVerified: true })).toBe(
      true
    );
    for (const proof of [
      undefined,
      { status: "passed" },
      { status: "passed", exitCode: 1, cleanupVerified: true },
      { status: "passed", exitCode: 0, cleanupVerified: false },
      { status: "failed", exitCode: 1, cleanupVerified: true },
      { status: "cancelled", exitCode: 0, cleanupVerified: true }
    ])
      expect(hasVerifiedCodeCheck(proof)).toBe(false);
  });
});
