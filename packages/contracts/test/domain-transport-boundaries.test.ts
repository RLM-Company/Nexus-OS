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

describe("domain enum boundaries", () => {
  it.each(["not_started", "in_progress", "completed"] as const)(
    "accepts onboarding status %s",
    (status) => {
      expect(Value.Check(OnboardingStatusSchema, status)).toBe(true);
    }
  );

  it.each(["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"] as const)(
    "accepts project status %s",
    (status) => {
      expect(Value.Check(ProjectStatusSchema, status)).toBe(true);
    }
  );

  it.each(["user", "assistant", "system_event"] as const)("accepts message role %s", (role) => {
    expect(Value.Check(MessageRoleSchema, role)).toBe(true);
  });

  it.each(["pending", "streaming", "completed", "failed", "cancelled"] as const)(
    "accepts message status %s",
    (status) => {
      expect(Value.Check(MessageStatusSchema, status)).toBe(true);
    }
  );

  it.each(["queued", "running", "succeeded", "failed", "cancelled"] as const)(
    "accepts run status %s",
    (status) => {
      expect(Value.Check(RunStatusSchema, status)).toBe(true);
    }
  );

  it.each([
    [OnboardingStatusSchema, "done"],
    [ProjectStatusSchema, "active"],
    [MessageRoleSchema, "tool"],
    [MessageStatusSchema, "success"],
    [RunStatusSchema, "completed"]
  ] as const)("rejects unknown enum value", (schema, value) => {
    expect(Value.Check(schema, value)).toBe(false);
  });
});

describe("project request boundaries", () => {
  it("accepts create-project message length 1 and 100000", () => {
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
  });

  it("rejects invalid create-project message text", () => {
    for (const initialMessage of ["", "   ", "\t\n", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateProjectRequestSchema, {
          initial_message: initialMessage,
          client_message_id: "client-1"
        })
      ).toBe(false);
    }
  });

  it("accepts create-message content length 1 and 100000", () => {
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
  });

  it("rejects invalid create-message text", () => {
    for (const message of ["", "   ", "\t\n", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateMessageRequestSchema, {
          content: message,
          client_message_id: "client-1"
        })
      ).toBe(false);
    }
  });

  it.each([CreateProjectRequestSchema, CreateMessageRequestSchema] as const)(
    "rejects malformed client ids and extra request properties",
    (schema) => {
      const messageField =
        schema === CreateProjectRequestSchema
          ? { initial_message: "hello" }
          : { content: "hello" };

      expect(
        Value.Check(schema, {
          ...messageField,
          client_message_id: "client id"
        })
      ).toBe(false);

      expect(
        Value.Check(schema, {
          ...messageField,
          client_message_id: "client-1",
          unexpected: true
        })
      ).toBe(false);
    }
  );
});

