import type { ModelOutputCheckpoint } from "@cosmora/contracts";

export const MODEL_OUTPUT_CHECKPOINT_BYTES = 32768;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** A prefix for explicit human recovery, never an executable/validated model result. */
export class ModelOutputCheckpointWriter {
  private pending: ModelOutputCheckpoint | undefined;
  private savedBytes = -1;
  private savedComplete = false;
  private savedAt = -Infinity;

  constructor(
    private readonly modelRunId: string,
    private readonly stage: ModelOutputCheckpoint["stage"],
    private readonly persist: (checkpoint: ModelOutputCheckpoint) => boolean,
    private readonly now: () => number = Date.now
  ) {}

  update(text: string, streamCompleted = false): void {
    const bytes = encoder.encode(text);
    let end = Math.min(bytes.length, MODEL_OUTPUT_CHECKPOINT_BYTES);
    // Never cut inside a UTF-8 sequence (including emoji and non-Latin text).
    while (end < bytes.length && end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
    this.pending = {
      kind: "unvalidated_model_output",
      model_run_id: this.modelRunId,
      stage: this.stage,
      text: decoder.decode(bytes.subarray(0, end)),
      received_bytes: bytes.length,
      truncated: bytes.length > end,
      stream_completed: streamCompleted,
      updated_at: new Date(this.now()).toISOString()
    };
    if (
      this.savedBytes < 0 ||
      streamCompleted ||
      bytes.length - this.savedBytes >= 8192 ||
      this.now() - this.savedAt >= 1000
    )
      this.flush();
  }

  /** Best effort: recovery metadata must not prevent canonical accounting settlement. */
  flush(): boolean {
    const checkpoint = this.pending;
    if (
      !checkpoint ||
      (checkpoint.received_bytes === this.savedBytes &&
        checkpoint.stream_completed === this.savedComplete)
    )
      return true;
    try {
      if (!this.persist(structuredClone(checkpoint))) return false;
    } catch {
      return false;
    }
    this.savedBytes = checkpoint.received_bytes;
    this.savedComplete = checkpoint.stream_completed;
    this.savedAt = this.now();
    return true;
  }
}
