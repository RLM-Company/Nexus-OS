import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUEST_TIMEOUT_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const parseOrigin = (envName, fallback, label) => {
  const configured = process.env[envName] ?? fallback;
  try {
    return new URL(configured);
  } catch {
    throw new Error(`${label} is invalid`);
  }
};

const assertLocalOrigin = (label, origin) => {
  assert(origin.protocol === "http:", `${label} must use local HTTP`);
  assert(LOOPBACK_HOSTS.has(origin.hostname), `${label} must stay on loopback`);
  assert(origin.username === "" && origin.password === "", `${label} must not contain credentials`);
  assert(
    origin.pathname === "/" && origin.search === "" && origin.hash === "",
    `${label} must be an origin without path, query or fragment`
  );
};

const fetchResponse = async (origin, path, label) => {
  let response;
  try {
    response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  assert(response.ok, `${label} returned HTTP ${response.status}`);
  return response;
};

const fetchJson = async (origin, path, label) => {
  const response = await fetchResponse(origin, path, label);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
};

const assertHtmlRoute = async (origin, path, label) => {
  const response = await fetchResponse(origin, path, label);
  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.includes("text/html"), `${label} did not return HTML`);
};

const assertWebSurfaces = async (origin) => {
  await Promise.all([
    assertHtmlRoute(origin, "/model-status", "Model Status page"),
    assertHtmlRoute(origin, "/skills", "Skills preview"),
    assertHtmlRoute(origin, "/github", "GitHub preview"),
    assertHtmlRoute(origin, "/agent-studio", "Agent Studio"),
    assertHtmlRoute(origin, "/control-center", "Control Center")
  ]);

  const manifest = await fetchJson(origin, "/manifest.webmanifest", "PWA manifest");
  assert(manifest.name === "Cosmora AI", "PWA manifest has an unexpected app name");
  assert(manifest.short_name === "Cosmora", "PWA manifest has an unexpected short name");
  assert(manifest.start_url === "/", "PWA manifest has an unexpected start URL");
  assert(manifest.scope === "/", "PWA manifest has an unexpected scope");
  assert(manifest.display === "standalone", "PWA manifest is not standalone");
  assert(
    Array.isArray(manifest.icons) && manifest.icons.some((icon) => icon?.src === "/icon"),
    "PWA manifest does not expose the primary icon"
  );

  const icon = await fetchResponse(origin, "/icon", "PWA icon");
  const iconType = icon.headers.get("content-type") ?? "";
  assert(iconType.includes("image/png"), "PWA icon did not return PNG");

  const appleIcon = await fetchResponse(origin, "/apple-icon", "Apple PWA icon");
  const appleIconType = appleIcon.headers.get("content-type") ?? "";
  assert(appleIconType.includes("image/png"), "Apple PWA icon did not return PNG");
};

const assertManagerWorkRoute = (runtime) => {
  const path = resolve(
    process.cwd(),
    process.env.MODEL_REGISTRY_PATH ?? "config/model-registry.v1.json"
  );
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Local Model Registry cannot be read; Manager work route was not verified");
  }
  assert(
    registry.registry_version === runtime.registry_version,
    "Running Model Registry differs from local configuration"
  );
  const entry = registry.entries?.find(
    (candidate) =>
      candidate.provider_id === runtime.provider && candidate.model_id === runtime.model
  );
  assert(entry?.status === "active", "Configured Manager work model is not active in the registry");
  const allowed = (items, name) =>
    Array.isArray(items) && (items.length === 0 || items.includes(name));
  for (const [role, task] of [
    ["manager", "manager_work_plan"],
    ["analyst", "manager_work_draft"],
    ["critic", "manager_work_review"]
  ]) {
    assert(
      allowed(entry.roles, role) && allowed(entry.task_types, task),
      `Configured Model Registry does not allow ${role}:${task}; Manager work cannot run with only a key`
    );
  }
};

