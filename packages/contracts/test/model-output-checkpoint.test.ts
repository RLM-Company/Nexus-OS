import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ModelOutputCheckpointSchema } from "../src/model-output-checkpoint.js";

describe("unvalidated model output recovery contract", () => {
  const checkpoint = {
    kind: "unvalidated_model_output",
    model_run_id: "model-run-1",
    stage: "code",
    text: '{"files":',
    received_bytes: 9,
    truncated: false,
    stream_completed: false,
    updated_at: "2026-10-28T12:00:00.000Z"
  };
  it("permits incomplete raw output without implying validation or execution authority", () => {
    expect(Value.Check(ModelOutputCheckpointSchema, checkpoint)).toBe(true);
    for (const invalid of [
      { ...checkpoint, kind: "validated_proposal" },
      { ...checkpoint, approved: true },
      { ...checkpoint, stage: "publish" },
      { ...checkpoint, received_bytes: -1 },
      { ...checkpoint, text: "x".repeat(32769) }
    ])
      expect(Value.Check(ModelOutputCheckpointSchema, invalid)).toBe(false);
  });
});
