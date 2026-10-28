import { describe, expect, it } from "vitest";
import type { ModelOutputCheckpoint } from "@cosmora/contracts";
import {
  MODEL_OUTPUT_CHECKPOINT_BYTES,
  ModelOutputCheckpointWriter
} from "../src/model-output-checkpoint.js";

describe("bounded model output recovery", () => {
  it("saves the first prefix and flushes the final buffered tail on cancellation", () => {
    const saved: ModelOutputCheckpoint[] = [];
    const writer = new ModelOutputCheckpointWriter(
      "run",
      "code",
      (value) => {
        saved.push(value);
        return true;
      },
      () => 1000
    );
    writer.update("prefix");
    writer.update("prefix plus tail");
    expect(saved).toHaveLength(1);
    writer.flush();
    writer.flush();
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({
      kind: "unvalidated_model_output",
      text: "prefix plus tail",
      stream_completed: false
    });
  });
  it("bounds UTF-8 bytes without breaking emoji or Russian characters", () => {
    let last!: ModelOutputCheckpoint;
    const writer = new ModelOutputCheckpointWriter("run", "draft", (value) => {
      last = value;
      return true;
    });
    const source = "я🚀".repeat(20000);
    writer.update(source);
    expect(Buffer.byteLength(last.text)).toBeLessThanOrEqual(MODEL_OUTPUT_CHECKPOINT_BYTES);
    expect(source.startsWith(last.text)).toBe(true);
    expect(last.text).not.toContain("\ufffd");
    expect(last).toMatchObject({ received_bytes: Buffer.byteLength(source), truncated: true });
  });
  it("persists after the byte or time threshold and labels a complete stream as unvalidated", () => {
    const saved: ModelOutputCheckpoint[] = [];
    let now = 1000;
    const writer = new ModelOutputCheckpointWriter(
      "run",
      "plan",
      (value) => {
        saved.push(value);
        return true;
      },
      () => now
    );
    writer.update("a");
    now += 1001;
    writer.update("ab");
    writer.update("a".repeat(9000));
    writer.update("a".repeat(9000), true);
    expect(saved).toHaveLength(4);
    expect(saved.at(-1)).toMatchObject({
      kind: "unvalidated_model_output",
      stream_completed: true
    });
  });
  it("does not advance durability after a refused write or throw into accounting cleanup", () => {
    let allowed = false,
      calls = 0;
    const saved: ModelOutputCheckpoint[] = [];
    const writer = new ModelOutputCheckpointWriter("run", "review", (value) => {
      calls++;
      if (!allowed) throw Error("OWNER_DATA_FENCED");
      saved.push(value);
      return true;
    });
    expect(() => writer.update("private output")).not.toThrow();
    expect(writer.flush()).toBe(false);
    allowed = true;
    expect(writer.flush()).toBe(true);
    expect(calls).toBe(3);
    expect(saved[0]?.text).toBe("private output");
  });
});
