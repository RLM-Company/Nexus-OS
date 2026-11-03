import { setImmediate as yieldLoop } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import type {
  ContextMemoryEncoder,
  ContextMemoryEvidence,
  MemoryTarget,
  ContextMemoryBundle
} from "@cosmora/contracts";
import {
  SemanticIndexStore,
  scoreSemanticVector,
  vectorBytes,
  type ContextMemoryStore,
  type IndexedMemoryRecall
} from "@cosmora/db";

type Job = { owner: string; controller: AbortController; done: Promise<unknown> };
export class SemanticHistoryIndex implements IndexedMemoryRecall {
  readonly store: SemanticIndexStore;
  readonly format: string;
  private jobs = new Set<Job>();
  private fenced = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private lastSweep = -Infinity;
  private cursor: [string, string, string] = ["", "", ""];
  constructor(
    sqlite: DatabaseSync,
    private readonly encoder: ContextMemoryEncoder,
    private readonly options: {
      maxOwnerChunks?: number;
      queryMs?: number;
      tickMs?: number;
      now?: () => number;
    } = {}
  ) {
    if (
      (options.queryMs !== undefined &&
        (!Number.isInteger(options.queryMs) || options.queryMs < 0 || options.queryMs > 60000)) ||
      (options.tickMs !== undefined &&
        (!Number.isInteger(options.tickMs) || options.tickMs < 1 || options.tickMs > 60000))
    )
      throw new Error("SEMANTIC_BUDGET_INVALID");
    this.store = new SemanticIndexStore(sqlite, options.now, options.maxOwnerChunks);
    this.format = encoder.encoder + ":adaptive-v1";
  }
  private async tracked<T>(
    owner: string,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.stopped || this.fenced.has(owner)) throw new Error("OWNER_DATA_FENCED");
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const done = Promise.resolve().then(() => {
      combined.throwIfAborted();
      return operation(combined);
    });
    const job = { owner, controller, done };
    this.jobs.add(job);
    try {
      return await done;
    } finally {
      this.jobs.delete(job);
    }
  }
  start() {
    if (this.timer || this.stopped) return;
    const tick = async () => {
      const began = performance.now();
      let working = false;
      try {
        if (this.encoder.readyForBackground && !this.encoder.readyForBackground()) return;
        if (began - this.lastSweep >= 60000) {
          this.store.sweep(this.format);
          this.lastSweep = began;
        }
        let next = this.store.nextTarget(this.cursor);
        if (!next) {
          this.cursor = ["", "", ""];
          next = this.store.nextTarget(this.cursor);
        }
        if (next) {
          this.cursor = [next.owner, next.target.kind, next.target.id];
          if (!this.fenced.has(next.owner)) {
            const p = this.store.progress(next.target, next.owner, this.format);
            working =
              p.state === "building" ||
              (p.state === "capacity" && this.store.remaining(next.owner) > 0);
            if (working) await this.buildOnce(next.target, next.owner);
          }
        }
      } catch {
        /* Optional local inference degrades to lexical; no unbounded retry loop. */
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(
            () => void tick(),
            Math.max(
              this.options.tickMs ?? (working ? 50 : 1000),
              Math.ceil((performance.now() - began) * 3)
            )
          );
          this.timer.unref();
        }
      }
    };
    this.timer = setTimeout(() => void tick(), 0);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const j of this.jobs) j.controller.abort();
    await Promise.allSettled([...this.jobs].map((j) => j.done));
    await this.encoder.drain();
  }
  async quiesce(owner: string) {
    this.fenced.add(owner);
    const jobs = [...this.jobs].filter((j) => j.owner === owner);
    jobs.forEach((j) => j.controller.abort());
    await Promise.allSettled(jobs.map((j) => j.done));
    await this.encoder.drain();
    this.store.purge(owner);
  }
  resume(owner: string) {
    this.fenced.delete(owner);
  }
  buildOnce(target: MemoryTarget, owner: string, signal?: AbortSignal) {
    return this.tracked(owner, signal, async (sig) => {
      const a = this.store.authority,
        scope = a.semanticScope(target, owner);
      if (!scope.settings.enabled) return;
      const progress = this.store.progress(target, owner, this.format);
      if (progress.state === "capacity" && this.store.remaining(owner) > 0) {
        this.store.capacity(target, owner, this.format, "building");
        progress.state = "building";
      }
      if (progress.state !== "building" || progress.phase === 3) return;
      const refs = a.semanticSourcePage(target, owner, progress.phase, progress.after_id);
      if (!refs.length) {
        this.store.advance(target, owner, this.format, progress, "", progress.phase + 1);
        return;
      }
      for (const reference of refs) {
        try {
          sig.throwIfAborted();
          const cached = this.store.cached(owner, reference, this.format);
          if (cached?.complete) {
            const id = reference.slice(progress.phase === 0 ? 2 : 4);
            this.store.advance(target, owner, this.format, progress, id);
            progress.after_id = id;
            continue;
          }
          const source = a.semanticSource(target, owner, reference);
          if (!source) {
            const id = reference.slice(progress.phase === 0 ? 2 : 4);
            this.store.advance(target, owner, this.format, progress, id);
            progress.after_id = id;
            continue;
          }
          const remaining = this.store.remaining(owner);
          if (!remaining) {
            this.store.capacity(target, owner, this.format);
            return;
          }
          let offset = cached?.next_offset ?? 0,
            width = cached?.chunk_width ?? 600;
          const ranges: { start: number; end: number; text: string }[] = [];
          while (offset < source.text.length && ranges.length < Math.min(8, remaining)) {
            let end = Math.min(offset + width, source.text.length);
            if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1]!)) end--;
            if (end === offset) end = Math.min(source.text.length, offset + 2);
            ranges.push({ start: offset, end, text: source.text.slice(offset, end) });
            if (end === source.text.length) break;
            offset = end - Math.min(60, Math.floor(width / 10));
            if (/[\uDC00-\uDFFF]/.test(source.text[offset]!)) offset++;
          }
          const output = ranges.length
            ? await this.encoder.embed(
                "passage",
                ranges.map((r) => r.text),
                sig
              )
            : { encoder: this.encoder.encoder, vectors: [] };
          sig.throwIfAborted();
          if (output.encoder !== this.encoder.encoder || output.vectors.length !== ranges.length)
            throw new Error("SEMANTIC_VECTOR_INVALID");
          const chunks: { start: number; end: number; vector: number[] }[] = [];
          offset = cached?.next_offset ?? 0;
          for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i]!,
              vector = output.vectors[i];
            if (!vector) {
              if (width === 1) {
                this.store.capacity(target, owner, this.format, "blocked");
                return;
              }
              width = Math.max(1, Math.floor(width / 2));
              break;
            }
            vectorBytes(vector);
            chunks.push({ ...range, vector });
            offset =
              range.end === source.text.length
                ? range.end
                : range.end - Math.min(60, Math.floor((cached?.chunk_width ?? 600) / 10));
            if (/[\uDC00-\uDFFF]/.test(source.text[offset] ?? "")) offset++;
          }
          try {
            const committed = this.store.commit(
              target,
              owner,
              this.format,
              scope.settings.version,
              source,
              cached?.next_offset ?? 0,
              chunks,
              offset,
              width,
              offset === source.text.length
            );
            if (committed) this.store.outcome(target, owner, this.format, progress, true);
            if (committed && offset === source.text.length)
              this.store.advance(
                target,
                owner,
                this.format,
                progress,
                reference.slice(progress.phase === 0 ? 2 : 4)
              );
          } catch (error) {
            if (error instanceof Error && error.message === "SEMANTIC_CAPACITY")
              this.store.capacity(target, owner, this.format);
            else throw error;
          }
          return;
        } catch (error) {
          sig.throwIfAborted();
          if (!(error instanceof Error) || error.message !== "SEMANTIC_UNAVAILABLE")
            this.store.outcome(target, owner, this.format, progress, false);
          return;
        }
      }
    });
  }
  resolve(
    a: ContextMemoryStore,
    target: MemoryTarget,
    owner: string,
    query: string,
    excluded: readonly string[],
    budget: number,
    signal?: AbortSignal
  ): Promise<ContextMemoryBundle> {
    return this.tracked(owner, signal, async (sig) => {
      const baseline = a.resolve(target, owner, query, excluded, budget),
        settings = a.settings(target, owner);
      if (!settings.enabled || baseline.priority_omitted || !query.trim()) return baseline;
      const progress = this.store.progress(target, owner, this.format);
      let vector: number[];
      try {
        const encoded = await this.encoder.embed(
          "query",
          [query.slice(0, 2000).replace(/[\uD800-\uDBFF]$/, "")],
          sig
        );
        if (encoded.encoder !== this.encoder.encoder || !encoded.vectors[0])
          throw new Error("SEMANTIC_VECTOR_INVALID");
        vector = encoded.vectors[0];
        vectorBytes(vector);
      } catch {
        sig.throwIfAborted();
        return a.resolve(target, owner, query, excluded, budget);
      }
      const summary = this.store.summary(target, owner, this.format),
        start = performance.now();
      let after = 0,
        limited = false;
      const best = new Map<
        string,
        { reference: string; fingerprint: string; start: number; end: number; score: number }
      >();
      while (after < summary.upper) {
        sig.throwIfAborted();
        const page = this.store.rows(target, owner, this.format, after, summary.upper);
        if (!page.length) break;
        for (const row of page) {
          after = row.id;
          if (excluded.some((id) => row.reference === "H:g:" + id || row.reference === "H:p:" + id))
            continue;
          let score: number;
          try {
            score = scoreSemanticVector(row.vector, vector);
          } catch {
            this.store.purge(owner);
            return a.resolve(target, owner, query, excluded, budget);
          }
          if (score > (best.get(row.reference)?.score ?? -2))
            best.set(row.reference, {
              reference: row.reference,
              fingerprint: row.fingerprint,
              start: row.start_utf16,
              end: row.end_utf16,
              score
            });
        }
        const top = [...best.values()].sort((x, y) => y.score - x.score).slice(0, 32);
        best.clear();
        top.forEach((v) => best.set(v.reference, v));
        if (performance.now() - start > (this.options.queryMs ?? 250) && after < summary.upper) {
          limited = true;
          break;
        }
        if (after < summary.upper) await yieldLoop(undefined, { signal: sig });
      }
      sig.throwIfAborted();
      const matches: { evidence: ContextMemoryEvidence; score: number }[] = [];
      for (const hit of best.values()) {
        const source = a.semanticSource(target, owner, hit.reference);
        if (
          !source ||
          source.fingerprint !== hit.fingerprint ||
          hit.start < 0 ||
          hit.end > source.text.length ||
          hit.end <= hit.start
        )
          continue;
        const text = source.text.slice(hit.start, hit.end),
          e = source.evidence;
        matches.push({
          score: hit.score,
          evidence:
            e.kind === "memory"
              ? e
              : {
                  ...e,
                  text,
                  source: { ...e.source!, quote: text },
                  excerpt_only: hit.start > 0 || hit.end < source.text.length
                }
        });
      }
      if (a.settings(target, owner).version !== settings.version)
        return a.resolve(target, owner, query, excluded, budget);
      const current = this.store.progress(target, owner, this.format);
      const scanLimited = limited;
      limited = limited || current.generation !== progress.generation || current.state !== "ready";
      return a.fuseSemantic(
        target,
        owner,
        query,
        excluded,
        budget,
        settings.version,
        matches,
        this.encoder.encoder,
        limited,
        {
          state: current.state,
          indexed_sources: summary.indexed_sources,
          indexed_chunks: summary.indexed_chunks,
          scan_limited: scanLimited
        }
      );
    });
  }
}
