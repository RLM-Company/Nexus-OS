// Offline text-generation worker for the experience distillation LLM-turn
// measurement bench (scripts/bench-experience-llm-distill.mjs).
//
// Mirrors the shipped semantic encoder worker guarantees
// (apps/api/src/semantic-memory/encoder-worker.mjs): only a locally installed
// model directory is usable, remote and browser caches are disabled, and
// network access fails before any text is processed. The model is installed
// separately by the operator per the pinned manifest
// (docs/research/experience-llm-distill-manifest-2026-11-10.json); no weights
// are stored in the repository. This worker is bench infrastructure only and
// does not touch product code or any product runtime.
import { isMainThread, parentPort, workerData } from "node:worker_threads";

if (isMainThread) throw new Error("LLM_WORKER_MAIN_THREAD");
if (!workerData?.modelDir) throw new Error("LLM_MODEL_DIR_REQUIRED");

const { env, pipeline } = await import("@huggingface/transformers");
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useFSCache = false;
env.useBrowserCache = false;
// Same guarantee as the encoder worker: network requests fail before any
// text is processed; local filesystem IO is used for model files only.
Object.defineProperty(globalThis, "fetch", {
  value: () => Promise.reject(new Error("LLM_NETWORK_DISABLED")),
  configurable: false,
  writable: false
});

const generator = await pipeline("text-generation", workerData.modelDir + "/", {
  dtype: workerData.dtype ?? "q4",
  device: "cpu",
  local_files_only: true,
  session_options: {
    intraOpNumThreads: workerData.intraThreads ?? 2,
    interOpNumThreads: 1
  }
});
parentPort.postMessage({ type: "ready" });

parentPort.on("message", async ({ id, op, conversations, maxNewTokens = 700 }) => {
  if (op !== "generate") {
    parentPort.postMessage({ id: id, error: "LLM_OP_UNSUPPORTED" });
    return;
  }
  try {
    const answers = [];
    for (let index = 0; index < conversations.length; index++) {
      // Greedy decoding: sampling disabled so repeated runs of the same
      // prompt are expected to agree on this machine and runtime.
      const result = await generator(conversations[index], {
        max_new_tokens: maxNewTokens,
        do_sample: false
      });
      const text = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
      const answer = Array.isArray(text)
        ? String(text.at(-1)?.content ?? text.at(-1)?.text ?? "")
        : String(text ?? "");
      if (!answer) throw new Error("LLM_EMPTY_OUTPUT");
      answers.push(answer);
    }
    parentPort.postMessage({ id: id, type: "result", answers: answers });
  } catch (error) {
    parentPort.postMessage({ id: id, error: String(error?.message ?? error) });
  }
});
