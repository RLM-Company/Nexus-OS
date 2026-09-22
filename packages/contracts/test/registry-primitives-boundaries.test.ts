import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CurrencySchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  ModelFeatureSchema,
  ModelProtocolSchema,
  ModelRegistryDocumentSchema,
  ModelRegistryEntrySchema,
  ModelRouteRequestSchema
} from "../src/index.js";

const entry = {
  provider_id: "provider-1",
  model_id: "model-1",
  aliases: ["manager"],
  protocol: "mock",
  status: "active",
  roles: ["manager"],
  task_types: ["chat_response"],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: false,
    vision: false
  },
  context_window_tokens: 128_000,
  max_output_tokens: 8_000,
  quality_tier: 3,
  latency_tier: 3,
  pricing: {
    currency: "USD",
    input_per_million_tokens: 1,
    output_per_million_tokens: 2
  },
  privacy: {
    confidential_compatible: true,
    training_usage: "none",
    retention: "zero"
  },
  source: {
    kind: "static",
    verified_at: "2026-09-22T20:00:00.000Z",
    valid_until: "2026-10-22T20:00:00.000Z",
    reference: "provider evidence"
  }
} as const;

const route = {
  role: "manager",
  task_type: "chat_response",
  preferred_provider: null,
  preferred_model_alias: null,
  required_features: ["streaming"],
  confidential: false,
  estimated_input_tokens: 0,
  max_output_tokens: 1,
  max_cost: null,
  optimize_for: "balanced"
} as const;

describe("primitive boundaries", () => {
  it("checks entity ids, datetime shape and currencies", () => {
    expect(Value.Check(EntityIdSchema, "a")).toBe(true);
    expect(Value.Check(EntityIdSchema, "a".repeat(128))).toBe(true);
    expect(Value.Check(EntityIdSchema, "")).toBe(false);
    expect(Value.Check(EntityIdSchema, "a".repeat(129))).toBe(false);

    for (const value of [" ", "a b", "a\tb", "a\nb"]) {
      expect(Value.Check(EntityIdSchema, value)).toBe(false);
    }

    for (const value of ["2026-09-22T20:00:00Z", "2026-09-22T20:00:00.000Z"]) {
      expect(Value.Check(IsoDateTimeSchema, value)).toBe(true);
    }

    for (const value of [
      "",
      "2026-09-22",
      "2026-09-22T20:00:00",
      "2026-09-22 20:00:00Z",
      "2026-09-22T20:00:00+03:00",
      "2026-09-22T20:00:00.00Z"
    ]) {
      expect(Value.Check(IsoDateTimeSchema, value)).toBe(false);
    }

    for (const currency of ["USD", "RUB"]) {
      expect(Value.Check(CurrencySchema, currency)).toBe(true);
    }

    for (const currency of ["", "EUR", "usd", " RUB ", null, 1]) {
      expect(Value.Check(CurrencySchema, currency)).toBe(false);
    }
  });
});

