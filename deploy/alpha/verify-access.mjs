import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

class AccessCheckError extends Error {}
const requireState = (condition, message) => {
  if (!condition) throw new AccessCheckError(message);
};

export async function verifyAccess({ origin, password, now = Date.now(), authMode = "basic" }) {
  const base = new URL(origin);
  requireState(
    base.username === "" &&
      base.password === "" &&
      base.pathname === "/" &&
      base.search === "" &&
      base.hash === "" &&
      (base.protocol === "https:" ||
        (base.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(base.hostname))),
    "Use an HTTPS origin without credentials, paths or query parameters"
  );
  requireState(typeof password === "string" && password.length > 0, "Owner password is missing");
  let authHeaders = {
    authorization: `Basic ${Buffer.from(`owner:${password}`).toString("base64")}`
  };
  const request = async (path, authenticated, expectedStatus) => {
    let response;
    try {
      response = await fetch(new URL(path, base), {
        method: "GET",
        headers: authenticated ? authHeaders : {},
        redirect: expectedStatus === 303 ? "manual" : "error",
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new AccessCheckError("HTTPS request failed or attempted a redirect");
    }
    if (response.status !== expectedStatus) {
      await response.body?.cancel();
      throw new AccessCheckError(
        authenticated ? "Authenticated access failed" : "Owner password protection failed"
      );
    }
    return response;
  };
  const json = async (path) => {
    const response = await request(path, true, 200);
    try {
      return await response.json();
    } catch {
      throw new AccessCheckError("API response was not valid JSON");
    }
  };
  if (authMode === "form") {
    const root = await request("/", false, 303);
    requireState(root.headers.get("location") === "/login", "Login redirect is missing");
    await root.body?.cancel();
    await (await request("/login", false, 200)).body?.cancel();
    await (await request("/api/v1/health", false, 401)).body?.cancel();
    let login;
    try {
      login = await fetch(new URL("/__owner/login", base), {
        method: "POST",
        redirect: "manual",
        headers: { origin: base.origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "owner", password }),
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new AccessCheckError("Owner form login failed");
    }
    const cookie = login.headers.get("set-cookie");
    requireState(
      login.status === 303 &&
        login.headers.get("location") === "/" &&
        /^__Host-cosmora-owner=[a-f0-9]{64};/.test(cookie ?? "") &&
        /; Secure; HttpOnly; SameSite=Strict;/.test(cookie),
      "Owner form login failed"
    );
    await login.body?.cancel();
    authHeaders = { cookie: cookie.split(";")[0] };
  } else {
    requireState(authMode === "basic", "Unknown authentication mode");
    for (const path of ["/", "/api/v1/health"]) {
      await (await request(path, false, 401)).body?.cancel();
    }
  }
  await (await request("/", true, 200)).body?.cancel();
  const health = await json("/api/v1/health");
  requireState(health?.status === "ok" && health.database === "ok", "SQLite is not healthy");
  const sessions = await json("/api/v1/identity/sessions");
  const current = Array.isArray(sessions?.items)
    ? sessions.items.filter((session) => session?.current === true)
    : [];
  requireState(
    current.length === 1 &&
      current[0].status === "active" &&
      current[0].actor_kind === "owner" &&
      current[0].owner_id === "hosted-alpha-owner" &&
      current[0].actor_id === "hosted-alpha-owner",
    "Current hosted owner session is unavailable"
  );
  const expiresAt = Date.parse(current[0].expires_at);
  requireState(Number.isFinite(expiresAt) && expiresAt > now, "Owner session has expired");
  requireState(expiresAt - now > 24 * 60 * 60 * 1_000, "Rotate the owner session within 24 hours");
  const operations = await json("/api/v1/operations/status");
  requireState(
    operations &&
      (operations.process_stop === null || typeof operations.process_stop?.active === "boolean"),
    "Model execution status is unavailable"
  );
  return {
    session_expires_at: new Date(expiresAt).toISOString(),
    model_requests_paused: operations.process_stop?.active === true
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const origin = process.env.COSMORA_ACCESS_ORIGIN;
    requireState(origin?.startsWith("https://"), "COSMORA_ACCESS_ORIGIN must use HTTPS");
    const password = readFileSync("/run/cosmora/owner-password", "utf8").replace(/\r?\n$/u, "");
    const result = await verifyAccess({ origin, password, authMode: "form" });
    process.stdout.write(
      `Owner access PASS; SQLite healthy; session expires ${result.session_expires_at}; ` +
        `model requests ${result.model_requests_paused ? "paused" : "not globally paused"}. ` +
        "No model request was sent.\n"
    );
  } catch (error) {
    process.stderr.write(
      `Owner access FAIL: ${error instanceof AccessCheckError ? error.message : "Unable to read configuration or complete verification"}.\n`
    );
    process.exitCode = 1;
  }
}
