import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ActivateEmergencyStopRequestSchema,
  AuthCallbackSchema,
  AuthSessionBootstrapSchema,
  AuthStartRequestSchema,
  ExternalIdentitySchema,
  CompanionGateDecisionSchema,
  CompanionMessageProposalSchema,
  CompanionPreferencesSchema,
  CreateProjectRequestSchema,
  ModelRequestSchema,
  ModelResponseSchema,
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

  it("rejects malformed model envelope metadata", () => {
    const baseRequest = {
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
    };

    expect(Value.Check(ModelRequestSchema, { ...baseRequest, messages: [] })).toBe(false);
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        constraints: { ...baseRequest.constraints, timeout_ms: 600_001 }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        constraints: { ...baseRequest.constraints, max_output_tokens: 100_001 }
      })
    ).toBe(false);
    expect(
      Value.Check(ModelRequestSchema, {
        ...baseRequest,
        routing: { ...baseRequest.routing, preferred_provider: " mock " }
      })
    ).toBe(false);
    expect(Value.Check(ModelRequestSchema, { ...baseRequest, idempotency_key: "stable key" })).toBe(
      false
    );

    expect(
      Value.Check(ModelResponseSchema, {
        request_id: "req-1",
        status: "succeeded",
        provider: "mock",
        model_requested: "manager",
        model_resolved: "manager",
        content: [{ type: "text", text: "Готово" }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          calculated_cost: 0,
          currency: "USD"
        },
        timing: { first_token_ms: 1, total_ms: 2 },
        finish_reason: "",
        warnings: []
      })
    ).toBe(false);
  });

  it("accepts a typed streaming delta", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "message.delta",
        data: { run_id: "run-1", message_id: "message-1", seq: 0, delta: "Я" }
      })
    ).toBe(true);
  });

  it("rejects empty or non-canonical streaming completion metadata", () => {
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "", model_resolved: "model-1" }
      })
    ).toBe(false);
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: " mock ", model_resolved: "model-1" }
      })
    ).toBe(false);
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.completed",
        data: { run_id: "run-1", provider: "mock", model_resolved: "model 1" }
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
    expect(
      Value.Check(StreamEventSchema, {
        type: "run.failed",
        data: { run_id: "run-1", error_code: "PROVIDER ERROR", retryable: false }
      })
    ).toBe(false);
  });

  it("accepts bounded live-companion preferences and decisions", () => {
    expect(
      Value.Check(CompanionPreferencesSchema, {
        enabled: true,
        frequency: "balanced",
        max_proactive_per_day: 3,
        min_gap_minutes: 120,
        quiet_hours: { start: "22:00", end: "08:00", timezone: "Europe/Moscow" },
        suppress_when_active: true,
        backoff_after_unanswered: 3,
        allow_push: true,
        allow_telegram: false
      })
    ).toBe(true);

    expect(
      Value.Check(CompanionPreferencesSchema, {
        enabled: true,
        frequency: "balanced",
        max_proactive_per_day: 21,
        min_gap_minutes: 120,
        quiet_hours: { start: "22:00", end: "08:00", timezone: "Europe/Moscow" },
        suppress_when_active: true,
        backoff_after_unanswered: 3,
        allow_push: true,
        allow_telegram: false
      })
    ).toBe(false);

    expect(
      Value.Check(CompanionMessageProposalSchema, {
        proposal_id: "proposal-1",
        conversation_id: "conversation-1",
        trigger: "follow_up",
        message: "Как прошло собеседование?",
        preferred_surface: "in_app",
        created_at: "2026-09-19T18:00:00.000Z",
        expires_at: "2026-09-19T20:00:00.000Z"
      })
    ).toBe(true);

    expect(
      Value.Check(CompanionGateDecisionSchema, {
        proposal_id: "proposal-1",
        decision: "suppress",
        reason: "quiet_hours",
        surface: null,
        decided_at: "2026-09-19T18:00:00.000Z"
      })
    ).toBe(true);
  });

  it("accepts the external-auth bootstrap contract without raw tokens", () => {
    expect(
      Value.Check(AuthStartRequestSchema, {
        provider: "google",
        state: "state-value-123456",
        nonce: "nonce-value-123456",
        code_challenge: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~",
        code_challenge_method: "S256"
      })
    ).toBe(true);

    expect(
      Value.Check(AuthCallbackSchema, {
        provider: "telegram",
        code: "authorization-code",
        state: "state-value-123456"
      })
    ).toBe(true);

    expect(
      Value.Check(ExternalIdentitySchema, {
        provider: "telegram",
        subject: "telegram-user-1",
        verification_status: "verified",
        email: null,
        email_verified: false,
        phone_verified: true,
        display_name: "Kosmora User",
        linked_at: "2026-09-19T18:00:00.000Z",
        last_verified_at: "2026-09-19T18:00:00.000Z"
      })
    ).toBe(true);

    expect(
      Value.Check(AuthSessionBootstrapSchema, {
        session_id: "session-1",
        provider: "google",
        subject: "google-subject-1",
        assurance: "single_factor",
        issued_at: "2026-09-19T18:00:00.000Z",
        expires_at: "2026-09-19T19:00:00.000Z"
      })
    ).toBe(true);

    expect(
      Value.Check(AuthStartRequestSchema, {
        provider: "google",
        state: "short",
        nonce: "short",
        code_challenge: "short",
        code_challenge_method: "S256"
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
