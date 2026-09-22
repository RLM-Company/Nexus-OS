import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ModelRequestSchema, ModelResponseSchema, StreamEventSchema } from "../src/index.js";

const request = {
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

const response = {
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
  it("checks integer request limits", () => {
    const valid = [
      ["timeout_ms", 1],
      ["timeout_ms", 600_000],
      ["max_output_tokens", 1],
      ["max_output_tokens", 100_000]
    ] as const;

    const invalid = [
      ["timeout_ms", 0],
      ["timeout_ms", 600_001],
      ["timeout_ms", 1.5],
      ["max_output_tokens", 0],
      ["max_output_tokens", 100_001],
      ["max_output_tokens", 1.5]
    ] as const;

    for (const [field, value] of valid) {
      const constraints = { ...request.constraints, [field]: value };
      expect(Value.Check(ModelRequestSchema, { ...request, constraints })).toBe(true);
    }

    for (const [field, value] of invalid) {
      const constraints = { ...request.constraints, [field]: value };
      expect(Value.Check(ModelRequestSchema, { ...request, constraints })).toBe(false);
    }
  });

  it("checks message roles and strict message shape", () => {
    for (const role of ["system", "user", "assistant", "tool"]) {
      const messages = [{ role, content: "message" }];
      expect(Value.Check(ModelRequestSchema, { ...request, messages })).toBe(true);
    }

    for (const role of ["", "developer", "User", " user ", null, 1]) {
      const messages = [{ role, content: "message" }];
      expect(Value.Check(ModelRequestSchema, { ...request, messages })).toBe(false);
    }

    expect(Value.Check(ModelRequestSchema, { ...request, messages: [] })).toBe(false);
    expect(
      Value.Check(ModelRequestSchema, {
        ...request,
        messages: [{ role: "user", content: "message", name: "unexpected" }]
      })
    ).toBe(false);
  });

  it("checks routing features and optimization values", () => {
    for (const feature of ["streaming", "structured_output", "tool_calling", "vision"]) {
      const routing = { ...request.routing, required_features: [feature] };
      expect(Value.Check(ModelRequestSchema, { ...request, routing })).toBe(true);
    }

    for (const optimize_for of ["balanced", "quality", "latency", "cost"]) {
      const routing = { ...request.routing, optimize_for };
      expect(Value.Check(ModelRequestSchema, { ...request, routing })).toBe(true);
    }

    const duplicateFeatures = {
      ...request.routing,
      required_features: ["streaming", "streaming"]
    };
    expect(Value.Check(ModelRequestSchema, { ...request, routing: duplicateFeatures })).toBe(false);

    const unknownFeature = { ...request.routing, required_features: ["audio"] };
    expect(Value.Check(ModelRequestSchema, { ...request, routing: unknownFeature })).toBe(false);

    for (const optimize_for of ["", "speed", "Balanced", " balanced ", null, 1]) {
      const routing = { ...request.routing, optimize_for };
      expect(Value.Check(ModelRequestSchema, { ...request, routing })).toBe(false);
    }
  });

  it("checks route numeric and cost boundaries", () => {
    let routing = { ...request.routing, estimated_input_tokens: 0 };
    expect(Value.Check(ModelRequestSchema, { ...request, routing })).toBe(true);

    routing = { ...request.routing, estimated_input_tokens: -1 };
    expect(Value.Check(ModelRequestSchema, { ...request, routing })).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...request,
        routing: {
          ...request.routing,
          max_cost: { amount: 0, currency: "USD" }
        }
      })
    ).toBe(true);

    expect(
      Value.Check(ModelRequestSchema, {
        ...request,
        routing: {
          ...request.routing,
          max_cost: { amount: -0.01, currency: "USD" }
        }
      })
    ).toBe(false);

    expect(
      Value.Check(ModelRequestSchema, {
        ...request,
        routing: {
          ...request.routing,
          max_cost: { amount: 1, currency: "EUR" }
        }
      })
    ).toBe(false);
  });

  it("checks identifier limits and strict nesting", () => {
    const lengthCases = [
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
    ] as const;

    for (const [field, length, expected] of lengthCases) {
      const candidate = { ...request, [field]: "a".repeat(length) };
      expect(Value.Check(ModelRequestSchema, candidate)).toBe(expected);
    }

    for (const [field, value] of [
      ["request_id", "req 1"],
      ["project_id", "project\t1"],
      ["run_id", "run\n1"],
      ["agent_id", "manager agent"],
      ["role", " manager"],
      ["task_type", "chat response"],
      ["idempotency_key", "stable key"]
    ] as const) {
      expect(Value.Check(ModelRequestSchema, { ...request, [field]: value })).toBe(false);
    }

    expect(Value.Check(ModelRequestSchema, { ...request, unexpected: true })).toBe(false);
    expect(
      Value.Check(ModelRequestSchema, {
        ...request,
        constraints: { ...request.constraints, unexpected: true }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRequestSchema, {
        ...request,
        routing: { ...request.routing, unexpected: true }
      })
    ).toBe(false);
  });
});

