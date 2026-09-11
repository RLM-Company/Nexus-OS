const REQUEST_TIMEOUT_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const apiOrigin = new URL(process.env.COSMORA_API_ORIGIN ?? "http://127.0.0.1:3100");
const webOrigin = new URL(process.env.COSMORA_WEB_ORIGIN ?? "http://127.0.0.1:3000");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertLocalOrigin = (label, origin) => {
  assert(origin.protocol === "http:", `${label} must use local HTTP`);
  assert(LOOPBACK_HOSTS.has(origin.hostname), `${label} must stay on loopback`);
  assert(origin.username === "" && origin.password === "", `${label} must not contain credentials`);
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

const main = async () => {
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

  const proxiedHealth = await fetchJson(webOrigin, "/api/v1/health", "Web-to-API proxy");
  assert(proxiedHealth.status === "ok", "Web-to-API proxy health is not ok");
  assert(proxiedHealth.database === "ok", "Web-to-API proxy cannot reach SQLite health");

  process.stdout.write(
    [
      "Demo preflight PASS",
      `- API: ${apiOrigin.origin} (SQLite ok)`,
      `- Web: ${webOrigin.origin} (API proxy ok)`,
      "- Model route: mock only; no credential configured",
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
