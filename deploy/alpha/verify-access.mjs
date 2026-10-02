import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { pathToFileURL } from "node:url";

class AccessCheckError extends Error {}
const requireState = (condition, message) => {
  if (!condition) throw new AccessCheckError(message);
};

const DAY_MS = 24 * 60 * 60 * 1_000;

export function validateTlsCertificate(certificate, now = Date.now()) {
  const validFrom = Date.parse(certificate?.valid_from);
  const validTo = Date.parse(certificate?.valid_to);
  requireState(
    Number.isFinite(validFrom) && Number.isFinite(validTo),
    "TLS certificate dates are unavailable"
  );
  requireState(validFrom <= now, "TLS certificate is not yet valid");
  requireState(validTo > now, "TLS certificate has expired");
  requireState(validTo - now > DAY_MS, "TLS certificate expires within 24 hours");
  return { expires_at: new Date(validTo).toISOString() };
}

export async function inspectTlsCertificate(base, now = Date.now(), connect = tlsConnect) {
  const host =
    base.hostname.startsWith("[") && base.hostname.endsWith("]")
      ? base.hostname.slice(1, -1)
      : base.hostname;
  const port = base.port === "" ? 443 : Number(base.port);
  requireState(Number.isInteger(port) && port > 0 && port <= 65_535, "TLS port is invalid");
  return await new Promise((resolve, reject) => {
    const socket = connect({
      host,
      port,
      rejectUnauthorized: true,
      servername: isIP(host) === 0 ? host : undefined,
      timeout: 5_000
    });
    socket.once("secureConnect", () => {
      try {
        const certificate = socket.getPeerCertificate();
        resolve(validateTlsCertificate(certificate, now));
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new AccessCheckError("TLS certificate check timed out"));
    });
    socket.once("error", () => {
      reject(new AccessCheckError("TLS certificate validation failed"));
    });
  });
}

export async function verifyAccess({ origin, password, now = Date.now() }) {
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
  const certificate = base.protocol === "https:" ? await inspectTlsCertificate(base, now) : null;
  const authorization = `Basic ${Buffer.from(`owner:${password}`).toString("base64")}`;
  const request = async (path, authenticated, expectedStatus) => {
    let response;
    try {
      response = await fetch(new URL(path, base), {
        method: "GET",
        headers: authenticated ? { authorization } : {},
        redirect: "error",
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
  for (const path of ["/", "/api/v1/health"]) {
    await (await request(path, false, 401)).body?.cancel();
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
  requireState(expiresAt - now > DAY_MS, "Rotate the owner session within 24 hours");
  const operations = await json("/api/v1/operations/status");
  requireState(
    operations &&
      (operations.process_stop === null || typeof operations.process_stop?.active === "boolean"),
    "Model execution status is unavailable"
  );
  return {
    session_expires_at: new Date(expiresAt).toISOString(),
    tls_certificate_expires_at: certificate?.expires_at ?? null,
    model_requests_paused: operations.process_stop?.active === true
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const origin = process.env.COSMORA_ACCESS_ORIGIN;
    requireState(origin?.startsWith("https://"), "COSMORA_ACCESS_ORIGIN must use HTTPS");
    const password = readFileSync("/run/cosmora/owner-password", "utf8").replace(/\r?\n$/u, "");
    const result = await verifyAccess({ origin, password });
    process.stdout.write(
      `Owner access PASS; SQLite healthy; session expires ${result.session_expires_at}; ` +
        `TLS expires ${result.tls_certificate_expires_at}; ` +
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
