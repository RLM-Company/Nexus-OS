import type { FastifyInstance, FastifyRequest } from "fastify";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { IdentityContext, CreateManagerWork } from "@cosmora/contracts";
import {
  ScheduledDispatchError,
  ManagerWorkConflict,
  type ScheduledDispatchStore,
  type GeneralChatStore,
  type ProjectStore,
  type ManagerWorkStore
} from "@cosmora/db";
import { nextDispatchAt, tickScheduledDispatches } from "@cosmora/core";

const body = Type.Object(
  {
    client_request_id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union([
      Type.Literal("message"),
      Type.Literal("work_task"),
      Type.Literal("koscode_task"),
      Type.Literal("team_task")
    ]),
    mode: Type.Union([
      Type.Literal("once"),
      Type.Literal("daily"),
      Type.Literal("weekdays"),
      Type.Literal("weekly")
    ]),
    due_at: Type.String({ minLength: 24, maxLength: 24 }),
    text: Type.String({ minLength: 1, maxLength: 100_000 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    chat_id: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    project_id: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()]))
  },
  { additionalProperties: false }
);
const id = Type.String({ minLength: 1, maxLength: 128 });
const errorBody = (code: string, message: string) => ({ error: { code, message } });

export function registerScheduledDispatchRoutes(options: {
  app: FastifyInstance;
  store: ScheduledDispatchStore;
  chats: GeneralChatStore;
  projects: ProjectStore;
  works?: ManagerWorkStore;
  identityFor(request: FastifyRequest): IdentityContext;
}): void {
  const typed = options.app.withTypeProvider<TypeBoxTypeProvider>();
  const owner = (request: FastifyRequest) => options.identityFor(request).owner_id;

  typed.post(
    "/api/v1/scheduled-dispatches",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        body,
        response: { 201: Type.Any(), 400: Type.Any(), 404: Type.Any(), 409: Type.Any() }
      }
    },
    (request, reply) => {
      const ownerId = owner(request);
      const chatId = request.body.chat_id ?? null;
      const projectId = request.body.project_id ?? null;
      if (chatId && !options.chats.getChat(chatId, ownerId))
        return reply.code(404).send(errorBody("CHAT_NOT_FOUND", "Чат не найден."));
      if (projectId && !options.projects.getProject(projectId, ownerId))
        return reply.code(404).send(errorBody("PROJECT_NOT_FOUND", "Проект не найден."));
      try {
        return reply.code(201).send(
          options.store.create({
            ownerId,
            clientRequestId: request.body.client_request_id,
            chatId,
            projectId,
            kind: request.body.kind,
            mode: request.body.mode,
            dueAt: request.body.due_at,
            payload: {
              text: request.body.text,
              ...(request.body.title ? { title: request.body.title } : {})
            }
          })
        );
      } catch (cause) {
        if (cause instanceof ScheduledDispatchError)
          return reply
            .code(cause.code === "CONFLICT" ? 409 : 400)
            .send(errorBody(cause.code, "Некорректное расписание."));
        throw cause;
      }
    }
  );

  typed.get("/api/v1/scheduled-dispatches", (request) => ({
    items: options.store.list(owner(request))
  }));

  typed.post(
    "/api/v1/scheduled-dispatches/tick",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { body: Type.Object({}, { additionalProperties: false }) }
    },
    (request) => {
      const ownerId = owner(request);
      const now = new Date().toISOString();
      const due = options.store.due(ownerId, now);
      const { readyIds } = tickScheduledDispatches(due, now);
      options.store.markReady(readyIds, ownerId);
      return { checked: due.length, ready: readyIds.length, rescheduled: 0 };
    }
  );

  typed.post(
    "/api/v1/scheduled-dispatches/:id/dispatch",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: Type.Object({ id }, { additionalProperties: false }),
        body: Type.Object({}, { additionalProperties: false })
      }
    },
    (request, reply) => {
      const { owner_id: ownerId, actor_id: actorId } = options.identityFor(request);
      const item = options.store.get(request.params.id, ownerId);
      if (!item) return reply.code(404).send(errorBody("NOT_FOUND", "Запись не найдена."));
      if (item.status !== "ready")
        return reply.code(409).send(errorBody("NOT_READY", "Запись ещё не готова к отправке."));
      const occurrenceKey =
        item.mode === "once" ? `scheduled:${item.id}` : `scheduled:${item.id}:${item.due_at}`;
      if (item.kind === "message") {
        const accepted = options.chats.createMessage(
          item.chat_id!,
          item.payload.text,
          occurrenceKey,
          ownerId
        );
        if (!accepted)
          return reply.code(409).send(errorBody("CHAT_BUSY", "Чат недоступен для отправки."));
      } else {
        if (!options.works)
          return reply.code(503).send(errorBody("WORK_UNAVAILABLE", "Koswork недоступен."));
        const goal =
          item.kind === "team_task"
            ? `[team] ${item.payload.text}`.slice(0, 8000)
            : item.payload.text.slice(0, 8000);
        const request: CreateManagerWork = {
          client_request_id: occurrenceKey,
          goal,
          worker_role: "analyst"
        };
        try {
          const work = options.works.create(item.project_id!, ownerId, actorId, request, true);
          if (!work)
            return reply.code(409).send(errorBody("PROJECT_INACTIVE", "Проект недоступен."));
        } catch (cause) {
          if (cause instanceof ManagerWorkConflict)
            return reply.code(409).send(errorBody("WORK_CONFLICT", cause.message));
          throw cause;
        }
      }
      const nextDueAt = nextDispatchAt(item.mode, item.due_at, new Date().toISOString());
      if (nextDueAt) options.store.reschedule(item.id, ownerId, nextDueAt, item.due_at);
      else options.store.markDispatched(item.id, ownerId);
      return { dispatched: true, id: item.id, kind: item.kind };
    }
  );

  typed.delete(
    "/api/v1/scheduled-dispatches/:id",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params: Type.Object({ id }, { additionalProperties: false }) }
    },
    (request, reply) => {
      if (!options.store.cancel(request.params.id, owner(request)))
        return reply.code(404).send(errorBody("NOT_FOUND", "Запись не найдена или уже исполнена."));
      return reply.code(204).send();
    }
  );
}
