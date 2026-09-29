import { describe, expect, it } from "vitest";
import {
  compileModelIntelligenceObservation,
  rankModelIntelligenceObservations,
  validateModelIntelligenceObservation,
  type ModelIntelligenceObservation
} from "../src/index.js";

const now = Date.parse("2026-09-29T00:00:00.000Z");

const observation = (
  overrides: Partial<ModelIntelligenceObservation> = {}
): ModelIntelligenceObservation => ({
  observation_id: "manager-analysis-v1",
  provider_id: "provider-a",
  model_id: "model-a",
  registry_version: "registry-v1",
  evaluated_at: "2026-09-28T00:00:00.000Z",
  valid_until: "2026-10-28T00:00:00.000Z",
  task_family: "manager-analysis",
  dataset_version: "dataset-v1",
  prompt_version: "prompt-v1",
  config_version: "config-v1",
  sample_size: 100,
  metrics: {
    success_rate: 0.92,
    quality_score: 0.88,
    failure_rate: 0.08
  },
  latency_ms: {
    p50: 800,
    p95: 1800
  },
  usage: {
    input_tokens: 100_000,
    output_tokens: 25_000,
    cost_amount: 2.5,
    currency: "USD"
  },
  evidence_location: "fixture:model-eval-1",
  ...overrides
});

describe("Model Intelligence Graph observations", () => {
  it("accepts a complete, dated, non-expired observation", () => {
    expect(validateModelIntelligenceObservation(observation(), now)).toEqual([]);
  });

  it("compiles an observation into ModelVersion and Evaluation graph nodes", () => {
    const compiled = compileModelIntelligenceObservation({
      ownerId: "owner-1",
      projectId: "project-1",
      observation: observation(),
      now
    });

    expect(compiled.nodes.map((node) => node.kind)).toEqual(["ModelVersion", "Evaluation"]);
    expect(compiled.edges).toHaveLength(1);
    expect(compiled.edges[0]).toMatchObject({
      type: "EVALUATES",
      verification_status: "verified"
    });
  });

  it("rejects stale, impossible, and internally inconsistent observations", () => {
    expect(
      validateModelIntelligenceObservation(
        observation({
          valid_until: "2026-09-28T12:00:00.000Z",
          metrics: { success_rate: 0.9, failure_rate: 0.2, quality_score: 1.2 },
          latency_ms: { p50: 2_000, p95: 1_000 },
          usage: {
            input_tokens: 10.5,
            output_tokens: -1,
            cost_amount: 1,
            currency: null
          }
        }),
        now
      )
    ).toEqual(
      expect.arrayContaining([
        "Model intelligence observation is expired",
        "Model intelligence success_rate and failure_rate must sum to 1",
        "Model intelligence quality_score must be null or in 0..1",
        "Model intelligence latency p95 cannot be below p50",
        "Model intelligence token usage must use integer counts",
        "Model intelligence known cost requires currency"
      ])
    );
  });

  it("does not rank expired observations as current evidence", () => {
    const valid = observation();
    const expired = observation({
      observation_id: "expired",
      model_id: "model-expired",
      evaluated_at: "2026-08-01T00:00:00.000Z",
      valid_until: "2026-09-01T00:00:00.000Z",
      metrics: { success_rate: 1, failure_rate: 0, quality_score: 1 }
    });

    const ranked = rankModelIntelligenceObservations({
      observations: [expired, valid],
      taskFamily: "manager-analysis",
      now
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.model_id).toBe("model-a");
  });

  it("ranks only observations for the requested task family and remains recommend-only", () => {
    const qualityFirst = observation({
      observation_id: "quality-first",
      model_id: "quality-first",
      metrics: { success_rate: 0.9, failure_rate: 0.1, quality_score: 0.95 }
    });
    const latencyFirst = observation({
      observation_id: "latency-first",
      model_id: "latency-first",
      metrics: { success_rate: 0.99, failure_rate: 0.01, quality_score: 0.9 },
      latency_ms: { p50: 100, p95: 200 }
    });
    const unrelated = observation({
      observation_id: "other-task",
      model_id: "other-task",
      task_family: "research"
    });

    const ranked = rankModelIntelligenceObservations({
      observations: [latencyFirst, unrelated, qualityFirst],
      taskFamily: "manager-analysis",
      now
    });

    expect(ranked.map((item) => item.model_id)).toEqual(["quality-first", "latency-first"]);
    expect(ranked.every((item) => item.authority === "recommend_only")).toBe(true);
  });

  it("does not invent cost evidence when cost is unknown", () => {
    const unknown = observation({
      observation_id: "unknown-cost",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cost_amount: null,
        currency: null
      }
    });

    const ranked = rankModelIntelligenceObservations({
      observations: [unknown],
      taskFamily: "manager-analysis",
      now
    });

    expect(ranked[0]).toMatchObject({
      cost_amount: null,
      currency: null,
      authority: "recommend_only"
    });
  });
});
