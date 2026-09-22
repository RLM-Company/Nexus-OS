import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ModelRequestSchema, ModelResponseSchema, StreamEventSchema } from "../src/index.js";

const baseRequest = {
  request_id: "req-1",
  project_id: "project-1",
  run_id: "run-1",
  agent_id: "manager",
  role: "manager",
  task_type: "chat_response",
  messages: [{ role: "user", content: "hello" }],
  constraints: {
    timeout_ms: 30_000,
    max_output_tokens: 1_000
  },
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
} as const;

const baseResponse = {
  request_id: "req-1",
  status: "succeeded",
  provider: "mock",
  model_requested: "manager",
  model_resolved: "manager",
  content: [{ type: "text", text: "done" }],
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    calculated_cost: 0,
    currency: "USD"
  },
  timing: {
    first_token_ms: 1,
    total_ms: 2
  },
  finish_reason: "stop",
  warnings: []
} as const;

describe("model request boundaries", () => {
  it.each([
    ["timeout_ms", 1],
    ["timeout_ms", 600_000],
    ["max_output_tokens", 1],
    ["max_output_tokens", 100_000]
  ] as const)("accepts %s boundary %d", (field, value) => {
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        constraints: { ...baseRequest.constraints, [field]: value }
      })
    ).toBe(true);
  });

  it.each([
    ["timeout_ms", 0],
    ["timeout_ms", 600_001],
    ["timeout_ms", 1.5],
    ["max_output_tokens", 0],
    ["max_output_tokens", 100_001],
    ["max_output_tokens", 1.5]
  ] as const)("rejects invalid %s value %d", (field, value) => {
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        constraints: { ...baseRequest.constraints, [field]: value }
      })
    ).toBe(false);
  });

  it.each(["system", "user", "assistant", "tool"] as const)("accepts message role %s", (role) => {
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        messages: [{ role, content: "message" }]
      })
    ).toBe(true);
  });

  it.each(["", "developer", "User", " user ", null, 1] as const)(
    "rejects invalid message role %j",
    (role) => {
      expect(
        Value.Check(ModelRequestSchema, {
          ...baseRequest,
          messages: [{ role, content: "message" }]
        })
      ).toBe(false);
    }
  );

  it("requires at least one message and rejects message extras", () => {
    expect(Value.Check(ModelRequestSchema, { ...baseRequest, messages: [] })).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        messages: [{ role: "user", content: "message", name: "unexpected" }]
      })
    ).toBe(false);
  });

  it.each([
    "streaming",
    "structured_output",
    "tool_calling",
    "vision"
  ] as const)("accepts model feature %s", (feature) => {
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: { ...baseRequest.routing, required_features: [feature] }
      })
    ).toBe(true);
  });

  it("rejects duplicate and unknown model features", () => {
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: {
          ...baseRequest.routing,
          required_features: ["streaming", "streaming"]
        }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: { ...baseRequest.routing, required_features: ["audio"] }
      })
    ).toBe(false);
  });

  it.each(["balanced", "quality", "latency", "cost"] as const)(
    "accepts optimize_for %s",
    (optimizeFor) => {
      expect(
        Value.Check(ModelRequestSchema, {
          ...baseRequest,
          routing: { ...baseRequest.routing, optimize_for: optimizeFor }
        })
      ).toBe(true);
    }
  );

  it.each(["", "speed", "Balanced", " balanced ", null, 1] as const)(
    "rejects invalid optimize_for %j",
    (optimizeFor) => {
      expect(
        Value.Check(ModelRequestSchema, {
          ...baseRequest,
          routing: { ...baseRequest.routing, optimize_for: optimizeFor }
        })
      ).toBe(false);
    }
  );

  it("enforces estimated token and max-cost bounds", () => {
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: { ...baseRequest.routing, estimated_input_tokens: 0 }
      })
    ).toBe(true);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: { ...baseRequest.routing, estimated_input_tokens: -1 }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: {
          ...baseRequest.routing,
          max_cost: { amount: 0, currency: "USD" }
        }
      })
    ).toBe(true);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: {
          ...baseRequest.routing,
          max_cost: { amount: -0.01, currency: "USD" }
        }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: {
          ...baseRequest.routing,
          max_cost: { amount: 1, currency: "EUR" }
        }
      })
    ).toBe(false);
  });

  it.each([
    ["request_id", 128, true],
    ["request_id", 129, false],
    ["project_id", 128, true],
    ["project_id", 129, false],
    ["run_id", 128, true],
    ["run_id", 129, false],
    ["agent_id", 128, true],
    ["agent_id", 129, false],
    ["role", 128, true],
    ["role", 129, false],
    ["task_type", 128, true],
    ["task_type", 129, false],
    ["idempotency_key", 256, true],
    ["idempotency_key", 257, false]
  ] as const)("checks %s max length %d", (field, length, expected) => {
    expect(Value.Check(ModelRequestSchema, { ...baseRequest, [field]: "a".repeat(length) })).toBe(
      expected
    );
  });

  it("rejects whitespace in canonical identifiers and routing names", () => {
    for (const [field, value] of [
      ["request_id", "req 1"],
      ["project_id", "project\t1"],
      ["run_id", "run\n1"],
      ["agent_id", "manager agent"],
      ["role", " manager"],
      ["task_type", "chat response"],
      ["idempotency_key", "stable key"]
    ] as const) {
      expect(Value.Check(ModelRequestSchema, { ...baseRequest, [field]: value })).toBe(false);
    }

    for (const [field, value] of [
      ["preferred_provider", " mock"],
      ["preferred_provider", "mock "],
      ["preferred_model_alias", "manager model"]
    ] as const) {
      expect(
        Value.Check(ModelRequestSchema, {
          ...baseRequest,
          routing: { ...baseRequest.routing, [field]: value }
        })
      ).toBe(false);
    }
  });

  it("rejects unexpected properties at every request layer", () => {
    expect(Value.Check(ModelRequestSchema, { ...baseRequest, unexpected: true })).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        constraints: { ...baseRequest.constraints, unexpected: true }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: { ...baseRequest.routing, unexpected: true }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: {
          ...baseRequest.routing,
          max_cost: { amount: 1, currency: "USD", unexpected: true }
        }
      })
    ).toBe(false);
  });
});

