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

const isRequest = (candidate: unknown) => Value.Check(ModelRequestSchema, candidate);
const isResponse = (candidate: unknown) => Value.Check(ModelResponseSchema, candidate);
const isEvent = (candidate: unknown) => Value.Check(StreamEventSchema, candidate);

describe("model request boundaries", () => {
  it("accepts request constraint boundaries", () => {
    const cases = [
      ["timeout_ms", 1],
      ["timeout_ms", 600_000],
      ["max_output_tokens", 1],
      ["max_output_tokens", 100_000]
    ] as const;

    for (const [field, value] of cases) {
      const constraints = { ...baseRequest.constraints, [field]: value };
      expect(isRequest({ ...baseRequest, constraints })).toBe(true);
    }
  });

  it("rejects invalid request constraint values", () => {
    const cases = [
      ["timeout_ms", 0],
      ["timeout_ms", 600_001],
      ["timeout_ms", 1.5],
      ["max_output_tokens", 0],
      ["max_output_tokens", 100_001],
      ["max_output_tokens", 1.5]
    ] as const;

    for (const [field, value] of cases) {
      const constraints = { ...baseRequest.constraints, [field]: value };
      expect(isRequest({ ...baseRequest, constraints })).toBe(false);
    }
  });

  it("accepts every supported message role", () => {
    const roles = ["system", "user", "assistant", "tool"] as const;

    for (const role of roles) {
      const messages = [{ role, content: "message" }];
      expect(isRequest({ ...baseRequest, messages })).toBe(true);
    }
  });

  it("rejects invalid message roles", () => {
    const roles = ["", "developer", "User", " user ", null, 1];

    for (const role of roles) {
      const messages = [{ role, content: "message" }];
      expect(isRequest({ ...baseRequest, messages })).toBe(false);
    }
  });

  it("requires at least one strict-shape message", () => {
    expect(isRequest({ ...baseRequest, messages: [] })).toBe(false);

    const messages = [{ role: "user", content: "message", name: "unexpected" }];
    expect(isRequest({ ...baseRequest, messages })).toBe(false);
  });

  it("accepts every supported required feature", () => {
    const features = ["streaming", "structured_output", "tool_calling", "vision"] as const;

    for (const feature of features) {
      const routing = {
        ...baseRequest.routing,
        required_features: [feature]
      };
      expect(isRequest({ ...baseRequest, routing })).toBe(true);
    }
  });

  it("rejects duplicate and unknown required features", () => {
    const duplicateRouting = {
      ...baseRequest.routing,
      required_features: ["streaming", "streaming"]
    };
    const unknownRouting = {
      ...baseRequest.routing,
      required_features: ["audio"]
    };

    expect(isRequest({ ...baseRequest, routing: duplicateRouting })).toBe(false);
    expect(isRequest({ ...baseRequest, routing: unknownRouting })).toBe(false);
  });

  it("accepts every routing optimization mode", () => {
    const modes = ["balanced", "quality", "latency", "cost"] as const;

    for (const optimizeFor of modes) {
      const routing = { ...baseRequest.routing, optimize_for: optimizeFor };
      expect(isRequest({ ...baseRequest, routing })).toBe(true);
    }
  });

  it("rejects invalid routing optimization modes", () => {
    const modes = ["", "speed", "Balanced", " balanced ", null, 1];

    for (const optimizeFor of modes) {
      const routing = { ...baseRequest.routing, optimize_for: optimizeFor };
      expect(isRequest({ ...baseRequest, routing })).toBe(false);
    }
  });

  it("enforces estimated-token and max-cost boundaries", () => {
    let routing = { ...baseRequest.routing, estimated_input_tokens: 0 };
    expect(isRequest({ ...baseRequest, routing })).toBe(true);

    routing = { ...baseRequest.routing, estimated_input_tokens: -1 };
    expect(isRequest({ ...baseRequest, routing })).toBe(false);

    const zeroCostRouting = {
      ...baseRequest.routing,
      max_cost: { amount: 0, currency: "USD" }
    };
    expect(isRequest({ ...baseRequest, routing: zeroCostRouting })).toBe(true);

    const negativeCostRouting = {
      ...baseRequest.routing,
      max_cost: { amount: -0.01, currency: "USD" }
    };
    expect(isRequest({ ...baseRequest, routing: negativeCostRouting })).toBe(false);

    const invalidCurrencyRouting = {
      ...baseRequest.routing,
      max_cost: { amount: 1, currency: "EUR" }
    };
    expect(isRequest({ ...baseRequest, routing: invalidCurrencyRouting })).toBe(false);
  });

  it("enforces identifier and request metadata max lengths", () => {
    const cases = [
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

    for (const [field, length, expected] of cases) {
      const candidate = { ...baseRequest, [field]: "a".repeat(length) };
      expect(isRequest(candidate)).toBe(expected);
    }
  });

  it("rejects whitespace in canonical identifiers", () => {
    const cases = [
      ["request_id", "req 1"],
      ["project_id", "project\t1"],
      ["run_id", "run\n1"],
      ["agent_id", "manager agent"],
      ["role", " manager"],
      ["task_type", "chat response"],
      ["idempotency_key", "stable key"]
    ] as const;

    for (const [field, value] of cases) {
      expect(isRequest({ ...baseRequest, [field]: value })).toBe(false);
    }
  });

  it("rejects whitespace in canonical routing names", () => {
    const cases = [
      ["preferred_provider", " mock"],
      ["preferred_provider", "mock "],
      ["preferred_model_alias", "manager model"]
    ] as const;

    for (const [field, value] of cases) {
      const routing = { ...baseRequest.routing, [field]: value };
      expect(isRequest({ ...baseRequest, routing })).toBe(false);
    }
  });

  it("rejects unexpected properties at every request layer", () => {
    expect(isRequest({ ...baseRequest, unexpected: true })).toBe(false);

    const constraints = {
      ...baseRequest.constraints,
      unexpected: true
    };
    expect(isRequest({ ...baseRequest, constraints })).toBe(false);

    const routing = {
      ...baseRequest.routing,
      unexpected: true
    };
    expect(isRequest({ ...baseRequest, routing })).toBe(false);

    const maxCostRouting = {
      ...baseRequest.routing,
      max_cost: {
        amount: 1,
        currency: "USD",
        unexpected: true
      }
    };
    expect(isRequest({ ...baseRequest, routing: maxCostRouting })).toBe(false);
  });
});

describe("model response boundaries", () => {
  it("accepts both response statuses", () => {
    for (const status of ["succeeded", "failed"] as const) {
      expect(isResponse({ ...baseResponse, status })).toBe(true);
    }
  });

  it("rejects invalid response statuses", () => {
    for (const status of ["", "success", "Succeeded", null, 1]) {
      expect(isResponse({ ...baseResponse, status })).toBe(false);
    }
  });

  it("accepts zero-valued usage and timing boundaries", () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      calculated_cost: 0,
      currency: "RUB"
    };
    const timing = {
      first_token_ms: 0,
      total_ms: 0
    };

    expect(isResponse({ ...baseResponse, usage, timing })).toBe(true);
  });

  it("rejects negative or fractional token counters", () => {
    const cases = [
      { ...baseResponse.usage, input_tokens: -1 },
      { ...baseResponse.usage, output_tokens: -1 },
      { ...baseResponse.usage, input_tokens: 1.5 },
      { ...baseResponse.usage, output_tokens: 1.5 }
    ];

    for (const usage of cases) {
      expect(isResponse({ ...baseResponse, usage })).toBe(false);
    }
  });

  it("rejects negative or fractional timing counters", () => {
    const cases = [
      { ...baseResponse.timing, first_token_ms: -1 },
      { ...baseResponse.timing, total_ms: -1 },
      { ...baseResponse.timing, first_token_ms: 1.5 },
      { ...baseResponse.timing, total_ms: 1.5 }
    ];

    for (const timing of cases) {
      expect(isResponse({ ...baseResponse, timing })).toBe(false);
    }
  });

  it("rejects invalid response cost and currency", () => {
    const negativeCost = {
      ...baseResponse.usage,
      calculated_cost: -0.01
    };
    expect(isResponse({ ...baseResponse, usage: negativeCost })).toBe(false);

    const invalidCurrency = {
      ...baseResponse.usage,
      currency: "EUR"
    };
    expect(isResponse({ ...baseResponse, usage: invalidCurrency })).toBe(false);
  });

  it("enforces response metadata max lengths", () => {
    const cases = [
      ["provider", 128, true],
      ["provider", 129, false],
      ["model_requested", 256, true],
      ["model_requested", 257, false],
      ["model_resolved", 256, true],
      ["model_resolved", 257, false],
      ["finish_reason", 128, true],
      ["finish_reason", 129, false]
    ] as const;

    for (const [field, length, expected] of cases) {
      const candidate = { ...baseResponse, [field]: "a".repeat(length) };
      expect(isResponse(candidate)).toBe(expected);
    }
  });

  it("enforces warning count boundaries", () => {
    const fiftyWarnings = Array.from({ length: 50 }, (_, index) => `warning-${index}`);
    const fiftyOneWarnings = Array.from({ length: 51 }, (_, index) => `warning-${index}`);

    expect(isResponse({ ...baseResponse, warnings: fiftyWarnings })).toBe(true);
    expect(isResponse({ ...baseResponse, warnings: fiftyOneWarnings })).toBe(false);
  });

  it("enforces warning length boundaries", () => {
    expect(isResponse({ ...baseResponse, warnings: ["a".repeat(1_000)] })).toBe(true);
    expect(isResponse({ ...baseResponse, warnings: ["a".repeat(1_001)] })).toBe(false);
    expect(isResponse({ ...baseResponse, warnings: [""] })).toBe(false);
  });

  it("rejects response metadata whitespace", () => {
    const cases = [
      ["provider", "mock provider"],
      ["model_requested", "manager model"],
      ["model_resolved", "resolved model"]
    ] as const;

    for (const [field, value] of cases) {
      expect(isResponse({ ...baseResponse, [field]: value })).toBe(false);
    }
  });

  it("rejects unexpected response properties", () => {
    expect(isResponse({ ...baseResponse, unexpected: true })).toBe(false);

    const usage = { ...baseResponse.usage, unexpected: true };
    expect(isResponse({ ...baseResponse, usage })).toBe(false);

    const timing = { ...baseResponse.timing, unexpected: true };
    expect(isResponse({ ...baseResponse, timing })).toBe(false);

    const content = [{ type: "text", text: "done", unexpected: true }];
    expect(isResponse({ ...baseResponse, content })).toBe(false);
  });
});

