import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DRIVE_FILE_SCOPE } from "../src/cloud-storage/google-drive.js";
import {
  GoogleDriveAuthorization,
  type DriveGrant
} from "../src/cloud-storage/google-drive-authorization.js";
import { DriveGrantCipher } from "../src/cloud-storage/google-drive-grant-cipher.js";

const config = {
  clientId: "fixture.apps.googleusercontent.com",
  clientSecret: "client-secret-fixture",
  redirectUri: "https://kosmora.example/api/v1/storage/drive/callback"
};
const reply = (override: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
      expires_in: 3600,
      token_type: "Bearer",
      scope: DRIVE_FILE_SCOPE,
      ...override
    })
  );
const flow = (auth: GoogleDriveAuthorization) => {
  const { authorizationUrl } = auth.begin("owner-a", "session-a");
  return {
    ownerId: "owner-a",
    sessionId: "session-a",
    state: new URL(authorizationUrl).searchParams.get("state")!,
    code: "code-fixture"
  };
};

describe("separate Drive authorization", () => {
  it("requests only drive.file with PKCE and exchanges a code once", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply());
    const auth = new GoogleDriveAuthorization(config, request, () => 1000);
    const start = auth.begin("owner-a", "session-a");
    const url = new URL(start.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.expiresAt).toBe(601000);
    const input = {
      ownerId: "owner-a",
      sessionId: "session-a",
      state: url.searchParams.get("state")!,
      code: "code"
    };
    expect(await auth.finish(input)).toMatchObject({
      refreshToken: "fixture-refresh",
      expiresAt: 3601000
    });
    const init = request.mock.calls[0]![1]!;
    const fields = init.body as URLSearchParams;
    expect(createHash("sha256").update(fields.get("code_verifier")!).digest("base64url")).toBe(
      url.searchParams.get("code_challenge")
    );
    expect(init.redirect).toBe("error");
    await expect(auth.finish(input)).rejects.toMatchObject({ code: "DRIVE_AUTH_FAILED" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(auth)).not.toContain("secret");
  });

  it.each(["owner", "session", "state", "expired", "clock-backwards"])(
    "rejects %s before contacting Google",
    async (change) => {
      let now = 1000;
      const request = vi.fn<typeof fetch>();
      const auth = new GoogleDriveAuthorization(config, request, () => now);
      const input = flow(auth);
      if (change === "owner") input.ownerId = "owner-b";
      if (change === "session") input.sessionId = "session-b";
      if (change === "state") input.state = "x".repeat(43);
      if (change === "expired") now += 600000;
      if (change === "clock-backwards") now--;
      await expect(auth.finish(input)).rejects.toMatchObject({ code: "DRIVE_AUTH_FAILED" });
      expect(request).not.toHaveBeenCalled();
    }
  );

  it("invalidates the previous flow when connection is restarted", async () => {
    const request = vi.fn<typeof fetch>();
    const auth = new GoogleDriveAuthorization(config, request);
    const input = flow(auth);
    auth.begin("owner-a", "session-a");
    await expect(auth.finish(input)).rejects.toMatchObject({ code: "DRIVE_AUTH_FAILED" });
    expect(request).not.toHaveBeenCalled();
  });

  it("consumes a code after a network failure and never leaks the provider error", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("provider response client-secret-fixture"));
    const auth = new GoogleDriveAuthorization(config, request);
    const input = flow(auth);
    await expect(auth.finish(input)).rejects.toMatchObject({
      message: "DRIVE_TOKEN_EXCHANGE_FAILED"
    });
    await expect(auth.finish(input)).rejects.toMatchObject({ code: "DRIVE_AUTH_FAILED" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { scope: "https://www.googleapis.com/auth/drive" },
    { scope: undefined },
    { refresh_token: undefined },
    { expires_in: -1 },
    { token_type: "Other" },
    { access_token: "token\r\nInjected: yes" }
  ])("rejects insufficient or wider grants (%j)", async (override) => {
    const auth = new GoogleDriveAuthorization(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(reply(override))
    );
    await expect(auth.finish(flow(auth))).rejects.toMatchObject({
      code: "DRIVE_AUTH_INVALID_GRANT"
    });
  });

  it("preserves a refresh token only when refreshing an already narrow grant", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply({ refresh_token: undefined, scope: undefined }));
    const auth = new GoogleDriveAuthorization(config, request, () => 1000);
    expect(
      await auth.refresh({
        accessToken: "old",
        refreshToken: "previous",
        scope: DRIVE_FILE_SCOPE,
        expiresAt: 1
      })
    ).toMatchObject({
      accessToken: "fixture-access",
      refreshToken: "previous",
      expiresAt: 3601000
    });
  });

  it.each([
    "http://kosmora.example/callback",
    "https://user:pass@kosmora.example/callback",
    "https://kosmora.example/callback?redirect=other"
  ])("fails closed for invalid callback %s", (redirectUri) => {
    expect(() => new GoogleDriveAuthorization({ ...config, redirectUri })).toThrow(
      "DRIVE_OAUTH_CONFIGURATION_REQUIRED"
    );
  });
});

describe("owner-bound Drive token encryption", () => {
  const grant: DriveGrant = {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    expiresAt: 12345678,
    scope: DRIVE_FILE_SCOPE
  };
  it("round-trips across instances without plaintext tokens or a repeated nonce", () => {
    const key = new Uint8Array(32).fill(7);
    const a = new DriveGrantCipher(key),
      b = new DriveGrantCipher(key);
    key.fill(0); // Key copied at construction.
    const first = a.seal("owner-a", grant);
    expect(b.open("owner-a", first)).toEqual(grant);
    expect(first).not.toContain("secret");
    expect(a.seal("owner-a", grant)).not.toBe(first);
    expect(JSON.stringify(a)).toBe("{}");
    expect(() => a.open("owner-b", first)).toThrow("DRIVE_GRANT_UNREADABLE");
    expect(() => new DriveGrantCipher(key).open("owner-a", first)).toThrow(
      "DRIVE_GRANT_UNREADABLE"
    );
  });
  it("refuses tampered, noncanonical and oversized envelopes", () => {
    const cipher = new DriveGrantCipher(new Uint8Array(32));
    const sealed = cipher.seal("owner-a", grant);
    const parts = sealed.split(".");
    parts[2] = (parts[2]![0] === "A" ? "B" : "A") + parts[2]!.slice(1);
    for (const value of [parts.join("."), sealed + ".extra", sealed + "=", "x".repeat(24001)])
      expect(() => cipher.open("owner-a", value)).toThrow("DRIVE_GRANT_UNREADABLE");
    expect(() => new DriveGrantCipher(new Uint8Array(31))).toThrow(
      "DRIVE_KEY_CONFIGURATION_REQUIRED"
    );
  });
});
