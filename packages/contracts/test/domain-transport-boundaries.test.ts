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

const chat = {
  id: "chat-1",
  title: "Chat",
  created_at: timestamp,
  updated_at: timestamp
} as const;

const chatMessage = {
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

const projectValid = (value: unknown) => Value.Check(ProjectSchema, value);
const messageValid = (value: unknown) => Value.Check(MessageSchema, value);
const chatValid = (value: unknown) => Value.Check(GeneralChatSchema, value);
const chatMessageValid = (value: unknown) => {
  return Value.Check(GeneralChatMessageSchema, value);
};

describe("domain enum boundaries", () => {
  it("accepts current enum vocabularies", () => {
    const onboarding = ["not_started", "in_progress", "completed"];
    for (const value of onboarding) {
      expect(Value.Check(OnboardingStatusSchema, value)).toBe(true);
    }

    const projects = ["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"];
    for (const value of projects) {
      expect(Value.Check(ProjectStatusSchema, value)).toBe(true);
    }

    const roles = ["user", "assistant", "system_event"];
    for (const value of roles) {
      expect(Value.Check(MessageRoleSchema, value)).toBe(true);
    }

    const messages = [
      "pending",
      "streaming",
      "completed",
      "failed",
      "cancelled"
    ];
    for (const value of messages) {
      expect(Value.Check(MessageStatusSchema, value)).toBe(true);
    }

    const runs = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled"
    ];
    for (const value of runs) {
      expect(Value.Check(RunStatusSchema, value)).toBe(true);
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

describe("create request boundaries", () => {
  it("enforces project initial-message limits", () => {
    const valid = ["x", "x".repeat(100_000)];
    for (const initialMessage of valid) {
      const request = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateProjectRequestSchema, request)).toBe(true);
    }

    const invalid = ["", "   ", "\t\n", "x".repeat(100_001)];
    for (const initialMessage of invalid) {
      const request = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateProjectRequestSchema, request)).toBe(false);
    }
  });

  it("enforces project message limits", () => {
    const valid = ["x", "x".repeat(100_000)];
    for (const text of valid) {
      const request = {
        content: text,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateMessageRequestSchema, request)).toBe(true);
    }

    const invalid = ["", "   ", "\t\n", "x".repeat(100_001)];
    for (const text of invalid) {
      const request = {
        content: text,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateMessageRequestSchema, request)).toBe(false);
    }
  });

  it("rejects malformed ids and additional request properties", () => {
    const badProjectId = {
      initial_message: "hello",
      client_message_id: "client id"
    };
    expect(Value.Check(CreateProjectRequestSchema, badProjectId)).toBe(false);

    const extraProject = {
      initial_message: "hello",
      client_message_id: "client-1",
      unexpected: true
    };
    expect(Value.Check(CreateProjectRequestSchema, extraProject)).toBe(false);

    const badMessageId = {
      content: "hello",
      client_message_id: "client id"
    };
    expect(Value.Check(CreateMessageRequestSchema, badMessageId)).toBe(false);

    const extraMessage = {
      content: "hello",
      client_message_id: "client-1",
      unexpected: true
    };
    expect(Value.Check(CreateMessageRequestSchema, extraMessage)).toBe(false);
  });
});

describe("project transport boundaries", () => {
  it("accepts all project statuses", () => {
    const statuses = ["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"];
    for (const status of statuses) {
      expect(projectValid({ ...project, status })).toBe(true);
    }
  });

  it("enforces project title lengths", () => {
    expect(projectValid({ ...project, title: "x" })).toBe(true);
    const maxTitle = { ...project, title: "x".repeat(160) };
    expect(projectValid(maxTitle)).toBe(true);
    expect(projectValid({ ...project, title: "" })).toBe(false);
    const tooLong = { ...project, title: "x".repeat(161) };
    expect(projectValid(tooLong)).toBe(false);
  });

  it("rejects malformed project fields", () => {
    expect(projectValid({ ...project, id: "project id" })).toBe(false);
    expect(projectValid({ ...project, created_at: "2026-09-22" })).toBe(false);
    expect(projectValid({ ...project, unexpected: true })).toBe(false);
  });

  it("enforces project summary preview lengths", () => {
    const summary = {
      id: "project-1",
      title: "Project",
      status: "ACTIVE",
      updated_at: timestamp,
      last_message_preview: null
    } as const;

    expect(Value.Check(ProjectSummarySchema, summary)).toBe(true);
    const maxPreview = {
      ...summary,
      last_message_preview: "x".repeat(240)
    };
    expect(Value.Check(ProjectSummarySchema, maxPreview)).toBe(true);
    const tooLong = {
      ...summary,
      last_message_preview: "x".repeat(241)
    };
    expect(Value.Check(ProjectSummarySchema, tooLong)).toBe(false);
  });

  it("enforces project list and detail shapes", () => {
    const summary = {
      id: "project-1",
      title: "Project",
      status: "ACTIVE",
      updated_at: timestamp,
      last_message_preview: "hello"
    } as const;

    const list = { items: [summary] };
    expect(Value.Check(ProjectListResponseSchema, list)).toBe(true);

    const detail = {
      project,
      chat_id: "chat-1",
      messages: [projectMessage]
    };
    expect(Value.Check(ProjectDetailResponseSchema, detail)).toBe(true);

    const badList = { ...list, unexpected: true };
    expect(Value.Check(ProjectListResponseSchema, badList)).toBe(false);
    const badDetail = { ...detail, unexpected: true };
    expect(Value.Check(ProjectDetailResponseSchema, badDetail)).toBe(false);
  });
});