describe("stream event boundaries", () => {
  const validEvents = [
    {
      type: "run.started",
      data: {
        run_id: "run-1",
        timestamp: "2026-09-22T20:00:00.000Z"
      }
    },
    {
      type: "message.started",
      data: {
        run_id: "run-1",
        message_id: "message-1"
      }
    },
    {
      type: "message.delta",
      data: {
        run_id: "run-1",
        message_id: "message-1",
        seq: 0,
        delta: ""
      }
    },
    {
      type: "message.completed",
      data: {
        run_id: "run-1",
        message_id: "message-1",
        size: 0,
        finish_reason: "stop"
      }
    },
    {
      type: "run.completed",
      data: {
        run_id: "run-1",
        provider: "mock",
        model_resolved: "manager"
      }
    },
    {
      type: "run.failed",
      data: {
        run_id: "run-1",
        error_code: "PROVIDER_ERROR",
        retryable: false
      }
    },
    {
      type: "run.cancelled",
      data: {
        run_id: "run-1"
      }
    },
    {
      type: "heartbeat",
      data: {
        timestamp: "2026-09-22T20:00:00Z"
      }
    }
  ] as const;

  it("accepts every current stream event variant", () => {
    for (const event of validEvents) {
      expect(isEvent(event)).toBe(true);
    }
  });

  it("rejects unknown event types and extra top-level properties", () => {
    const unknown = {
      type: "run.paused",
      data: { run_id: "run-1" }
    };
    expect(isEvent(unknown)).toBe(false);

    const extra = {
      type: "run.cancelled",
      data: { run_id: "run-1" },
      unexpected: true
    };
    expect(isEvent(extra)).toBe(false);
  });

  it("enforces non-negative integer delta sequence", () => {
    for (const seq of [-1, 0.5]) {
      const event = {
        type: "message.delta",
        data: {
          run_id: "run-1",
          message_id: "message-1",
          seq,
          delta: "x"
        }
      };
      expect(isEvent(event)).toBe(false);
    }
  });

  it("enforces non-negative integer completed size", () => {
    for (const size of [-1, 0.5]) {
      const event = {
        type: "message.completed",
        data: {
          run_id: "run-1",
          message_id: "message-1",
          size,
          finish_reason: "stop"
        }
      };
      expect(isEvent(event)).toBe(false);
    }
  });

  it("enforces run completion metadata max lengths", () => {
    const cases = [
      ["provider", 128, true],
      ["provider", 129, false],
      ["model_resolved", 256, true],
      ["model_resolved", 257, false]
    ] as const;

    for (const [field, length, expected] of cases) {
      const data = {
        run_id: "run-1",
        provider: "mock",
        model_resolved: "manager",
        [field]: "a".repeat(length)
      };
      expect(isEvent({ type: "run.completed", data })).toBe(expected);
    }
  });

  it("enforces finish reason boundaries", () => {
    const cases = [
      ["", false],
      ["a", true],
      ["a".repeat(128), true],
      ["a".repeat(129), false]
    ] as const;

    for (const [finishReason, expected] of cases) {
      const data = {
        run_id: "run-1",
        message_id: "message-1",
        size: 1,
        finish_reason: finishReason
      };
      expect(isEvent({ type: "message.completed", data })).toBe(expected);
    }
  });

  it("enforces error code boundaries", () => {
    const cases = [
      ["", false],
      ["ERROR", true],
      ["a".repeat(128), true],
      ["a".repeat(129), false]
    ] as const;

    for (const [errorCode, expected] of cases) {
      const data = {
        run_id: "run-1",
        error_code: errorCode,
        retryable: false
      };
      expect(isEvent({ type: "run.failed", data })).toBe(expected);
    }
  });

  it("rejects whitespace in canonical completion metadata", () => {
    const providerData = {
      run_id: "run-1",
      provider: "mock provider",
      model_resolved: "manager"
    };
    expect(isEvent({ type: "run.completed", data: providerData })).toBe(false);

    const modelData = {
      run_id: "run-1",
      provider: "mock",
      model_resolved: "manager model"
    };
    expect(isEvent({ type: "run.completed", data: modelData })).toBe(false);

    const failureData = {
      run_id: "run-1",
      error_code: "PROVIDER ERROR",
      retryable: false
    };
    expect(isEvent({ type: "run.failed", data: failureData })).toBe(false);
  });

  it("rejects extra properties inside every event data shape", () => {
    for (const event of validEvents) {
      const data = { ...event.data, unexpected: true };
      expect(isEvent({ ...event, data })).toBe(false);
    }
  });
});
