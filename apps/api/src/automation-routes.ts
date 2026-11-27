import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import {
  CreateAutomationTriggerSchema,
  AutomationTriggerControlSchema,
  AutomationRunControlSchema,
  type IdentityContext,
  type CreateAutomationTrigger,
  type AutomationRunControl,
  type AutomationTriggerControl
} from "@cosmora/contracts";
import {
  AutomationRunError,
  ManagerWorkConflict,
  WorkDagConflict,
  WorkflowStoreConflict,
  type AutomationStore,
  type ManagerWorkStore,
  type ProjectStore,
  type StarsMissionStore
} from "@cosmora/db";
import { AutomationRunner } from "./automation-runner.js";
import type { ManagerWorkCoordinator } from "./manager-work-coordinator.js";

const id = Type.String({ minLength: 1, maxLength: 128 });
const params = Type.Object({ id }, { additionalProperties: false });
const errorBody = (code: string, message: string) => ({ error: { code, message } });

const CreateTriggerBody = Type.Object(
  {
    client_request_id: id,
    project_id: Type.String({ minLength: 1, maxLength: 160 }),
    workflow_id: Type.String({ minLength: 1, maxLength: 128 }),
    definition_version: Type.Integer({ minimum: 1 }),
    kind: Type.Union([Type.Literal("manual"), Type.Literal("event"), Type.Literal("schedule")]),
    inputs: CreateAutomationTriggerSchema.properties.inputs,
    schedule: Type.Optional(CreateAutomationTriggerSchema.properties.schedule),
    event: Type.Optional(CreateAutomationTriggerSchema.properties.event)
  },
  { additionalProperties: false }
);

