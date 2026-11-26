import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(join(process.argv[2], "package.json"));
const ts = require("typescript");
const code = ts.transpileModule(
  readFileSync(new URL("./external-image-provider-adapter.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
const mod = { exports: {} };
new Function("exports", "module", code)(mod.exports, mod);
const seen = [];
const adapter = new mod.exports.ExternalImageProviderAdapter({
  baseUrl: "https://provider.example",
  apiKey: "DUMMY_REVIEW_KEY",
  fetchImpl: async (url, options) => {
    seen.push({ url, authorization: options.headers.authorization });
    return {
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([1]).buffer
    };
  }
});
await adapter.downloadArtifact("https://untrusted-cdn.example/artifact.png", "test.png");
console.log(
  JSON.stringify(
    {
      network: "mock only, no real request or key",
      requests: seen,
      secretSentOutsideProvider: seen[0].authorization === "Bearer DUMMY_REVIEW_KEY"
    },
    null,
    2
  )
);
