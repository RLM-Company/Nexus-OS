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

describe("domain enum boundaries", () => {
  it("accepts every current enum literal and rejects unknown values", () => {
    for (const value of ["not_started", "in_progress", "completed"]) {
      expect(Value.Check(OnboardingStatusSchema, value)).toBe(true);
    }

    for (const value of ["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"]) {
      expect(Value.Check(ProjectStatusSchema, value)).toBe(true);
    }

    for (const value of ["user", "assistant", "system_event"]) {
      expect(Value.Check(MessageRoleSchema, value)).toBe(true);
    }

    for (const value of ["pending", "streaming", "completed", "failed", "cancelled"]) {
      expect(Value.Check(MessageStatusSchema, value)).toBe(true);
    }

    for (const value of ["queued", "running", "succeeded", "failed", "cancelled"]) {
      expect(Value.Check(RunStatusSchema, value)).toBe(true);
    }

    expect(Value.Check(OnboardingStatusSchema, "done")).toBe(false);
    expect(Value.Check(ProjectStatusSchema, "active")).toBe(false);
    expect(Value.Check(MessageRoleSchema, "tool")).toBe(false);
    expect(Value.Check(MessageStatusSchema, "success")).toBe(false);
    expect(Value.Check(RunStatusSchema, "completed")).toBe(false);
  });
});

describe("create request boundaries", () => {
  it("checks project and message text limits", () => {
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "x",
        client_message_id: "client-1"
      })
    ).toBe(true);
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "x".repeat(100_000),
        client_message_id: "client-1"
      })
    ).toBe(true);

    for (const initial_message of ["", "   ", "\t\n", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateProjectRequestSchema, {
          initial_message,
          client_message_id: "client-1"
        })
      ).toBe(false);
    }

    expect(
      Value.Check(CreateMessageRequestSchema, {
        content: "x",
        client_message_id: "client-1"
      })
    ).toBe(true);
    expect(
      Value.Check(CreateMessageRequestSchema, {
        content: "x".repeat(100_000),
        client_message_id: "client-1"
      })
    ).toBe(true);

    for (const content of ["", "   ", "\t\n", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateMessageRequestSchema, {
          content,
          client_message_id: "client-1"
        })
      ).toBe(false);
    }
  });

  it("rejects malformed ids and extra request properties", () => {
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "hello",
        client_message_id: "client id"
      })
    ).toBe(false);
    expect(
      Value.Check(CreateProjectRequestSchema, {
        initial_message: "hello",
        client_message_id: "client-1",
        unexpected: true
      })
    ).toBe(false);
    expect(
      Value.Check(CreateMessageRequestSchema, {
        content: "hello",
        client_message_id: "client id"
      })
    ).toBe(false);
    expect(
      Value.Check(CreateMessageRequestSchema, {
        content: "hello",
        client_message_id: "client-1",
        unexpected: true
      })
    ).toBe(false);
  });
});

describe("project transport boundaries", () => {
  it("checks project and summary fields", () => {
    expect(Value.Check(ProjectSchema, project)).toBe(true);
    expect(Value.Check(ProjectSchema, { ...project, title: "x".repeat(160) })).toBe(true);
    expect(Value.Check(ProjectSchema, { ...project, title: "" })).toBe(false);
    expect(Value.Check(ProjectSchema, { ...project, title: "x".repeat(161) })).toBe(false);
    expect(Value.Check(ProjectSchema, { ...project, id: "project id" })).toBe(false);
    expect(Value.Check(ProjectSchema, { ...project, created_at: "2026-09-22" })).toBe(false);
    expect(Value.Check(ProjectSchema, { ...project, unexpected: true })).toBe(false);

    const summary = {
      id: "project-1",
      title: "Project",
      status: "ACTIVE",
      updated_at: timestamp,
      last_message_preview: null
    } as const;

    expect(Value.Check(ProjectSummarySchema, summary)).toBe(true);
    expect(
      Value.Check(ProjectSummarySchema, {
        ...summary,
        last_message_preview: "x".repeat(240)
      })
    ).toBe(true);
    expect(
      Value.Check(ProjectSummarySchema, {
        ...summary,
        last_message_preview: "x".repeat(241)
      })
    ).toBe(false);
  });

  it("checks project message and response strictness", () => {
    expect(Value.Check(MessageSchema, projectMessage)).toBe(true);

    for (const role of ["user", "assistant", "system_event"]) {
      expect(Value.Check(MessageSchema, { ...projectMessage, role })).toBe(true);
    }

    for (const status of ["pending", "streaming", "completed", "failed", "cancelled"]) {
      expect(Value.Check(MessageSchema, { ...projectMessage, status })).toBe(true);
    }

    expect(Value.Check(MessageSchema, { ...projectMessage, content_type: "image" })).toBe(false);
    expect(Value.Check(MessageSchema, { ...projectMessage, run_id: "run id" })).toBe(false);
    expect(Value.Check(MessageSchema, { ...projectMessage, unexpected: true })).toBe(false);

    const summary = {
      id: "project-1",
      title: "Project",
      status: "ACTIVE",
      updated_at: timestamp,
      last_message_preview: "hello"
    } as const;

    expect(Value.Check(ProjectListResponseSchema, { items: [summary] })).toBe(true);
    expect(
      Value.Check(ProjectDetailResponseSchema, {
        project,
        chat_id: "chat-1",
        messages: [projectMessage]
      })
    ).toBe(true);

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

    expect(Value.Check(RunCancelResponseSchema, { run_id: "run-1", status: "cancelled" })).toBe(
      true
    );
    expect(Value.Check(RunCancelResponseSchema, { run_id: "run-1", status: "failed" })).toBe(false);
  });
});