export function registerAutomationRoutes(options: {
  app: FastifyInstance;
  store: AutomationStore;
  workflows: ManagerWorkStore;
  projects: ProjectStore;
  coordinator: ManagerWorkCoordinator;
  stars?: StarsMissionStore;
  identityFor(request: FastifyRequest): IdentityContext;
  nodeBudget?: { max_input_tokens: number; max_output_tokens: number };
}): void {
  const { app, store, workflows, projects } = options;
  const identityFor = (request: FastifyRequest) => options.identityFor(request);
  const runner = new AutomationRunner({
    store,
    workflows,
    coordinator: options.coordinator,
    projects,
    ...(options.stars ? { stars: options.stars } : {}),
    ...(options.nodeBudget ? { nodeBudget: options.nodeBudget } : {})
  });
  const owner = (request: FastifyRequest) => identityFor(request).owner_id;
  const actor = (request: FastifyRequest) => identityFor(request).actor_id;
  const guard = (
    reply: {
      header: (name: string, value: string) => unknown;
      code: (code: number) => { send: (value: unknown) => unknown };
    },
    fn: () => unknown
  ) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      return fn();
    } catch (cause) {
      if (cause instanceof AutomationRunError) {
        const conflict = cause.code.startsWith("STALE_") || cause.code === "IDEMPOTENCY_CONFLICT";
        return reply
          .code(conflict ? 409 : 400)
          .send(errorBody(cause.code, "Автоматизация отклонена."));
      }
      if (
        cause instanceof WorkflowStoreConflict ||
        cause instanceof ManagerWorkConflict ||
        cause instanceof WorkDagConflict
      )
        return reply.code(409).send(errorBody(cause.message, "Конфликт состояния."));
      if (cause instanceof Error && /^(INVALID_|MISSING_|WORKFLOW_)/.test(cause.message))
        return reply.code(400).send(errorBody(cause.message, "Некорректные данные."));
      throw cause;
    }
  };

  app.get("/api/v1/automation/capabilities", (_request, reply) =>
    guard(reply, () => ({
      capabilities: [
        "automation.triggers.v1",
        "automation.runs.v1",
        "automation.confirmation.v1",
        "automation.external-unknown.v1",
        "automation.stars-consumer.v1"
      ]
    }))
  );

  app.post<{ Body: CreateAutomationTrigger & { project_id: string } }>(
    "/api/v1/automation/triggers",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { body: CreateTriggerBody }
    },
    (request, reply) =>
      guard(reply, () => {
        if (!projects.getProject(request.body.project_id, owner(request)))
          return reply.code(404).send(errorBody("PROJECT_NOT_FOUND", "Проект не найден."));
        const definition = workflows.workflows.get(
          request.body.project_id,
          owner(request),
          request.body.workflow_id
        );
        if (!definition)
          return reply.code(404).send(errorBody("WORKFLOW_NOT_FOUND", "Сценарий не найден."));
        if (definition.version !== request.body.definition_version)
          return reply
            .code(400)
            .send(errorBody("STALE_WORKFLOW_VERSION", "Версия сценария устарела."));
        if (definition.archived_at)
          return reply.code(400).send(errorBody("WORKFLOW_ARCHIVED", "Сценарий в архиве."));
        const { project_id: _projectId, ...input } = request.body;
        void _projectId;
        return reply
          .code(201)
          .send(
            store.createTrigger(owner(request), request.body.project_id, actor(request), input)
          );
      })
  );

  app.get("/api/v1/automation/triggers", (request, reply) =>
    guard(reply, () => {
      const query = request.query as { project_id?: string; workflow_id?: string };
      return {
        items: store.listTriggers(owner(request), query.project_id, query.workflow_id),
        next_runs: store
          .listTriggers(owner(request))
          .filter((t) => t.kind === "schedule" && t.status === "enabled")
          .map((t) => ({ trigger_id: t.id, next_due_at: runner.nextDue(t) }))
      };
    })
  );

  app.post<{ Params: { id: string }; Body: AutomationTriggerControl }>(
    "/api/v1/automation/triggers/:id",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: AutomationTriggerControlSchema }
    },
    (request, reply) =>
      guard(reply, () => {
        const trigger = store.getTrigger(owner(request), request.params.id);
        if (!trigger)
          return reply.code(404).send(errorBody("TRIGGER_NOT_FOUND", "Триггер не найден."));
        return store.controlTrigger(
          owner(request),
          trigger.project_id,
          trigger.id,
          request.body.expected_version,
          request.body.status
        );
      })
  );

  /** Explicit server tick. The caller owns the cadence; no in-process timer. */
  app.post(
    "/api/v1/automation/tick",
    { schema: { body: Type.Object({}, { additionalProperties: false }) } },
    (request, reply) =>
      guard(reply, () => {
        let collected = 0;
        let executed = 0;
        const ownerId = owner(request);
        for (const trigger of store.listTriggers(ownerId)) {
          if (trigger.kind === "schedule" && trigger.status === "enabled")
            if (runner.collectSchedule(ownerId, trigger.id, actor(request))) collected += 1;
        }
        for (const run of store.listRuns(ownerId)) {
          if (["queued", "claimed", "running"].includes(run.status)) {
            const reconciled = runner.reconcile(ownerId, run.id, actor(request));
            if (reconciled.status === "queued")
              try {
                runner.start(ownerId, run.id, actor(request));
                executed += 1;
              } catch (cause) {
                if (!(cause instanceof AutomationRunError)) throw cause;
              }
          }
        }
        return { checked: true, collected, executed };
      })
  );

  /** Event ingestion through Harness 3 connectors; stable event id dedupes. */
  app.post(
    "/api/v1/automation/events",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        body: Type.Object(
          {
            client_request_id: id,
            project_id: Type.String({ minLength: 1, maxLength: 160 }),
            workflow_id: Type.String({ minLength: 1, maxLength: 128 }),
            definition_version: Type.Integer({ minimum: 1 }),
            source: Type.String({ minLength: 1, maxLength: 128 }),
            event_type: Type.String({ minLength: 1, maxLength: 128 }),
            event_id: Type.String({ minLength: 1, maxLength: 200 }),
            bindings: Type.Record(Type.String({ maxLength: 100 }), Type.String({ maxLength: 500 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      guard(reply, () => {
        const body = request.body as {
          client_request_id: string;
          project_id: string;
          workflow_id: string;
          definition_version: number;
          source: string;
          event_type: string;
          event_id: string;
          bindings: Record<string, string>;
        };
        if (!projects.getProject(body.project_id, owner(request)))
          return reply.code(404).send(errorBody("PROJECT_NOT_FOUND", "Проект не найден."));
        const definition = workflows.workflows.get(
          body.project_id,
          owner(request),
          body.workflow_id
        );
        if (!definition || definition.version !== body.definition_version)
          return reply
            .code(400)
            .send(errorBody("STALE_WORKFLOW_VERSION", "Версия сценария устарела."));
        const trigger = runner.collectEvent(owner(request), body.project_id, actor(request), body);
        return reply.code(201).send({ trigger, dedupe: true });
      })
  );

  app.get("/api/v1/automation/runs", (request, reply) =>
    guard(reply, () => {
      const query = request.query as { project_id?: string; trigger_id?: string };
      return { items: store.listRuns(owner(request), query.project_id, query.trigger_id) };
    })
  );

  app.get<{ Params: { id: string } }>("/api/v1/automation/runs/:id", (request, reply) =>
    guard(reply, () => {
      const run = store.getRun(owner(request), request.params.id);
      if (!run) return reply.code(404).send(errorBody("RUN_NOT_FOUND", "Запуск не найден."));
      return { ...run, events: store.events(owner(request), run.id) };
    })
  );

  app.post<{ Params: { id: string }; Body: AutomationRunControl }>(
    "/api/v1/automation/runs/:id/control",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: AutomationRunControlSchema }
    },
    (request, reply) =>
      guard(reply, () => {
        const body = request.body;
        if (body.action === "confirm") {
          const action = runner.confirm(owner(request), request.params.id, actor(request));
          return { confirmed: true, action };
        }
        if (body.action === "verify_external") {
          const run = store.getRun(owner(request), request.params.id);
          if (!run?.external_action_id)
            return reply
              .code(404)
              .send(errorBody("EXTERNAL_ACTION_NOT_FOUND", "Нет внешнего действия."));
          const verified = store.verifyExternal(
            owner(request),
            run.external_action_id,
            body.verified === true,
            actor(request)
          );
          return { verified: verified.status === "verified", action: verified };
        }
        if (body.action === "run") {
          const result = runner.start(owner(request), request.params.id, actor(request));
          return result;
        }
        return runner.control(
          owner(request),
          request.params.id,
          actor(request),
          body.action,
          body.reason
        );
      })
  );

  app.post<{
    Params: { id: string };
    Body: { connector: string; operation: string; operation_key: string };
  }>(
    "/api/v1/automation/runs/:id/unknown-external",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            connector: Type.String({ minLength: 1, maxLength: 128 }),
            operation: Type.String({ minLength: 1, maxLength: 200 }),
            operation_key: Type.String({ minLength: 1, maxLength: 300 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      guard(reply, () => ({
        action: runner.unknownExternal(
          owner(request),
          request.params.id,
          request.body.connector,
          request.body.operation,
          request.body.operation_key,
          actor(request)
        )
      }))
  );

  app.post<{
    Params: { id: string };
    Body: { client_request_id: string; team_scope: string; goal: string };
  }>(
    "/api/v1/automation/runs/:id/stars-consumer",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            client_request_id: id,
            team_scope: Type.String({ minLength: 1, maxLength: 128 }),
            goal: Type.String({ minLength: 1, maxLength: 4000 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      guard(reply, () => ({
        mission_id: runner.starsConsumer(
          owner(request),
          request.params.id,
          actor(request),
          request.body
        )
      }))
  );

  /** Explicit reconciliation against the authoritative Work DAG. */
  app.get<{ Params: { id: string } }>("/api/v1/automation/runs/:id/reconcile", (request, reply) =>
    guard(reply, () => {
      const run = store.getRun(owner(request), request.params.id);
      if (!run) return reply.code(404).send(errorBody("RUN_NOT_FOUND", "Запуск не найден."));
      return runner.reconcile(owner(request), run.id, actor(request));
    })
  );

  app.post(
    "/api/v1/automation/recover",
    { schema: { body: Type.Object({}, { additionalProperties: false }) } },
    (request, reply) =>
      guard(reply, () => ({ recovered: runner.recover(owner(request)).map((run) => run.id) }))
  );
}
