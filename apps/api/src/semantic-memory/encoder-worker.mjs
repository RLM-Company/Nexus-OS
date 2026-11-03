import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { MODEL } from "./model-manifest.mjs";

// No remote models, CDN or user-content cache. Only an operator-installed
// and byte-verified model is loaded. CPU inference uses bounded native threads.
const directory = resolve(workerData.modelDirectory);
for (const [file, expected] of Object.entries(MODEL.files)) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(resolve(directory, file), {
    highWaterMark: 1024 * 1024
  }))
    digest.update(chunk);
  if (digest.digest("hex") !== expected) throw new Error("SEMANTIC_MODEL_INTEGRITY");
}
const { env, pipeline } = await import("@huggingface/transformers");
const batchSize = workerData.batchSize ?? 4,
  intraThreads = workerData.intraThreads ?? 2;
if (![1, 4].includes(batchSize) || ![1, 2].includes(intraThreads))
  throw new Error("SEMANTIC_PROFILE_INVALID");
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
  session_options: { intraOpNumThreads: intraThreads, interOpNumThreads: 1 }
});
parentPort.postMessage({ type: "ready" });
parentPort.on("message", async ({ id, op = "rank", kind, texts, query, passages }) => {
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
    if (op === "embed") {
      if (
        !["query", "passage"].includes(kind) ||
        !Array.isArray(texts) ||
        texts.length > 96 ||
        texts.some((t) => typeof t !== "string" || t.length > (kind === "query" ? 2000 : 600))
      )
        throw new Error("SEMANTIC_INPUT_LIMIT");
      const inputs = texts.map((t) => kind + ": " + t);
      const tokens = await extractor.tokenizer(inputs, {
        padding: false,
        truncation: false,
        return_tensor: false
      });
      const vectors = Array(texts.length).fill(null);
      const valid = inputs
        .map((text, index) => ({ text, index }))
        .filter(({ index }) => kind === "query" || tokens.input_ids[index].length <= 512);
      for (let i = 0; i < valid.length; i += batchSize) {
        const batch = valid.slice(i, i + batchSize);
        const result = await embed(batch.map((v) => v.text));
        batch.forEach((v, j) => {
          vectors[v.index] = result[j];
        });
      }
      parentPort.postMessage({ type: "embedded", id, encoder: MODEL.encoder, vectors });
      return;
    }
    const [q] = await embed(["query: " + query]);
    const scores = [];
    for (let i = 0; i < passages.length; i += batchSize) {
      const vectors = await embed(passages.slice(i, i + batchSize).map((s) => "passage: " + s));
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
