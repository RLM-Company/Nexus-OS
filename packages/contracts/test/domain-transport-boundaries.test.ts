import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  CreateGeneralChatRequestSchema,
  CreateMessageRequestSchema,
  CreateProjectRequestSchema,
  ErrorCodeSchema,
  GeneralChatDetailResponseSchema,
  GeneralChatListResponseSchema,
  GeneralChatMessageAcceptedResponseSchema,
  GeneralChatMessageSchema,
  GeneralChatSchema,
  GeneralChatSummarySchema,
  HealthResponseSchema,
  MessageAcceptedResponseSchema,
  MessageRoleSchema,
  MessageSchema,
  MessageStatusSchema,
  OnboardingStatusSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  ProjectSchema,
  ProjectStatusSchema,
  ProjectSummarySchema,
  RunCancelResponseSchema,
  RunStatusSchema
} from "../src/index.js";

const timestamp = "2026-09-22T20:00:00.000Z";

const project = {
  id: "project-1",
  title: "Project",
  status: "ACTIVE",
  created_at: timestamp,
  updated_at: timestamp
} as const;

const projectMessage = {
  id: "message-1",
  project_id: "project-1",
  chat_id: "chat-1",
  role: "user",
  content_type: "text",
  content: "hello",
  status: "completed",
  reply_to_message_id: null,
  run_id: null,
  error_code: null,
  created_at: timestamp,
  updated_at: timestamp
} as const;

const generalChat = {
  id: "chat-1",
  title: "Chat",
  created_at: timestamp,
  updated_at: timestamp
} as const;

const generalMessage = {
  id: "message-1",
  chat_id: "chat-1",
  role: "user",
  content_type: "text",
  content: "hello",
  status: "completed",
  run_id: null,
  error_code: null,
  created_at: timestamp,
  updated_at: timestamp
} as const;

const isProject = (candidate: unknown) => Value.Check(ProjectSchema, candidate);
const isMessage = (candidate: unknown) => Value.Check(MessageSchema, candidate);
const isGeneralChat = (candidate: unknown) => Value.Check(GeneralChatSchema, candidate);
const isGeneralMessage = (candidate: unknown) => Value.Check(GeneralChatMessageSchema, candidate);

describe("domain enum boundaries", () => {
  it("accepts all current enum values", () => {
    for (const status of ["not_started", "in_progress", "completed"]) {
      expect(Value.Check(OnboardingStatusSchema, status)).toBe(true);
    }
    for (const status of ["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"]) {
      expect(Value.Check(ProjectStatusSchema, status)).toBe(true);
    }
    for (const role of ["user", "assistant", "system_event"]) {
      expect(Value.Check(MessageRoleSchema, role)).toBe(true);
    }
    for (const status of ["pending", "streaming", "completed", "failed", "cancelled"]) {
      expect(Value.Check(MessageStatusSchema, status)).toBe(true);
    }
    for (const status of ["queued", "running", "succeeded", "failed", "cancelled"]) {
      expect(Value.Check(RunStatusSchema, status)).toBe(true);
    }
  });

  it("rejects unknown enum values", () => {
    expect(Value.Check(OnboardingStatusSchema, "done")).toBe(false);
    expect(Value.Check(ProjectStatusSchema, "active")).toBe(false);
    expect(Value.Check(MessageRoleSchema, "tool")).toBe(false);
    expect(Value.Check(MessageStatusSchema, "success")).toBe(false);
    expect(Value.Check(RunStatusSchema, "completed")).toBe(false);
  });
});