describe("model response boundaries", () => {
  it("checks status, counters, currency and metadata limits", () => {
    for (const status of ["succeeded", "failed"]) {
      expect(Value.Check(ModelResponseSchema, { ...response, status })).toBe(true);
    }

    for (const status of ["", "success", "Succeeded", null, 1]) {
      expect(Value.Check(ModelResponseSchema, { ...response, status })).toBe(false);
    }

    expect(
      Value.Check(ModelResponseSchema, {
        ...response,
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

    for (const usage of [
      { ...response.usage, input_tokens: -1 },
      { ...response.usage, output_tokens: -1 },
      { ...response.usage, input_tokens: 1.5 },
      { ...response.usage, calculated_cost: -0.01 },
      { ...response.usage, currency: "EUR" }
    ]) {
      expect(Value.Check(ModelResponseSchema, { ...response, usage })).toBe(false);
    }

    for (const timing of [
      { ...response.timing, first_token_ms: -1 },
      { ...response.timing, total_ms: -1 },
      { ...response.timing, first_token_ms: 1.5 }
    ]) {
      expect(Value.Check(ModelResponseSchema, { ...response, timing })).toBe(false);
    }

    for (const [field, length, expected] of [
      ["provider", 128, true],
      ["provider", 129, false],
      ["model_requested", 256, true],
      ["model_requested", 257, false],
      ["model_resolved", 256, true],
      ["model_resolved", 257, false],
      ["finish_reason", 128, true],
      ["finish_reason", 129, false]
    ] as const) {
      const candidate = { ...response, [field]: "a".repeat(length) };
      expect(Value.Check(ModelResponseSchema, candidate)).toBe(expected);
    }
  });

  it("checks warning limits and strict response shapes", () => {
    const warnings50 = Array.from({ length: 50 }, (_, index) => `warning-${index}`);
    const warnings51 = Array.from({ length: 51 }, (_, index) => `warning-${index}`);

    expect(Value.Check(ModelResponseSchema, { ...response, warnings: warnings50 })).toBe(true);
    expect(Value.Check(ModelResponseSchema, { ...response, warnings: warnings51 })).toBe(false);
    expect(
      Value.Check(ModelResponseSchema, { ...response, warnings: ["a".repeat(1_000)] })
    ).toBe(true);
    expect(
      Value.Check(ModelResponseSchema, { ...response, warnings: ["a".repeat(1_001)] })
    ).toBe(false);
    expect(Value.Check(ModelResponseSchema, { ...response, warnings: [""] })).toBe(false);

    expect(Value.Check(ModelResponseSchema, { ...response, unexpected: true })).toBe(false);
    expect(
      Value.Check(ModelResponseSchema, {
        ...response,
        content: [{ type: "text", text: "done", unexpected: true }]
      })
    ).toBe(false);
  });
});

describe("stream event boundaries", () => {
  const events = [
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

  it("accepts every current event shape", () => {
    for (const event of events) {
      expect(Value.Check(StreamEventSchema, event)).toBe(true);
    }
  });

  it("checks counters, metadata and strict event data", () => {
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
          data: {
            run_id: "run-1",
            message_id: "message-1",
            size,
            finish_reason: "stop"
          }
        })
      ).toBe(false);
    }

    for (const [field, length, expected] of [
      ["provider", 128, true],
      ["provider", 129, false],
      ["model_resolved", 256, true],
      ["model_resolved", 257, false]
    ] as const) {
      const data = {
        run_id: "run-1",
        provider: "mock",
        model_resolved: "manager",
        [field]: "a".repeat(length)
      };
      expect(Value.Check(StreamEventSchema, { type: "run.completed", data })).toBe(expected);
    }

    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "mock provider", model_resolved: "manager" }
      })
    ).toBe(false);

    expect(
      Value.Check(StreamEventSchema, {
        type: "run.failed",
        data: { run_id: "run-1", error_code: "PROVIDER ERROR", retryable: false }
      })
    ).toBe(false);

    for (const event of events) {
      const candidate = {
        ...event,
        data: { ...event.data, unexpected: true }
      };
      expect(Value.Check(StreamEventSchema, candidate)).toBe(false);
    }
  });

  it("rejects unknown events and checks completion text limits", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.paused",
        data: { run_id: "run-1" }
      })
    ).toBe(false);

    for (const [value, expected] of [
      ["", false],
      ["a", true],
      ["a".repeat(128), true],
      ["a".repeat(129), false]
    ] as const) {
      expect(
        Value.Check(StreamEventSchema, {
          type: "message.completed",
          data: {
            run_id: "run-1",
            message_id: "message-1",
            size: 1,
            finish_reason: value
          }
        })
      ).toBe(expected);

      expect(
        Value.Check(StreamEventSchema, {
          type: "run.failed",
          data: { run_id: "run-1", error_code: value, retryable: false }
        })
      ).toBe(expected);
    }
  });
});