describe("model response boundaries", () => {
  it.each(["succeeded", "failed"] as const)("accepts status %s", (status) => {
    expect(Value.Check(ModelResponseSchema, { ...baseResponse, status })).toBe(true);
  });

  it.each(["", "success", "Succeeded", null, 1] as const)("rejects invalid status %j", (status) => {
    expect(Value.Check(ModelResponseSchema, { ...baseResponse, status })).toBe(false);
  });

  it("accepts zero-valued usage and timing boundaries", () => {
    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          calculated_cost: 0,
          currency: "RUB"
        },
        timing: {
          first_token_ms: 0,
          total_ms: 0
        }
      })
    ).toBe(true);
  });

  it("rejects negative or fractional integer counters", () => {
    for (const usage of [
      { ...baseResponse.usage, input_tokens: -1 },
      { ...baseResponse.usage, output_tokens: -1 },
      { ...baseResponse.usage, input_tokens: 1.5 },
      { ...baseResponse.usage, output_tokens: 1.5 }
    ]) {
      expect(Value.Check(ModelResponseSchema, { ...baseResponse, usage })).toBe(false);
    }

    for (const timing of [
      { ...baseResponse.timing, first_token_ms: -1 },
      { ...baseResponse.timing, total_ms: -1 },
      { ...baseResponse.timing, first_token_ms: 1.5 },
      { ...baseResponse.timing, total_ms: 1.5 }
    ]) {
      expect(Value.Check(ModelResponseSchema, { ...baseResponse, timing })).toBe(false);
    }
  });

  it("rejects invalid usage cost and currency", () => {
    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        usage: { ...baseResponse.usage, calculated_cost: -0.01 }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        usage: { ...baseResponse.usage, currency: "EUR" }
      })
    ).toBe(false);
  });

  it.each([
    ["provider", 128, true],
    ["provider", 129, false],
    ["model_requested", 256, true],
    ["model_requested", 257, false],
    ["model_resolved", 256, true],
    ["model_resolved", 257, false],
    ["finish_reason", 128, true],
    ["finish_reason", 129, false]
  ] as const)("checks response %s max length %d", (field, length, expected) => {
    expect(Value.Check(ModelResponseSchema, { ...baseResponse, [field]: "a".repeat(length) })).toBe(
      expected
    );
  });

  it("enforces warning count and warning length", () => {
    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        warnings: Array.from({ length: 50 }, (_, index) => `warning-${index}`)
      })
    ).toBe(true);

    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        warnings: Array.from({ length: 51 }, (_, index) => `warning-${index}`)
      })
    ).toBe(false);

    expect(Value.Check(ModelResponseSchema, { ...baseResponse, warnings: ["a".repeat(1_000)] })).toBe(
      true
    );
    expect(Value.Check(ModelResponseSchema, { ...baseResponse, warnings: ["a".repeat(1_001)] })).toBe(
      false
    );
    expect(Value.Check(ModelResponseSchema, { ...baseResponse, warnings: [""] })).toBe(false);
  });

  it("rejects response metadata whitespace and unexpected properties", () => {
    for (const [field, value] of [
      ["provider", "mock provider"],
      ["model_requested", "manager model"],
      ["model_resolved", "resolved model"]
    ] as const) {
      expect(Value.Check(ModelResponseSchema, { ...baseResponse, [field]: value })).toBe(false);
    }

    expect(Value.Check(ModelResponseSchema, { ...baseResponse, unexpected: true })).toBe(false);
    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        usage: { ...baseResponse.usage, unexpected: true }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        timing: { ...baseResponse.timing, unexpected: true }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelResponseSchema, {
        ...baseResponse,
        content: [{ type: "text", text: "done", unexpected: true }]
      })
    ).toBe(false);
  });
});

