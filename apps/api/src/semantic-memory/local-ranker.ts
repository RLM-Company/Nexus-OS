import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { availableParallelism, totalmem } from "node:os";
import type { ContextMemoryRanker, ContextMemoryEncoder } from "@cosmora/contracts";
import { MODEL } from "./model-manifest.mjs";

type Ranking = Awaited<ReturnType<ContextMemoryRanker["rank"]>>;
type Embedding = Awaited<ReturnType<ContextMemoryEncoder["embed"]>>;
type Result = Ranking | Embedding;
type Pending = { id: string; settle: (value?: Result, error?: string) => void };

/** One CPU worker, one active request and one bounded foreground-query waiter.
 * No private-text cache. The explicit history index owns persisted vectors. */
export class LocalMemoryRanker implements ContextMemoryEncoder {
  readonly encoder = MODEL.encoder;
  private worker: Worker | undefined;
  private ready = false;
  private pending: Pending | undefined;
  private closed = false;
  private warmed: Promise<void> = Promise.resolve();
  private warmDone!: () => void;
  private attempts = 0;
  private retryAfter = 0;
  private retiring: Promise<number> | undefined;
  private idle = Promise.resolve();
  private idleDone: (() => void) | undefined;
  private queryWaiting = false;
  readonly runtimeProfile: { batchSize: 1 | 4; intraThreads: 1 | 2 };
  constructor(
    private readonly directory: string,
    private readonly timeoutMs = 8000,
    profile: { batchSize?: 1 | 4; intraThreads?: 1 | 2 } = {}
  ) {
    const small =
      (process.constrainedMemory() || totalmem()) <= 1024 * 1024 * 1024 ||
      availableParallelism() < 2;
    this.runtimeProfile = {
      batchSize: profile.batchSize ?? (small ? 1 : 4),
      intraThreads: profile.intraThreads ?? (availableParallelism() < 2 ? 1 : 2)
    };
    if (
      !isAbsolute(directory) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000 ||
      ![1, 4].includes(this.runtimeProfile.batchSize) ||
      ![1, 2].includes(this.runtimeProfile.intraThreads)
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
      workerData: { modelDirectory: this.directory, ...this.runtimeProfile },
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
      (message: {
        type?: string;
        id?: string;
        encoder?: string;
        scores?: number[];
        vectors?: (number[] | null)[];
      }) => {
        if (this.worker !== worker) return;
        if (message.type === "ready") {
          this.ready = true;
          this.warmDone();
        } else if (message.id === this.pending?.id) {
          this.pending?.settle(
            message.type === "ranked" && message.encoder && message.scores
              ? { encoder: message.encoder, scores: message.scores }
              : message.type === "embedded" && message.encoder && message.vectors
                ? { encoder: message.encoder, vectors: message.vectors }
                : undefined,
            message.type === "failed" ? "SEMANTIC_INFERENCE_FAILED" : undefined
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
    if (query.length > 400000 || passages.length > 96 || passages.some((p) => p.length > 600))
      return Promise.reject(new Error("SEMANTIC_INPUT_LIMIT"));
    return this.request(
      { op: "rank", query: query.slice(0, 2000).replace(/[\uD800-\uDBFF]$/, ""), passages },
      signal
    ).then((result) => {
      if (!("scores" in result)) throw new Error("SEMANTIC_RESULT");
      return result;
    });
  }
  async embed(
    kind: "query" | "passage",
    texts: readonly string[],
    signal?: AbortSignal
  ): Promise<Embedding> {
    signal?.throwIfAborted();
    if (texts.length > 96 || texts.some((t) => t.length > (kind === "query" ? 2000 : 600)))
      throw new Error("SEMANTIC_INPUT_LIMIT");
    if (kind === "query" && this.pending) {
      if (this.queryWaiting) throw new Error("SEMANTIC_UNAVAILABLE");
      this.queryWaiting = true;
      const waiting = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(this.timeoutMs)
      ]);
      try {
        await new Promise<void>((resolve, reject) => {
          const aborted = () => reject(new Error("SEMANTIC_UNAVAILABLE"));
          waiting.addEventListener("abort", aborted, { once: true });
          void this.idle.then(() => {
            waiting.removeEventListener("abort", aborted);
            resolve();
          });
        });
        waiting.throwIfAborted();
      } finally {
        this.queryWaiting = false;
      }
    } else if (kind === "passage" && this.queryWaiting) throw new Error("SEMANTIC_UNAVAILABLE");
    const result = await this.request({ op: "embed", kind, texts }, signal);
    if (!("vectors" in result) || result.encoder !== this.encoder)
      throw new Error("SEMANTIC_RESULT");
    return result;
  }
  private request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Result> {
    signal?.throwIfAborted();
    if (!this.worker) this.start();
    if (!this.worker || !this.ready || this.pending)
      return Promise.reject(new Error("SEMANTIC_UNAVAILABLE"));
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
      const settle = (value?: Result, error?: string) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending = undefined;
        this.idleDone?.();
        worker.unref();
        if (value) resolve(value);
        else reject(new Error(error ?? "SEMANTIC_UNAVAILABLE"));
      };
      this.pending = { id, settle };
      this.idle = new Promise((resolve) => {
        this.idleDone = resolve;
      });
      worker.ref();
      signal?.addEventListener("abort", abort, { once: true });
      // The model sees at most 512 tokens; a separate query bound prevents an
      // oversized structured clone. Exact original questions remain untouched.
      worker.postMessage({ id, ...payload });
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
  async drain() {
    await this.retiring;
  }
  readyForBackground() {
    if (!this.worker) this.start();
    return this.ready && !this.pending && !this.queryWaiting;
  }
}
