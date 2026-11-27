import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep inherited local credentials and provider registries out of this fixture.
for (const key of [
  "MODEL_API_KEY",
  "MODEL_BASE_URL",
  "MODEL_REGISTRY_PATH",
  "GITHUB_TOKEN",
  "GITHUB_API_TOKEN",
  "KOSMORA_MEDIA_OPENAI_API_KEY",
  "KOSMORA_MEDIA_USE_CHAT_CREDENTIAL"
]) {
  delete process.env[key];
}
const media = mkdtempSync(join(tmpdir(), "nexus-e2e-media-"));
process.on("exit", () => rmSync(media, { recursive: true, force: true }));
process.env.KOSMORA_MEDIA_DIR = media;
process.env.KOSMORA_MEDIA_PAID_ENABLED = "false";
process.env.MODEL_PROVIDER = "mock";
process.env.MODEL_PROVIDER_ID = "mock";
process.env.MODEL_NAME = "manager";
await import("./e2e-server.js");
