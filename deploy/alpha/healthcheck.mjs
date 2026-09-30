const role = process.argv[2];
if (role !== "api" && role !== "web") throw new Error("Expected api or web healthcheck role");
const port = role === "api" ? (process.env.API_PORT ?? "3100") : "3000";
const path = role === "api" ? "/api/v1/health" : "/";
const response = await fetch(`http://127.0.0.1:${port}${path}`, {
  signal: AbortSignal.timeout(4_000),
  redirect: "error"
});
if (response.status !== 200) throw new Error(`${role} healthcheck failed: ${response.status}`);
if (role === "api") {
  const health = await response.json();
  if (health.status !== "ok" || health.database !== "ok") {
    throw new Error("API database is not healthy");
  }
} else {
  await response.body?.cancel();
}