describe("project message transport boundaries", () => {
  it("accepts all message roles and statuses", () => {
    const roles = ["user", "assistant", "system_event"];
    for (const role of roles) {
      expect(messageValid({ ...projectMessage, role })).toBe(true);
    }

    const statuses = [
      "pending",
      "streaming",
      "completed",
      "failed",
      "cancelled"
    ];
    for (const status of statuses) {
      expect(messageValid({ ...projectMessage, status })).toBe(true);
    }
  });

  it("accepts nullable and populated references", () => {
    expect(messageValid(projectMessage)).toBe(true);
    const linked = {
      ...projectMessage,
      reply_to_message_id: "message-0",
      run_id: "run-1",
      error_code: "PROVIDER_ERROR",
      content: ""
    };
    expect(messageValid(linked)).toBe(true);
  });

  it("rejects malformed message fields", () => {
    const badType = { ...projectMessage, content_type: "image" };
    expect(messageValid(badType)).toBe(false);
    expect(messageValid({ ...projectMessage, run_id: "run id" })).toBe(false);

    const badReply = {
      ...projectMessage,
      reply_to_message_id: "message id"
    };
    expect(messageValid(badReply)).toBe(false);
    expect(messageValid({ ...projectMessage, unexpected: true })).toBe(false);
  });

  it("enforces accepted-message response shape", () => {
    const response = {
      project,
      chat_id: "chat-1",
      user_message: projectMessage,
      run_id: "run-1",
      stream_url: "/api/v1/runs/run-1/events"
    };
    expect(Value.Check(MessageAcceptedResponseSchema, response)).toBe(true);

    const emptyStream = { ...response, stream_url: "" };
    expect(Value.Check(MessageAcceptedResponseSchema, emptyStream)).toBe(false);

    const extra = { ...response, unexpected: true };
    expect(Value.Check(MessageAcceptedResponseSchema, extra)).toBe(false);
  });

  it("accepts only the cancelled run response literal", () => {
    const response = {
      run_id: "run-1",
      status: "cancelled"
    };
    expect(Value.Check(RunCancelResponseSchema, response)).toBe(true);

    const wrongStatus = { ...response, status: "failed" };
    expect(Value.Check(RunCancelResponseSchema, wrongStatus)).toBe(false);

    const extra = { ...response, unexpected: true };
    expect(Value.Check(RunCancelResponseSchema, extra)).toBe(false);
  });
});

