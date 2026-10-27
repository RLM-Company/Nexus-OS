// Keep inherited local credentials and provider registries out of this fixture.
for (const key of [
  "MODEL_API_KEY",
  "MODEL_BASE_URL",
  "MODEL_REGISTRY_PATH",
  "GITHUB_TOKEN",
  "GITHUB_API_TOKEN"
]) {
  delete process.env[key];
}
process.env.MODEL_PROVIDER = "mock";
process.env.MODEL_PROVIDER_ID = "mock";
process.env.MODEL_NAME = "manager";
await import("./e2e-server.js");
