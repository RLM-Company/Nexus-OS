export type BackpressureSignal = "FLOW_NORMAL" | "PAUSE_PRODUCER" | "RESUME_PRODUCER";

/**
 * Zero-Copy Pre-Allocated Circular Ring Buffer & Watermark Backpressure Controller.
 * Avoids GC allocations on high-frequency streaming chunks by reusing a fixed-capacity ring array
 * and signaling PAUSE_PRODUCER / RESUME_PRODUCER at configurable high/low watermarks.
 */
export class CircularRingBuffer<TItem = Uint8Array> {
  public readonly capacity: number;
  public readonly highWatermark: number;
  public readonly lowWatermark: number;
  private readonly buffer: Array<TItem | undefined>;
  private head = 0; // Read index
  private tail = 0; // Write index
  private currentSize = 0;
  private isPausedByBackpressure = false;

  constructor(params?: {
    capacity?: number;
    highWatermarkRatio?: number;
    lowWatermarkRatio?: number;
  }) {
    this.capacity = Math.max(4, params?.capacity ?? 64);
    this.highWatermark = Math.max(
      2,
      Math.floor(this.capacity * (params?.highWatermarkRatio ?? 0.8))
    );
    this.lowWatermark = Math.max(
      1,
      Math.floor(this.capacity * (params?.lowWatermarkRatio ?? 0.25))
    );
    this.buffer = new Array<TItem | undefined>(this.capacity);
  }

  public push(item: TItem): { accepted: boolean; signal: BackpressureSignal } {
    if (this.currentSize >= this.capacity) {
      this.isPausedByBackpressure = true;
      return { accepted: false, signal: "PAUSE_PRODUCER" };
    }

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.currentSize++;

    if (this.currentSize >= this.highWatermark) {
      this.isPausedByBackpressure = true;
      return { accepted: true, signal: "PAUSE_PRODUCER" };
    }

    return { accepted: true, signal: "FLOW_NORMAL" };
  }

  public shift(): { item: TItem | undefined; signal: BackpressureSignal } {
    if (this.currentSize === 0) {
      return { item: undefined, signal: "FLOW_NORMAL" };
    }

    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.currentSize--;

    if (this.isPausedByBackpressure && this.currentSize <= this.lowWatermark) {
      this.isPausedByBackpressure = false;
      return { item, signal: "RESUME_PRODUCER" };
    }

    return {
      item,
      signal: this.isPausedByBackpressure ? "PAUSE_PRODUCER" : "FLOW_NORMAL"
    };
  }

  public get size(): number {
    return this.currentSize;
  }

  public get paused(): boolean {
    return this.isPausedByBackpressure;
  }
}
