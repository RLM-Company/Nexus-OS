import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MODEL } from "./model-manifest.mjs";

// No remote models, CDN or user-content cache. Only an operator-installed
// and byte-verified model is loaded. CPU inference uses bounded native threads.
const directory = resolve(workerData.modelDirectory);
for (const [file, expected] of Object.entries(MODEL.files)) {
  const data = await readFile(resolve(directory, file));
  if (createHash("sha256").update(data).digest("hex") !== expected)
    throw new Error("SEMANTIC_MODEL_INTEGRITY");
}
const { env, pipeline } = await import("@huggingface/transformers");
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useFSCache = false;
env.useBrowserCache = false;
// This also guards accidental future loader changes. Local filesystem IO is used
// for model files; network requests fail before any user text is processed.
Object.defineProperty(globalThis, "fetch", {
  value: () => Promise.reject(new Error("SEMANTIC_NETWORK_DISABLED")),
  configurable: false,
  writable: false
});
const extractor = await pipeline("feature-extraction", directory + "/", {
  dtype: "q8",
  device: "cpu",
  local_files_only: true,
  session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 }
});
parentPort.postMessage({ type: "ready" });
parentPort.on("message", async ({ id, query, passages }) => {
  try {
    const embed = async (texts) => {
      const result = await extractor(texts, {
        pooling: "mean",
        normalize: true,
        truncation: true,
        max_length: 512
      });
      if (result.dims[1] !== 384) throw new Error("SEMANTIC_DIMENSIONS");
      return result.tolist();
    };
    const [q] = await embed(["query: " + query]);
    const scores = [];
    for (let i = 0; i < passages.length; i += 4) {
      const vectors = await embed(passages.slice(i, i + 4).map((s) => "passage: " + s));
      for (const vector of vectors)
        scores.push(
          Math.max(
            -1,
            Math.min(
              1,
              vector.reduce((sum, x, j) => sum + x * q[j], 0)
            )
          )
        );
    }
    parentPort.postMessage({ type: "ranked", id, encoder: MODEL.encoder, scores });
  } catch {
    parentPort.postMessage({ type: "failed", id });
  }
});