describe("general chat transport boundaries", () => {
  it("enforces chat title limits", () => {
    expect(chatValid(chat)).toBe(true);
    const maxTitle = { ...chat, title: "x".repeat(160) };
    expect(chatValid(maxTitle)).toBe(true);
    expect(chatValid({ ...chat, title: "" })).toBe(false);
    const tooLong = { ...chat, title: "x".repeat(161) };
    expect(chatValid(tooLong)).toBe(false);
    expect(chatValid({ ...chat, unexpected: true })).toBe(false);
  });

  it("enforces chat summary preview limits", () => {
    const summary = {
      ...chat,
      last_message_preview: null
    };
    expect(Value.Check(GeneralChatSummarySchema, summary)).toBe(true);

    const maxPreview = {
      ...summary,
      last_message_preview: "x".repeat(240)
    };
    expect(Value.Check(GeneralChatSummarySchema, maxPreview)).toBe(true);

    const tooLong = {
      ...summary,
      last_message_preview: "x".repeat(241)
    };
    expect(Value.Check(GeneralChatSummarySchema, tooLong)).toBe(false);
  });

  it("accepts only user and assistant chat-message roles", () => {
    for (const role of ["user", "assistant"]) {
      expect(chatMessageValid({ ...chatMessage, role })).toBe(true);
    }

    for (const role of ["system_event", "tool", "", null]) {
      expect(chatMessageValid({ ...chatMessage, role })).toBe(false);
    }
  });

  it("enforces chat-message strict shape", () => {
    expect(chatMessageValid(chatMessage)).toBe(true);
    const linked = {
      ...chatMessage,
      run_id: "run-1",
      error_code: "PROVIDER_ERROR",
      content: ""
    };
    expect(chatMessageValid(linked)).toBe(true);

    const extra = { ...chatMessage, unexpected: true };
    expect(chatMessageValid(extra)).toBe(false);
  });

  it("enforces general chat create-request boundaries", () => {
    const valid = ["x", "x".repeat(100_000)];
    for (const initialMessage of valid) {
      const request = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateGeneralChatRequestSchema, request)).toBe(true);
    }

    const invalid = ["", "   ", "x".repeat(100_001)];
    for (const initialMessage of invalid) {
      const request = {
        initial_message: initialMessage,
        client_message_id: "client-1"
      };
      expect(Value.Check(CreateGeneralChatRequestSchema, request)).toBe(false);
    }

    const badId = {
      initial_message: "hello",
      client_message_id: "client id"
    };
    expect(Value.Check(CreateGeneralChatRequestSchema, badId)).toBe(false);
  });

  it("accepts list, detail and accepted-response shapes", () => {
    const summary = {
      ...chat,
      last_message_preview: "hello"
    };
    const list = { items: [summary] };
    expect(Value.Check(GeneralChatListResponseSchema, list)).toBe(true);

    const detail = {
      chat,
      messages: [chatMessage]
    };
    expect(Value.Check(GeneralChatDetailResponseSchema, detail)).toBe(true);

    const accepted = {
      chat,
      user_message: chatMessage,
      run_id: "run-1",
      stream_url: "/api/v1/chat-runs/run-1/events"
    };
    expect(Value.Check(GeneralChatMessageAcceptedResponseSchema, accepted)).toBe(
      true
    );

    const emptyStream = { ...accepted, stream_url: "" };
    expect(
      Value.Check(GeneralChatMessageAcceptedResponseSchema, emptyStream)
    ).toBe(false);
  });
});

describe("health and API error boundaries", () => {
  it("accepts current health and database statuses", () => {
    for (const status of ["ok", "degraded"]) {
      const response = {
        status,
        version: "1.0.0",
        database: "ok",
        timestamp
      };
      expect(Value.Check(HealthResponseSchema, response)).toBe(true);
    }

    for (const database of ["ok", "error"]) {
      const response = {
        status: "ok",
        version: "1.0.0",
        database,
        timestamp
      };
      expect(Value.Check(HealthResponseSchema, response)).toBe(true);
    }
  });

  it("rejects malformed health payloads", () => {
    const response = {
      status: "ok",
      version: "1.0.0",
      database: "ok",
      timestamp
    };

    const badStatus = { ...response, status: "healthy" };
    expect(Value.Check(HealthResponseSchema, badStatus)).toBe(false);
    expect(Value.Check(HealthResponseSchema, { ...response, version: "" })).toBe(
      false
    );

    const badTime = { ...response, timestamp: "2026-09-22" };
    expect(Value.Check(HealthResponseSchema, badTime)).toBe(false);

    const extra = { ...response, unexpected: true };
    expect(Value.Check(HealthResponseSchema, extra)).toBe(false);
  });

  it("accepts every current API error code", () => {
    const codes = [
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

    for (const code of codes) {
      expect(Value.Check(ErrorCodeSchema, code)).toBe(true);
      const response = {
        error: {
          code,
          message: "safe message",
          request_id: "request-1",
          retryable: false
        }
      };
      expect(Value.Check(ApiErrorSchema, response)).toBe(true);
    }
  });

  it("rejects unknown API error codes", () => {
    const codes = ["", "UNKNOWN", "provider_error", null, 1];
    for (const code of codes) {
      expect(Value.Check(ErrorCodeSchema, code)).toBe(false);
    }
  });

  it("enforces API error strict shape", () => {
    const error = {
      code: "INTERNAL_ERROR",
      message: "",
      request_id: "request-1",
      retryable: false
    } as const;

    expect(Value.Check(ApiErrorSchema, { error })).toBe(true);

    const emptyId = { error: { ...error, request_id: "" } };
    expect(Value.Check(ApiErrorSchema, emptyId)).toBe(false);

    const badRetryable = {
      error: { ...error, retryable: "false" }
    };
    expect(Value.Check(ApiErrorSchema, badRetryable)).toBe(false);

    const innerExtra = {
      error: { ...error, unexpected: true }
    };
    expect(Value.Check(ApiErrorSchema, innerExtra)).toBe(false);

    const outerExtra = { error, unexpected: true };
    expect(Value.Check(ApiErrorSchema, outerExtra)).toBe(false);
  });
});
