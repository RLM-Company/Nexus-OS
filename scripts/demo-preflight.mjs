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

const main = async () => {
  const apiOrigin = parseOrigin("COSMORA_API_ORIGIN", "http://127.0.0.1:3100", "API origin");
  const webOrigin = parseOrigin("COSMORA_WEB_ORIGIN", "http://127.0.0.1:3000", "Web origin");
  assertLocalOrigin("API origin", apiOrigin);
  assertLocalOrigin("Web origin", webOrigin);

  const health = await fetchJson(apiOrigin, "/api/v1/health", "API health");
  assert(health.status === "ok", "API health is not ok");
  assert(health.database === "ok", "SQLite health is not ok");

  const runtime = await fetchJson(apiOrigin, "/api/v1/model-runtime", "Model runtime status");
  assert(runtime.mode === "mock", "Demo requires the mock model mode");
  assert(runtime.provider === "mock", "Demo requires the mock provider");
  assert(
    runtime.credential_configured === false,
    "Demo must not use a configured model credential"
  );

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

  process.stdout.write(
    [
      "Demo preflight PASS",
      `- API: ${apiOrigin.origin} (SQLite ok)`,
      `- Web: ${webOrigin.origin} (API proxy ok)`,
      "- Model route: mock only; no credential configured",
      "- Web surfaces: Manager, Model Status, Skills, GitHub preview, Agent Studio, Control Center",
      "- PWA manifest/icons: ready",
      "- Emergency stops: clear"
    ].join("\n") + "\n"
  );
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown preflight failure";
  process.stderr.write(`Demo preflight FAILED: ${message}\n`);
  process.exitCode = 1;
}