describe("project request boundaries", () => {
  it("enforces create-project message boundaries", () => {
    const valid = ["x", "x".repeat(100_000)];
    for (const initialMessage of valid) {
      const candidate = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateProjectRequestSchema, candidate)).toBe(true);
    }

    const invalid = ["", "   ", "\t\n", "x".repeat(100_001)];
    for (const initialMessage of invalid) {
      const candidate = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateProjectRequestSchema, candidate)).toBe(false);
    }
  });

  it("enforces create-message content boundaries", () => {
    const valid = ["x", "x".repeat(100_000)];
    for (const content of valid) {
      const candidate = {
        content,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateMessageRequestSchema, candidate)).toBe(true);
    }

    const invalid = ["", "   ", "\t\n", "x".repeat(100_001)];
    for (const content of invalid) {
      const candidate = {
        content,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateMessageRequestSchema, candidate)).toBe(false);
    }
  });

  it("rejects malformed client ids and extra request properties", () => {
    const projectRequest = {
      initial_message: "hello",
      client_message_id: "client id"
    };
    expect(Value.Check(CreateProjectRequestSchema, projectRequest)).toBe(false);

    const projectExtra = {
      initial_message: "hello",
      client_message_id: "client-1",
      unexpected: true
    };
    expect(Value.Check(CreateProjectRequestSchema, projectExtra)).toBe(false);

    const messageRequest = {
      content: "hello",
      client_message_id: "client id"
    };
    expect(Value.Check(CreateMessageRequestSchema, messageRequest)).toBe(false);

    const messageExtra = {
      content: "hello",
      client_message_id: "client-1",
      unexpected: true
    };
    expect(Value.Check(CreateMessageRequestSchema, messageExtra)).toBe(false);
  });
});

describe("project transport boundaries", () => {
  it("accepts every project status", () => {
    for (const status of ["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"]) {
      expect(isProject({ ...project, status })).toBe(true);
    }
  });

  it("enforces project title boundaries", () => {
    const cases = [
      [1, true],
      [160, true],
      [0, false],
      [161, false]
    ] as const;

    for (const [length, expected] of cases) {
      expect(isProject({ ...project, title: "x".repeat(length) })).toBe(expected);
    }
  });

  it("rejects malformed project ids, timestamps and extras", () => {
    expect(isProject({ ...project, id: "project id" })).toBe(false);
    expect(isProject({ ...project, created_at: "2026-09-22" })).toBe(false);
    expect(isProject({ ...project, unexpected: true })).toBe(false);
  });

  it("enforces project summary preview boundaries", () => {
    const summary = {
      id: "project-1",
      title: "Project",
      status: "ACTIVE",
      updated_at: timestamp,
      last_message_preview: null
    } as const;

    expect(Value.Check(ProjectSummarySchema, summary)).toBe(true);
    const maxPreview = { ...summary, last_message_preview: "x".repeat(240) };
    expect(Value.Check(ProjectSummarySchema, maxPreview)).toBe(true);
    const tooLong = { ...summary, last_message_preview: "x".repeat(241) };
    expect(Value.Check(ProjectSummarySchema, tooLong)).toBe(false);
  });

  it("enforces project list and detail strict shapes", () => {
    const summary = {
      id: "project-1",
      title: "Project",
      status: "ACTIVE",
      updated_at: timestamp,
      last_message_preview: "hello"
    } as const;

    expect(Value.Check(ProjectListResponseSchema, { items: [summary] })).toBe(true);

    const detail = {
      project,
      chat_id: "chat-1",
      messages: [projectMessage]
    };
    expect(Value.Check(ProjectDetailResponseSchema, detail)).toBe(true);
    expect(Value.Check(ProjectListResponseSchema, { items: [summary], unexpected: true })).toBe(
      false
    );
    expect(Value.Check(ProjectDetailResponseSchema, { ...detail, unexpected: true })).toBe(false);
  });
});

