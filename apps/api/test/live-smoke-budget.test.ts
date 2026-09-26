import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/manager-live-smoke.mjs", import.meta.url));
describe("live smoke pre-dispatch budget", () => {
  it.each([
    { max_attempts_per_route: 2, max_output_tokens: 128 },
    { max_attempts_per_route: 1, max_output_tokens: 1200 },
    { max_output_tokens: 128 },
    { max_attempts_per_route: 1 }
  ])("refuses unbounded configuration before any mutation: %j", (bounds) => {
    const runtime = {
      mode: "openai-compatible",
      provider: "external",
      credential_configured: true,
      fallback_to_mock: false,
      ...bounds
    };
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      let posts = 0;
      globalThis.fetch = async (_url, options) => {
        if (options?.method === "POST") posts++;
        return new Response(JSON.stringify(${JSON.stringify(runtime)}));
      };
      await import(${JSON.stringify(script)});
      console.log("POSTS=" + posts);
    `
      ],
      {
        env: {
          ...process.env,
          COSMORA_ALLOW_PAID_SMOKE: "SEND_TWO_PAID_REQUESTS",
          COSMORA_API_ORIGIN: "http://127.0.0.1:3100"
        },
        encoding: "utf8"
      }
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("POSTS=0");
    expect(result.stderr).toContain("before live smoke");
  });
});