describe("model registry entry boundaries", () => {
  it("checks protocols, features and status vocabularies", () => {
    for (const protocol of ["mock", "openai-compatible", "anthropic-compatible"]) {
      expect(Value.Check(ModelProtocolSchema, protocol)).toBe(true);
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, protocol })).toBe(true);
    }

    for (const protocol of ["", "openai", "Mock", " mock ", null, 1]) {
      expect(Value.Check(ModelProtocolSchema, protocol)).toBe(false);
    }

    for (const feature of ["streaming", "structured_output", "tool_calling", "vision"]) {
      expect(Value.Check(ModelFeatureSchema, feature)).toBe(true);
    }

    for (const feature of ["", "audio", "tools", "Streaming", null, 1]) {
      expect(Value.Check(ModelFeatureSchema, feature)).toBe(false);
    }

    for (const status of ["active", "disabled"]) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, status })).toBe(true);
    }

    for (const status of ["", "inactive", "Active", null, 1]) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, status })).toBe(false);
    }
  });

  it("checks entry string and numeric boundaries", () => {
    for (const [field, length, expected] of [
      ["provider_id", 1, true],
      ["provider_id", 128, true],
      ["provider_id", 129, false],
      ["model_id", 1, true],
      ["model_id", 256, true],
      ["model_id", 257, false]
    ] as const) {
      const candidate = { ...entry, [field]: "a".repeat(length) };
      expect(Value.Check(ModelRegistryEntrySchema, candidate)).toBe(expected);
    }

    expect(Value.Check(ModelRegistryEntrySchema, { ...entry, aliases: [] })).toBe(false);
    expect(Value.Check(ModelRegistryEntrySchema, { ...entry, aliases: ["a"] })).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, { ...entry, aliases: ["a".repeat(128)] })
    ).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, { ...entry, aliases: ["a".repeat(129)] })
    ).toBe(false);

    for (const [field, value, expected] of [
      ["context_window_tokens", 1, true],
      ["context_window_tokens", 0, false],
      ["context_window_tokens", 1.5, false],
      ["max_output_tokens", 1, true],
      ["max_output_tokens", 0, false],
      ["max_output_tokens", 1.5, false],
      ["quality_tier", 1, true],
      ["quality_tier", 5, true],
      ["quality_tier", 0, false],
      ["quality_tier", 6, false],
      ["latency_tier", 1, true],
      ["latency_tier", 5, true],
      ["latency_tier", 0, false],
      ["latency_tier", 6, false]
    ] as const) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, [field]: value })).toBe(expected);
    }
  });

  it("checks capabilities, pricing and privacy", () => {
    const capabilityFields = [
      "streaming",
      "structured_output",
      "tool_calling",
      "vision"
    ] as const;

    for (const field of capabilityFields) {
      for (const value of [true, false]) {
        const capabilities = { ...entry.capabilities, [field]: value };
        expect(Value.Check(ModelRegistryEntrySchema, { ...entry, capabilities })).toBe(true);
      }

      for (const value of [0, 1, "true", null]) {
        const capabilities = { ...entry.capabilities, [field]: value };
        expect(Value.Check(ModelRegistryEntrySchema, { ...entry, capabilities })).toBe(false);
      }
    }

    expect(Value.Check(ModelRegistryEntrySchema, { ...entry, pricing: null })).toBe(true);
    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...entry,
        pricing: {
          currency: "RUB",
          input_per_million_tokens: 0,
          output_per_million_tokens: 0
        }
      })
    ).toBe(true);

    for (const pricing of [
      { ...entry.pricing, input_per_million_tokens: -0.01 },
      { ...entry.pricing, output_per_million_tokens: -0.01 },
      { ...entry.pricing, currency: "EUR" },
      { ...entry.pricing, unexpected: true }
    ]) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, pricing })).toBe(false);
    }

    for (const training_usage of ["none", "opt_out", "unknown"]) {
      const privacy = { ...entry.privacy, training_usage };
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, privacy })).toBe(true);
    }

    for (const retention of ["zero", "limited", "unknown"]) {
      const privacy = { ...entry.privacy, retention };
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, privacy })).toBe(true);
    }
  });

  it("checks source evidence and strict entry shape", () => {
    for (const kind of ["static", "authorized_discovery"]) {
      const source = { ...entry.source, kind };
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, source })).toBe(true);
    }

    expect(
      Value.Check(ModelRegistryEntrySchema, {
        ...entry,
        source: {
          kind: "static",
          verified_at: null,
          valid_until: null,
          reference: null
        }
      })
    ).toBe(true);

    for (const source of [
      { ...entry.source, kind: "manual" },
      { ...entry.source, verified_at: "2026-09-22" },
      { ...entry.source, valid_until: "2026-10-22" },
      { ...entry.source, reference: "" },
      { ...entry.source, unexpected: true }
    ]) {
      expect(Value.Check(ModelRegistryEntrySchema, { ...entry, source })).toBe(false);
    }

    expect(Value.Check(ModelRegistryEntrySchema, { ...entry, api_key: "secret" })).toBe(false);
  });
});

describe("registry document and route boundaries", () => {
  it("checks registry document version and shape", () => {
    const document = {
      schema_version: 1,
      registry_version: "registry-1",
      generated_at: "2026-09-22T20:00:00.000Z",
      entries: [entry]
    } as const;

    expect(Value.Check(ModelRegistryDocumentSchema, document)).toBe(true);
    expect(Value.Check(ModelRegistryDocumentSchema, { ...document, entries: [] })).toBe(true);

    for (const schema_version of [0, 2, "1", null]) {
      expect(
        Value.Check(ModelRegistryDocumentSchema, { ...document, schema_version })
      ).toBe(false);
    }

    for (const [registry_version, expected] of [
      ["", false],
      ["a", true],
      ["a".repeat(64), true],
      ["a".repeat(65), false]
    ] as const) {
      expect(
        Value.Check(ModelRegistryDocumentSchema, { ...document, registry_version })
      ).toBe(expected);
    }

    expect(
      Value.Check(ModelRegistryDocumentSchema, {
        ...document,
        generated_at: "2026-09-22"
      })
    ).toBe(false);
    expect(Value.Check(ModelRegistryDocumentSchema, { ...document, secret: "x" })).toBe(false);
  });

  it("checks route request boundaries", () => {
    expect(Value.Check(ModelRouteRequestSchema, route)).toBe(true);

    for (const optimize_for of ["balanced", "quality", "latency", "cost"]) {
      expect(Value.Check(ModelRouteRequestSchema, { ...route, optimize_for })).toBe(true);
    }

    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...route,
        preferred_provider: "provider-1",
        preferred_model_alias: "manager"
      })
    ).toBe(true);

    for (const field of ["preferred_provider", "preferred_model_alias"] as const) {
      expect(Value.Check(ModelRouteRequestSchema, { ...route, [field]: "" })).toBe(false);
    }

    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...route,
        required_features: ["streaming", "vision"]
      })
    ).toBe(true);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...route,
        required_features: ["streaming", "streaming"]
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...route,
        required_features: ["audio"]
      })
    ).toBe(false);

    for (const [field, value, expected] of [
      ["estimated_input_tokens", 0, true],
      ["estimated_input_tokens", -1, false],
      ["estimated_input_tokens", 1.5, false],
      ["max_output_tokens", 1, true],
      ["max_output_tokens", 0, false],
      ["max_output_tokens", 1.5, false]
    ] as const) {
      expect(Value.Check(ModelRouteRequestSchema, { ...route, [field]: value })).toBe(expected);
    }

    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...route,
        max_cost: { amount: 0, currency: "USD" }
      })
    ).toBe(true);
    expect(
      Value.Check(ModelRouteRequestSchema, {
        ...route,
        max_cost: { amount: -0.01, currency: "USD" }
      })
    ).toBe(false);
    expect(Value.Check(ModelRouteRequestSchema, { ...route, unexpected: true })).toBe(false);
  });
});