describe("stream event boundaries", () => {
  const validEvents = [
    {
      type: "run.started",
      data: { run_id: "run-1", timestamp: "2026-09-22T20:00:00.000Z" }
    },
    {
      type: "message.started",
      data: { run_id: "run-1", message_id: "message-1" }
    },
    {
      type: "message.delta",
      data: { run_id: "run-1", message_id: "message-1", seq: 0, delta: "" }
    },
    {
      type: "message.completed",
      data: { run_id: "run-1", message_id: "message-1", size: 0, finish_reason: "stop" }
    },
    {
      type: "run.completed",
      data: { run_id: "run-1", provider: "mock", model_resolved: "manager" }
    },
    {
      type: "run.failed",
      data: { run_id: "run-1", error_code: "PROVIDER_ERROR", retryable: false }
    },
    {
      type: "run.cancelled",
      data: { run_id: "run-1" }
    },
    {
      type: "heartbeat",
      data: { timestamp: "2026-09-22T20:00:00Z" }
    }
  ] as const;

  it.each(validEvents)("accepts event $type", (event) => {
    expect(Value.Check(StreamEventSchema, event)).toBe(true);
  });

  it("rejects unknown event type and extra top-level properties", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.paused",
        data: { run_id: "run-1" }
      })
    ).toBe(false);

    expect(
      Value.Check(StreamEventSchema, {
        type: "run.cancelled",
        data: { run_id: "run-1" },
        unexpected: true
      })
    ).toBe(false);
  });

  it("enforces non-negative integer sequence and size", () => {
    for (const seq of [-1, 0.5]) {
      expect(
        Value.Check(StreamEventSchema, {
          type: "message.delta",
          data: { run_id: "run-1", message_id: "message-1", seq, delta: "x" }
        })
      ).toBe(false);
    }

    for (const size of [-1, 0.5]) {
      expect(
        Value.Check(StreamEventSchema, {
          type: "message.completed",
          data: { run_id: "run-1", message_id: "message-1", size, finish_reason: "stop" }
        })
      ).toBe(false);
    }
  });

  it.each([
    ["provider", 128, true],
    ["provider", 129, false],
    ["model_resolved", 256, true],
    ["model_resolved", 257, false]
  ] as const)("checks run.completed %s max length %d", (field, length, expected) => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "mock", model_resolved: "manager", [field]: "a".repeat(length) }
      })
    ).toBe(expected);
  });

  it.each([
    ["finish_reason", "", false],
    ["finish_reason", "a", true],
    ["finish_reason", "a".repeat(128), true],
    ["finish_reason", "a".repeat(129), false],
    ["error_code", "", false],
    ["error_code", "ERROR", true],
    ["error_code", "a".repeat(128), true],
    ["error_code", "a".repeat(129), false]
  ] as const)("checks %s boundary", (field, value, expected) => {
    const event =
      field === "finish_reason"
        ? {
            type: "message.completed",
            data: {
              run_id: "run-1",
              message_id: "message-1",
              size: 1,
              finish_reason: value
            }
          }
        : {
            type: "run.failed",
            data: { run_id: "run-1", error_code: value, retryable: false }
          };

    expect(Value.Check(StreamEventSchema, event)).toBe(expected);
  });

  it("rejects whitespace in canonical completion metadata", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "mock provider", model_resolved: "manager" }
      })
    ).toBe(false);

    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "mock", model_resolved: "manager model" }
      })
    ).toBe(false);

    expect(
      Value.Check(StreamEventSchema, {
        type: "run.failed",
        data: { run_id: "run-1", error_code: "PROVIDER ERROR", retryable: false }
      })
    ).toBe(false);
  });

  it("rejects extra properties inside event data", () => {
    for (const event of validEvents) {
      expect(
        Value.Check(StreamEventSchema, {
          ...event,
          data: { ...event.data, unexpected: true }
        })
      ).toBe(false);
    }
  });
});