const main = async () => {
  const apiOrigin = parseOrigin("COSMORA_API_ORIGIN", "http://127.0.0.1:3100", "API origin");
  const webOrigin = parseOrigin("COSMORA_WEB_ORIGIN", "http://127.0.0.1:3000", "Web origin");
  assertLocalOrigin("API origin", apiOrigin);
  assertLocalOrigin("Web origin", webOrigin);

  const health = await fetchJson(apiOrigin, "/api/v1/health", "API health");
  assert(health.status === "ok", "API health is not ok");
  assert(health.database === "ok", "SQLite health is not ok");

  const runtime = await fetchJson(apiOrigin, "/api/v1/model-runtime", "Model runtime status");
  assert(runtime.mode !== "mock", "Manager requires an external model mode");
  assert(runtime.provider !== "mock", "Manager requires an external provider");
  assert(runtime.credential_configured === true, "Manager credential is not configured");
  assert(runtime.fallback_to_mock === false, "Disable mock fallback before live smoke");
  assert(typeof runtime.registry_version === "string", "Manager registry is unavailable");
  if (process.env.MODEL_PROVIDER) {
    assert(
      runtime.mode === process.env.MODEL_PROVIDER,
      "Running provider protocol differs from .env"
    );
  }
  if (process.env.MODEL_PROVIDER_ID) {
    assert(
      runtime.provider === process.env.MODEL_PROVIDER_ID,
      "Running provider differs from .env"
    );
  }
  if (process.env.MODEL_NAME) {
    assert(runtime.model === process.env.MODEL_NAME, "Running model differs from .env");
  }
  assertManagerWorkRoute(runtime);

  const operations = await fetchJson(apiOrigin, "/api/v1/operations/status", "Operations status");
  assert(operations.process_stop === null, "A process emergency stop is active");
  assert(operations.active_project_stops === 0, "A project emergency stop is active");

  const web = await fetchResponse(webOrigin, "/", "Manager Console");
  const html = await web.text();
  assert(html.includes("Cosmora OS"), "Manager Console HTML is not the expected Cosmora page");
  await assertWebSurfaces(webOrigin);

  const proxiedHealth = await fetchJson(webOrigin, "/api/v1/health", "Web-to-API proxy");
  assert(proxiedHealth.status === "ok", "Web-to-API proxy health is not ok");
  assert(proxiedHealth.database === "ok", "Web-to-API proxy cannot reach SQLite health");
  const proxiedRuntime = await fetchJson(
    webOrigin,
    "/api/v1/model-runtime",
    "Web-to-API model runtime proxy"
  );
  assert(
    proxiedRuntime.mode === runtime.mode &&
      proxiedRuntime.provider === runtime.provider &&
      proxiedRuntime.model === runtime.model,
    "Manager Console is connected to a different model runtime"
  );
  const ordinaryChats = await fetchJson(webOrigin, "/api/v1/chats", "Ordinary chat API");
  assert(Array.isArray(ordinaryChats.items), "Ordinary chat API did not return a list");

  process.stdout.write(
    [
      "Manager preflight PASS",
      `- API: ${apiOrigin.origin} (SQLite ok)`,
      `- Web: ${webOrigin.origin} (API proxy ok)`,
      `- Model route: ${runtime.provider}:${runtime.model} (${runtime.mode})`,
      `- Registry: ${runtime.registry_version}`,
      "- Manager work roles and stages: allowed by the configured route",
      "- Ordinary chat API: ready (no model request sent)",
      "- Web surfaces: Manager, Model Status, Skills, GitHub preview, Agent Studio, Control Center",
      "- PWA manifest/icons: ready",
      "- Mock fallback: disabled",
      "- Emergency stops: clear",
      "- No paid model request was sent by this check"
    ].join("\n") + "\n"
  );
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown preflight failure";
  process.stderr.write(`Manager preflight FAILED: ${message}\n`);
  process.exitCode = 1;
}
