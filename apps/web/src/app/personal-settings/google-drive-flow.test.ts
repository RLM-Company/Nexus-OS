import { describe, expect, it } from "vitest";
import { consumeDriveFlow, DRIVE_PROOF_KEY, rememberDriveFlow } from "./google-drive-flow";
const state = "s".repeat(43),
  proof = "p".repeat(43);
const start = {
  state,
  proof,
  authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  expires_at: 123
};
function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    }
  };
}
describe("Drive proof in originating tab", () => {
  it("keeps only the browser proof and consumes it once", () => {
    const tab = storage();
    expect(rememberDriveFlow(tab, start)).toBe(start.authorization_url);
    expect(consumeDriveFlow(tab, `#drive_state=${state}&drive_code=code`)).toEqual({
      state,
      proof,
      code: "code"
    });
    expect(tab.getItem(DRIVE_PROOF_KEY)).toBeNull();
    expect(() => consumeDriveFlow(tab, `#drive_state=${state}&drive_code=code`)).toThrow();
  });
  it("rejects a copied link in another tab and unexpected redirect targets", () => {
    expect(() => consumeDriveFlow(storage(), `#drive_state=${state}&drive_code=code`)).toThrow();
    expect(() =>
      rememberDriveFlow(storage(), {
        ...start,
        authorization_url: `https://evil.example/?state=${state}`
      })
    ).toThrow();
  });
  it("validates denial and leaves unrelated navigation alone", () => {
    const tab = storage();
    rememberDriveFlow(tab, start);
    expect(consumeDriveFlow(tab, "#account-data")).toBeNull();
    expect(tab.getItem(DRIVE_PROOF_KEY)).not.toBeNull();
    expect(consumeDriveFlow(tab, `#drive_state=${state}&drive_error=denied`)).toEqual({
      state,
      proof,
      denied: true
    });
  });
  it("rejects state mismatch and duplicate callback parameters", () => {
    for (const fragment of [
      `#drive_state=${"x".repeat(43)}&drive_code=code`,
      `#drive_state=${state}&drive_code=a&drive_code=b`
    ]) {
      const tab = storage();
      rememberDriveFlow(tab, start);
      expect(() => consumeDriveFlow(tab, fragment)).toThrow();
      expect(tab.getItem(DRIVE_PROOF_KEY)).toBeNull();
    }
  });
});
