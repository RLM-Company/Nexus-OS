import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ActivateEmergencyStopRequestSchema,
  CreateProjectRequestSchema,
  ModelRequestSchema,
  StreamEventSchema
} from "../src/index.js";

describe("shared contracts", () => {
  it("accepts a valid create-project request", () => {
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "Создай мне бизнес",
        client_message_id: "client-1"
      })
    ).toBe(true);
  });

  it("rejects an empty initial message", () => {
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "",
        client_message_id: "client-1"
      })
    ).toBe(false);
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "   ",
        client_message_id: "client-1"
      })
    ).toBe(false);
  });


  it("rejects whitespace in shared entity ids", () => {
    for (const clientMessageId of ["", "   ", "client id", "client\t1", "client\n1"]) {
      expect(
        Value.Check(CreateProjectRequestSchema, {
          initial_message: "Создай проект",
          client_message_id: clientMessageId
        })
      ).toBe(false);
    }
  });

  it("accepts a provider-neutral model request", () => {
    expect(
      Value.Check(ModelRequestSchema, {
        request_id: "req-1",
        project_id: "project-1",
        run_id: "run-1",
        agent_id: "manager",
        role: "manager",
        task_type: "chat_response",
        messages: [{ role: "user", content: "Привет" }],
        constraints: { timeout_ms: 30_000, max_output_tokens: 1_000 },
        routing: {
          preferred_provider: "mock",
          preferred_model_alias: "manager",
          fallback_allowed: false,
          required_features: ["streaming"],
          confidential: false,
          estimated_input_tokens: 100,
          max_cost: null,
          optimize_for: "balanced"
        },
        idempotency_key: "stable-key"
      })
    ).toBe(true);
  });

  it("accepts a typed streaming delta", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "message.delta",
        data: { run_id: "run-1", message_id: "message-1", seq: 0, delta: "Я" }
      })
    ).toBe(true);
  });

  it("rejects empty streaming completion metadata", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "", model_resolved: "model-1" }
      })
    ).toBe(false);
    expect(
      Value.Check(StreamEventSchema, {
        type: "message.completed",
        data: { run_id: "run-1", message_id: "message-1", size: 1, finish_reason: "" }
      })
    ).toBe(false);
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.failed",
        data: { run_id: "run-1", error_code: "", retryable: false }
      })
    ).toBe(false);
  });

  it("accepts the bounded emergency-stop transport shape", () => {
    expect(
      Value.Check(ActivateEmergencyStopRequestSchema, {
        scope: "project",
        project_id: "project-1",
        reason: "Unexpected external behavior"
      })
    ).toBe(true);
    expect(
      Value.Check(ActivateEmergencyStopRequestSchema, {
        scope: "unknown",
        reason: "Unknown scope"
      })
    ).toBe(false);
  });
});