describe("project transport boundaries", () => {
  it.each(["DRAFT", "ACTIVE", "FAILED", "ARCHIVED"] as const)(
    "accepts project status %s in project transport",
    (status) => {
      expect(Value.Check(ProjectSchema, { ...project, status })).toBe(true);
    }
  );

  it.each([
    ["title", 1, true],
    ["title", 160, true],
    ["title", 0, false],
    ["title", 161, false]
  ] as const)("checks project %s length %d", (field, length, expected) => {
    expect(Value.Check(ProjectSchema, { ...project, [field]: "x".repeat(length) })).toBe(expected);
  });

  it("rejects malformed project ids, timestamps and extras", () => {
    expect(Value.Check(ProjectSchema, { ...project, id: "project id" })).toBe(false);
    expect(Value.Check(ProjectSchema, { ...project, created_at: "2026-09-22" })).toBe(false);
    expect(Value.Check(ProjectSchema, { ...project, unexpected: true })).toBe(false);
  });

  it("checks project summary preview boundaries", () => {
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

  it("accepts project list and detail strict shapes", () => {
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

    expect(
      Value.Check(ProjectListResponseSchema, {
        items: [summary],
        unexpected: true
      })
    ).toBe(false);
    expect(
      Value.Check(ProjectDetailResponseSchema, {
        project,
        chat_id: "chat-1",
        messages: [projectMessage],
        unexpected: true
      })
    ).toBe(false);
  });
});

describe("project message transport boundaries", () => {
  it.each(["user", "assistant", "system_event"] as const)("accepts role %s", (role) => {
    expect(Value.Check(MessageSchema, { ...projectMessage, role })).toBe(true);
  });

  it.each(["pending", "streaming", "completed", "failed", "cancelled"] as const)(
    "accepts status %s",
    (status) => {
      expect(Value.Check(MessageSchema, { ...projectMessage, status })).toBe(true);
    }
  );

  it("accepts nullable message references and arbitrary text content", () => {
    expect(Value.Check(MessageSchema, projectMessage)).toBe(true);
    expect(
      Value.Check(MessageSchema, {
        ...projectMessage,
        reply_to_message_id: "message-0",
        run_id: "run-1",
        error_code: "PROVIDER_ERROR",
        content: ""
      })
    ).toBe(true);
  });

  it("rejects non-text content type, malformed refs and extras", () => {
    expect(Value.Check(MessageSchema, { ...projectMessage, content_type: "image" })).toBe(false);
    expect(Value.Check(MessageSchema, { ...projectMessage, run_id: "run id" })).toBe(false);
    expect(
      Value.Check(MessageSchema, {
        ...projectMessage,
        reply_to_message_id: "message id"
      })
    ).toBe(false);
    expect(Value.Check(MessageSchema, { ...projectMessage, unexpected: true })).toBe(false);
  });

  it("accepts message accepted response and enforces strict shape", () => {
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
    expect(Value.Check(RunCancelResponseSchema, { run_id: "run-1", status: "cancelled" })).toBe(
      true
    );
    expect(Value.Check(RunCancelResponseSchema, { run_id: "run-1", status: "failed" })).toBe(false);
    expect(
      Value.Check(RunCancelResponseSchema, {
        run_id: "run-1",
        status: "cancelled",
        unexpected: true
      })
    ).toBe(false);
  });
});

describe("general chat transport boundaries", () => {
  it("checks chat title boundaries and strict shape", () => {
    expect(Value.Check(GeneralChatSchema, generalChat)).toBe(true);
    expect(Value.Check(GeneralChatSchema, { ...generalChat, title: "x".repeat(160) })).toBe(true);
    expect(Value.Check(GeneralChatSchema, { ...generalChat, title: "" })).toBe(false);
    expect(Value.Check(GeneralChatSchema, { ...generalChat, title: "x".repeat(161) })).toBe(false);
    expect(Value.Check(GeneralChatSchema, { ...generalChat, unexpected: true })).toBe(false);
  });

  it("checks general chat summary preview boundaries", () => {
    const summary = {
      ...generalChat,
      last_message_preview: null
    };

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
  });

  it.each(["user", "assistant"] as const)("accepts general message role %s", (role) => {
    expect(Value.Check(GeneralChatMessageSchema, { ...generalMessage, role })).toBe(true);
  });

  it.each(["system_event", "tool", "", null] as const)(
    "rejects invalid general message role %j",
    (role) => {
      expect(Value.Check(GeneralChatMessageSchema, { ...generalMessage, role })).toBe(false);
    }
  );

  it("accepts nullable run/error fields and strict message shape", () => {
    expect(Value.Check(GeneralChatMessageSchema, generalMessage)).toBe(true);
    expect(
      Value.Check(GeneralChatMessageSchema, {
        ...generalMessage,
        run_id: "run-1",
        error_code: "PROVIDER_ERROR",
        content: ""
      })
    ).toBe(true);
    expect(Value.Check(GeneralChatMessageSchema, { ...generalMessage, unexpected: true })).toBe(
      false
    );
  });

  it("enforces general chat create request text and id boundaries", () => {
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

    for (const initialMessage of ["", "   ", "x".repeat(100_001)]) {
      expect(
        Value.Check(CreateGeneralChatRequestSchema, {
          initial_message: initialMessage,
          client_message_id: "client-1"
        })
      ).toBe(false);
    }

    expect(
      Value.Check(CreateGeneralChatRequestSchema, {
        initial_message: "hello",
        client_message_id: "client id"
      })
    ).toBe(false);
  });

  it("accepts list, detail and accepted response strict shapes", () => {
    const summary = {
      ...generalChat,
      last_message_preview: "hello"
    };
    const accepted = {
      chat: generalChat,
      user_message: generalMessage,
      run_id: "run-1",
      stream_url: "/api/v1/chat-runs/run-1/events"
    };

    expect(Value.Check(GeneralChatListResponseSchema, { items: [summary] })).toBe(true);
    expect(
      Value.Check(GeneralChatDetailResponseSchema, {
        chat: generalChat,
        messages: [generalMessage]
      })
    ).toBe(true);
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
  it.each(["ok", "degraded"] as const)("accepts health status %s", (status) => {
    expect(
      Value.Check(HealthResponseSchema, {
        status,
        version: "1.0.0",
        database: "ok",
        timestamp
      })
    ).toBe(true);
  });

  it.each(["ok", "error"] as const)("accepts database status %s", (database) => {
    expect(
      Value.Check(HealthResponseSchema, {
        status: "ok",
        version: "1.0.0",
        database,
        timestamp
      })
    ).toBe(true);
  });

  it("rejects malformed health payloads", () => {
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
        timestamp: "2026-09-22"
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

  it.each(errorCodes)("accepts API error code %s", (code) => {
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
  });

  it.each(["", "UNKNOWN", "provider_error", null, 1] as const)(
    "rejects unknown API error code %j",
    (code) => {
      expect(Value.Check(ErrorCodeSchema, code)).toBe(false);
    }
  );

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