describe("general chat transport boundaries", () => {
  it("checks chat, summary and message fields", () => {
    expect(Value.Check(GeneralChatSchema, chat)).toBe(true);
    expect(Value.Check(GeneralChatSchema, { ...chat, title: "x".repeat(160) })).toBe(true);
    expect(Value.Check(GeneralChatSchema, { ...chat, title: "" })).toBe(false);
    expect(Value.Check(GeneralChatSchema, { ...chat, title: "x".repeat(161) })).toBe(false);
    expect(Value.Check(GeneralChatSchema, { ...chat, unexpected: true })).toBe(false);

    const summary = { ...chat, last_message_preview: null };
    expect(Value.Check(GeneralChatSummarySchema, summary)).toBe(true);
    expect(
      Value.Check(GeneralChatSummarySchema, {
        ...summary,
        last_message_preview: "x".repeat(240)
      })
    ).toBe(true);
    expect(
      Value.Check(GeneralChatSummarySchema, {
        ...summary,
        last_message_preview: "x".repeat(241)
      })
    ).toBe(false);

    expect(Value.Check(GeneralChatMessageSchema, chatMessage)).toBe(true);
    expect(Value.Check(GeneralChatMessageSchema, { ...chatMessage, role: "assistant" })).toBe(true);
    expect(Value.Check(GeneralChatMessageSchema, { ...chatMessage, role: "system_event" })).toBe(
      false
    );
    expect(Value.Check(GeneralChatMessageSchema, { ...chatMessage, unexpected: true })).toBe(false);
  });

  it("checks create/list/detail/accepted chat responses", () => {
    expect(
      Value.Check(CreateGeneralChatRequestSchema, {
        initial_message: "x",
        client_message_id: "client-1"
      })
    ).toBe(true);
    expect(
      Value.Check(CreateGeneralChatRequestSchema, {
        initial_message: "x".repeat(100_000),
        client_message_id: "client-1"
      })
    ).toBe(true);

    for (const initial_message of ["", "   ", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateGeneralChatRequestSchema, {
          initial_message,
          client_message_id: "client-1"
        })
      ).toBe(false);
    }

    const summary = { ...chat, last_message_preview: "hello" };
    expect(Value.Check(GeneralChatListResponseSchema, { items: [summary] })).toBe(true);
    expect(
      Value.Check(GeneralChatDetailResponseSchema, {
        chat,
        messages: [chatMessage]
      })
    ).toBe(true);

    const accepted = {
      chat,
      user_message: chatMessage,
      run_id: "run-1",
      stream_url: "/api/v1/chat-runs/run-1/events"
    };

    expect(Value.Check(GeneralChatMessageAcceptedResponseSchema, accepted)).toBe(true);
    expect(
      Value.Check(GeneralChatMessageAcceptedResponseSchema, {
        ...accepted,
        stream_url: ""
      })
    ).toBe(false);
  });
});

describe("health and API error boundaries", () => {
  it("checks health response vocabulary and strict shape", () => {
    for (const status of ["ok", "degraded"]) {
      expect(
        Value.Check(HealthResponseSchema, {
          status,
          version: "1.0.0",
          database: "ok",
          timestamp
        })
      ).toBe(true);
    }

    for (const database of ["ok", "error"]) {
      expect(
        Value.Check(HealthResponseSchema, {
          status: "ok",
          version: "1.0.0",
          database,
          timestamp
        })
      ).toBe(true);
    }

    expect(
      Value.Check(HealthResponseSchema, {
        status: "healthy",
        version: "1.0.0",
        database: "ok",
        timestamp
      })
    ).toBe(false);
    expect(
      Value.Check(HealthResponseSchema, {
        status: "ok",
        version: "",
        database: "ok",
        timestamp
      })
    ).toBe(false);
    expect(
      Value.Check(HealthResponseSchema, {
        status: "ok",
        version: "1.0.0",
        database: "ok",
        timestamp,
        unexpected: true
      })
    ).toBe(false);
  });

  it("checks every current API error code and strict error shape", () => {
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
      expect(
        Value.Check(ApiErrorSchema, {
          error: {
            code,
            message: "safe message",
            request_id: "request-1",
            retryable: false
          }
        })
      ).toBe(true);
    }

    for (const code of ["", "UNKNOWN", "provider_error", null, 1]) {
      expect(Value.Check(ErrorCodeSchema, code)).toBe(false);
    }

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
  });
});