describe("project message transport boundaries", () => {
  it("accepts every project message role and status", () => {
    for (const role of ["user", "assistant", "system_event"]) {
      expect(isMessage({ ...projectMessage, role })).toBe(true);
    }
    for (const status of ["pending", "streaming", "completed", "failed", "cancelled"]) {
      expect(isMessage({ ...projectMessage, status })).toBe(true);
    }
  });

  it("accepts nullable references and arbitrary text content", () => {
    expect(isMessage(projectMessage)).toBe(true);
    const linked = {
      ...projectMessage,
      reply_to_message_id: "message-0",
      run_id: "run-1",
      error_code: "PROVIDER_ERROR",
      content: ""
    };
    expect(isMessage(linked)).toBe(true);
  });

  it("rejects non-text content type, malformed refs and extras", () => {
    expect(isMessage({ ...projectMessage, content_type: "image" })).toBe(false);
    expect(isMessage({ ...projectMessage, run_id: "run id" })).toBe(false);
    expect(isMessage({ ...projectMessage, reply_to_message_id: "message id" })).toBe(false);
    expect(isMessage({ ...projectMessage, unexpected: true })).toBe(false);
  });

  it("enforces message accepted response strictness", () => {
    const accepted = {
      project,
      chat_id: "chat-1",
      user_message: projectMessage,
      run_id: "run-1",
      stream_url: "/api/v1/runs/run-1/events"
    };

    expect(Value.Check(MessageAcceptedResponseSchema, accepted)).toBe(true);
    expect(Value.Check(MessageAcceptedResponseSchema, { ...accepted, stream_url: "" })).toBe(false);
    expect(Value.Check(MessageAcceptedResponseSchema, { ...accepted, unexpected: true })).toBe(
      false
    );
  });

  it("accepts only the cancelled run response literal", () => {
    const cancelled = { run_id: "run-1", status: "cancelled" };
    expect(Value.Check(RunCancelResponseSchema, cancelled)).toBe(true);
    expect(Value.Check(RunCancelResponseSchema, { ...cancelled, status: "failed" })).toBe(false);
    expect(Value.Check(RunCancelResponseSchema, { ...cancelled, unexpected: true })).toBe(false);
  });
});

describe("general chat transport boundaries", () => {
  it("enforces chat title boundaries and strict shape", () => {
    expect(isGeneralChat(generalChat)).toBe(true);
    expect(isGeneralChat({ ...generalChat, title: "x".repeat(160) })).toBe(true);
    expect(isGeneralChat({ ...generalChat, title: "" })).toBe(false);
    expect(isGeneralChat({ ...generalChat, title: "x".repeat(161) })).toBe(false);
    expect(isGeneralChat({ ...generalChat, unexpected: true })).toBe(false);
  });

  it("enforces general chat summary preview boundaries", () => {
    const summary = {
      ...generalChat,
      last_message_preview: null
    };

    expect(Value.Check(GeneralChatSummarySchema, summary)).toBe(true);
    const maxPreview = { ...summary, last_message_preview: "x".repeat(240) };
    expect(Value.Check(GeneralChatSummarySchema, maxPreview)).toBe(true);
    const tooLong = { ...summary, last_message_preview: "x".repeat(241) };
    expect(Value.Check(GeneralChatSummarySchema, tooLong)).toBe(false);
  });

  it("accepts only user and assistant general-message roles", () => {
    for (const role of ["user", "assistant"]) {
      expect(isGeneralMessage({ ...generalMessage, role })).toBe(true);
    }
    for (const role of ["system_event", "tool", "", null]) {
      expect(isGeneralMessage({ ...generalMessage, role })).toBe(false);
    }
  });

  it("accepts nullable run and error fields with strict shape", () => {
    expect(isGeneralMessage(generalMessage)).toBe(true);
    const linked = {
      ...generalMessage,
      run_id: "run-1",
      error_code: "PROVIDER_ERROR",
      content: ""
    };
    expect(isGeneralMessage(linked)).toBe(true);
    expect(isGeneralMessage({ ...generalMessage, unexpected: true })).toBe(false);
  });

  it("enforces general chat create request boundaries", () => {
    const valid = ["x", "x".repeat(100_000)];
    for (const initialMessage of valid) {
      const candidate = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateGeneralChatRequestSchema, candidate)).toBe(true);
    }

    const invalid = ["", "   ", "x".repeat(100_001)];
    for (const initialMessage of invalid) {
      const candidate = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateGeneralChatRequestSchema, candidate)).toBe(false);
    }

    const malformedId = {
      initial_message: "hello",
      client_message_id: "client id"
    };
    expect(Value.Check(CreateGeneralChatRequestSchema, malformedId)).toBe(false);
  });

  it("accepts list, detail and accepted response strict shapes", () => {
    const summary = {
      ...generalChat,
      last_message_preview: "hello"
    };
    expect(Value.Check(GeneralChatListResponseSchema, { items: [summary] })).toBe(true);

    const detail = {
      chat: generalChat,
      messages: [generalMessage]
    };
    expect(Value.Check(GeneralChatDetailResponseSchema, detail)).toBe(true);

    const accepted = {
      chat: generalChat,
      user_message: generalMessage,
      run_id: "run-1",
      stream_url: "/api/v1/chat-runs/run-1/events"
    };
    expect(Value.Check(GeneralChatMessageAcceptedResponseSchema, accepted)).toBe(true);
    const emptyStream = { ...accepted, stream_url: "" };
    expect(Value.Check(GeneralChatMessageAcceptedResponseSchema, emptyStream)).toBe(false);
  });
});

