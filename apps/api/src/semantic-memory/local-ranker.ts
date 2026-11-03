import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ContextMemoryRanker } from "@cosmora/contracts";

type Ranking = Awaited<ReturnType<ContextMemoryRanker["rank"]>>;
type Pending = { id: string; settle: (value?: Ranking) => void };

/** One CPU worker, one active request, no queue or durable private-text index.
 * Busy/cold/failed instances fall back to lexical recall in ContextMemoryStore. */
export class LocalMemoryRanker implements ContextMemoryRanker {
  private worker: Worker | undefined;
  private ready = false;
  private pending: Pending | undefined;
  private closed = false;
  private warmed: Promise<void> = Promise.resolve();
  private warmDone!: () => void;
  private attempts = 0;
  private retryAfter = 0;
  private retiring: Promise<number> | undefined;
  constructor(
    private readonly directory: string,
    private readonly timeoutMs = 8000
  ) {
    if (
      !isAbsolute(directory) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000
    )
      throw new Error("INVALID_SEMANTIC_CONFIG");
    this.start();
  }
  private start() {
    if (
      this.closed ||
      this.worker ||
      this.retiring ||
      this.attempts >= 3 ||
      Date.now() < this.retryAfter
    )
      return;
    this.attempts++;
    this.warmed = new Promise((resolve) => {
      this.warmDone = resolve;
    });
    const worker = new Worker(new URL("./encoder-worker.mjs", import.meta.url), {
      workerData: { modelDirectory: this.directory },
      // A worker must not inherit a dev loader, inspect port or test flags.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    this.worker = worker;
    const failed = () => {
      if (this.worker !== worker) return;
      this.ready = false;
      this.worker = undefined;
      this.pending?.settle();
      this.warmDone();
      this.retire(worker);
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    worker.on(
      "message",
      (message: { type?: string; id?: string; encoder?: string; scores?: number[] }) => {
        if (this.worker !== worker) return;
        if (message.type === "ready") {
          this.ready = true;
          this.warmDone();
        } else if (message.id === this.pending?.id) {
          this.pending?.settle(
            message.type === "ranked" && message.encoder && message.scores
              ? { encoder: message.encoder, scores: message.scores }
              : undefined
          );
        }
      }
    );
    worker.unref();
    // Booting cannot retain a hung worker forever. No request data is sent at boot.
    const bootTimer = setTimeout(() => {
      if (!this.ready) failed();
    }, 60000);
    bootTimer.unref();
    void this.warmed.then(() => clearTimeout(bootTimer));
  }
  private retire(worker: Worker) {
    this.retryAfter = Date.now() + 30000;
    const retiring = worker.terminate();
    this.retiring = retiring;
    void retiring.then(
      () => {
        if (this.retiring === retiring) this.retiring = undefined;
      },
      () => {
        if (this.retiring === retiring) this.retiring = undefined;
      }
    );
  }
  async warmup(): Promise<boolean> {
    const worker = this.worker;
    worker?.ref();
    await this.warmed;
    if (!this.pending) worker?.unref();
    return this.ready;
  }
  rank(query: string, passages: readonly string[], signal?: AbortSignal): Promise<Ranking> {
    signal?.throwIfAborted();
    if (!this.worker) this.start();
    if (!this.worker || !this.ready || this.pending)
      return Promise.reject(new Error("SEMANTIC_UNAVAILABLE"));
    if (query.length > 400000 || passages.length > 96 || passages.some((p) => p.length > 600))
      return Promise.reject(new Error("SEMANTIC_INPUT_LIMIT"));
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => {
        // Termination also drops in-flight private text; no cancelled operation
        // continues in the background or blocks a later owner.
        this.ready = false;
        this.worker = undefined;
        this.retire(worker);
        settle();
      };
      const timer = setTimeout(abort, this.timeoutMs);
      timer.unref();
      const settle = (value?: Ranking) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending = undefined;
        worker.unref();
        if (value) resolve(value);
        else reject(new Error("SEMANTIC_UNAVAILABLE"));
      };
      this.pending = { id, settle };
      worker.ref();
      signal?.addEventListener("abort", abort, { once: true });
      // The model sees at most 512 tokens; a separate query bound prevents an
      // oversized structured clone. Exact original questions remain untouched.
      worker.postMessage({
        id,
        query: query.slice(0, 2000).replace(/[\uD800-\uDBFF]$/, ""),
        passages
      });
    });
  }
  async close() {
    this.closed = true;
    this.ready = false;
    this.pending?.settle();
    const worker = this.worker;
    this.worker = undefined;
    await worker?.terminate();
    await this.retiring;
    this.warmDone();
  }
}