describe("health and API error boundaries", () => {
  it("accepts current health and database statuses", () => {
    for (const status of ["ok", "degraded"]) {
      const health = {
        status,
        version: "1.0.0",
        database: "ok",
        timestamp
      };
      expect(Value.Check(HealthResponseSchema, health)).toBe(true);
    }

    for (const database of ["ok", "error"]) {
      const health = {
        status: "ok",
        version: "1.0.0",
        database,
        timestamp
      };
      expect(Value.Check(HealthResponseSchema, health)).toBe(true);
    }
  });

  it("rejects malformed health payloads", () => {
    const baseHealth = {
      status: "ok",
      version: "1.0.0",
      database: "ok",
      timestamp
    };

    expect(Value.Check(HealthResponseSchema, { ...baseHealth, status: "healthy" })).toBe(false);
    expect(Value.Check(HealthResponseSchema, { ...baseHealth, version: "" })).toBe(false);
    expect(Value.Check(HealthResponseSchema, { ...baseHealth, timestamp: "2026-09-22" })).toBe(false);
    expect(Value.Check(HealthResponseSchema, { ...baseHealth, unexpected: true })).toBe(false);
  });

  it("accepts every current API error code", () => {
    const errorCodes = [
      "VALIDATION_ERROR",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "IDENTITY_SESSION_NOT_FOUND",
      "PROJECT_NOT_FOUND",
      "AGENT_STUDIO_OBJECT_NOT_FOUND",
      "AUTONOMY_PROFILE_CONFLICT",
      "USAGE_LIMIT_CONFLICT",
      "CONFIRMATION_NOT_FOUND",
      "CONFIRMATION_EXPIRED",
      "CONFIRMATION_ALREADY_DECIDED",
      "STEP_UP_REQUIRED",
      "POLICY_DENIED",
      "POLICY_PAUSED",
      "CHAT_NOT_FOUND",
      "RUN_NOT_FOUND",
      "IDEMPOTENCY_CONFLICT",
      "ROUTE_NOT_FOUND",
      "CONFLICT",
      "RUN_ALREADY_FINISHED",
      "PROVIDER_TIMEOUT",
      "PROVIDER_ERROR",
      "EMERGENCY_STOP",
      "EMERGENCY_STOP_CONFLICT",
      "ENVIRONMENT_EMERGENCY_STOP_LOCKED",
      "INTERRUPTED",
      "INTERNAL_ERROR"
    ] as const;

    for (const code of errorCodes) {
      expect(Value.Check(ErrorCodeSchema, code)).toBe(true);
      const payload = {
        error: {
          code,
          message: "safe message",
          request_id: "request-1",
          retryable: false
        }
      };
      expect(Value.Check(ApiErrorSchema, payload)).toBe(true);
    }
  });

  it("rejects unknown API error codes", () => {
    for (const code of ["", "UNKNOWN", "provider_error", null, 1]) {
      expect(Value.Check(ErrorCodeSchema, code)).toBe(false);
    }
  });

  it("enforces API error strict transport shape", () => {
    const error = {
      code: "INTERNAL_ERROR",
      message: "",
      request_id: "request-1",
      retryable: false
    } as const;

    expect(Value.Check(ApiErrorSchema, { error })).toBe(true);
    expect(Value.Check(ApiErrorSchema, { error: { ...error, request_id: "" } })).toBe(false);
    expect(Value.Check(ApiErrorSchema, { error: { ...error, retryable: "false" } })).toBe(false);
    expect(Value.Check(ApiErrorSchema, { error: { ...error, unexpected: true } })).toBe(false);
    expect(Value.Check(ApiErrorSchema, { error, unexpected: true })).toBe(false);
  });
});
