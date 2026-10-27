import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type, type TSchema, type Static } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import {
  PlaybookSaveSchema,
  PlaybookPublishSchema,
  PlaybookInstantiateSchema,
  AutomationScheduleSchema,
  EvaluationSuiteSchema,
  KnowledgeCollectionSchema,
  WorkDagCreateSchema,
  WorkDagControlSchema,
  validateWorkDag,
  type IdentityContext
} from "@cosmora/contracts";
import {
  AutomationValidationError,
  KnowledgeSearchError,
  BUILTIN_PROJECT_PLAYBOOKS
} from "@cosmora/core";
import {
  AutomationStoreError,
  ManagerWorkConflict,
  WorkDagConflict,
  type AutomationKind,
  type ProjectStore,
  type AutomationScope
} from "@cosmora/db";
import { ProjectKnowledgeError } from "./project-knowledge.js";
import type { ProjectAutomation } from "./project-automation.js";
import type { WorkDagCoordinator } from "./work-dag-coordinator.js";

export function registerProjectAutomationRoutes(
  app: FastifyInstance,
  service: ProjectAutomation,
  projects: ProjectStore,
  identityFor: (request: FastifyRequest) => IdentityContext,
  coordinator?: WorkDagCoordinator
): void {
  const base = "/api/v1/projects/:projectId/automation";
  type Params = { projectId: string; id: string };
  const id = Type.String({ minLength: 1, maxLength: 160, pattern: "^[a-zA-Z0-9_-]+$" });
  const params = Type.Object(
    { projectId: id, id: Type.Optional(id) },
    { additionalProperties: false }
  );
  const version = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
  const scope = (r: FastifyRequest<{ Params: Params }>): AutomationScope => ({
    owner: identityFor(r).owner_id,
    project: r.params.projectId
  });
  const safe = (
    r: FastifyRequest<{ Params: Params }>,
    reply: FastifyReply,
    fn: () => unknown
  ): unknown => {
    const s = scope(r);
    reply.header("cache-control", "private, no-store").header("x-content-type-options", "nosniff");
    if (!projects.getProject(s.project, s.owner))
      return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
    try {
      return fn();
    } catch (error) {
      if (
        error instanceof AutomationStoreError ||
        error instanceof AutomationValidationError ||
        error instanceof WorkDagConflict ||
        error instanceof ManagerWorkConflict ||
        error instanceof ProjectKnowledgeError ||
        error instanceof KnowledgeSearchError ||
        (error instanceof Error &&
          [
            "INVALID_DAG",
            "DAG_CYCLE",
            "DAG_DEPENDENCY_MISSING",
            "INVALID_DAG_PRIORITY",
            "INVALID_DAG_DEADLINE"
          ].includes(error.message))
      ) {
        const message = error.message;
        const status = /NOT_FOUND/.test(message)
          ? 404
          : /FENCED|QUIESCED/.test(message)
            ? 423
            : /LIMIT/.test(message)
              ? 413
              : /STALE|CONFLICT|ARCHIVED|INACTIVE|CORRUPT|NOT_COMPLETED/.test(message)
                ? 409
                : 400;
        return reply.code(status).send({ error: message });
      }
      throw error;
    }
  };
  const post = <S extends TSchema>(
    path: string,
    body: S,
    fn: (
      s: AutomationScope,
      body: Static<S>,
      request: FastifyRequest<{ Params: Params; Body: Static<S> }>,
      reply: FastifyReply
    ) => unknown
  ) => {
    app.post<{ Params: Params; Body: Static<S> }>(
      base + path,
      { bodyLimit: 150_000, validatorCompiler: TypeBoxValidatorCompiler, schema: { params, body } },
      (r, reply) => safe(r, reply, () => fn(scope(r), r.body as Static<S>, r, reply))
    );
  };
  const get = (
    path: string,
    fn: (s: AutomationScope, r: FastifyRequest<{ Params: Params }>) => unknown
  ) => {
    app.get<{ Params: Params }>(base + path, { schema: { params } }, (r, reply) =>
      safe(r, reply, () => fn(scope(r), r))
    );
  };
  get("/status", (s) => ({
    format: "kosmora.project-automation.v1",
    mission_runtime: "existing_work_dag",
    schedule_policy: "explicit_tick_then_owner_start",
    model_dispatched: false,
    counts: Object.fromEntries(
      (
        [
          "playbook",
          "schedule",
          "occurrence",
          "suite",
          "evaluation",
          "collection"
        ] as AutomationKind[]
      ).map((k) => [k, service.store.list(s, k).length])
    ),
    missions: service.work.dag.list(s.project, s.owner).length
  }));
  get("/missions", (s) => ({ items: service.work.dag.list(s.project, s.owner) }));
  get("/missions/:id", (s, r) => {
    const graph = coordinator
      ? coordinator.get(r.params.id, s.owner)
      : service.work.dag.get(r.params.id, s.owner);
    if (!graph || graph.project_id !== s.project)
      throw new AutomationStoreError("AUTOMATION_NOT_FOUND");
    return graph;
  });
  post("/missions", WorkDagCreateSchema, (s, body, r, reply) => {
    validateWorkDag(body.nodes);
    return reply
      .code(201)
      .send(service.work.dag.create(s.project, s.owner, identityFor(r).actor_id, body));
  });
  post("/missions/:id/control", WorkDagControlSchema, (s, body, r, reply) => {
    if (service.work.dag.get(r.params.id, s.owner)?.project_id !== s.project)
      throw new AutomationStoreError("AUTOMATION_NOT_FOUND");
    if (!coordinator) return reply.code(503).send({ error: "WORK_RUNTIME_UNAVAILABLE" });
    return coordinator.control(r.params.id, s.owner, body);
  });
  for (const [path, kind] of [
    ["playbooks", "playbook"],
    ["playbook-versions", "playbook_version"],
    ["instantiations", "instantiation"],
    ["schedules", "schedule"],
    ["occurrences", "occurrence"],
    ["suites", "suite"],
    ["evaluations", "evaluation"],
    ["collections", "collection"]
  ] as const) {
    get("/" + path, (s) => ({ items: service.store.list(s, kind) }));
    get("/" + path + "/:id", (s, r) => {
      const record = service.store.get(s, kind, r.params.id);
      if (!record) throw new AutomationStoreError("AUTOMATION_NOT_FOUND");
      return record;
    });
  }
  post("/playbooks", PlaybookSaveSchema, (s, body, r, reply) =>
    reply.code(201).send(service.createPlaybook(s, identityFor(r).actor_id, body))
  );
  post("/playbooks/seed", Type.Object({}, { additionalProperties: false }), (s, _body, r) => ({
    items: service.store.transaction(() =>
      BUILTIN_PROJECT_PLAYBOOKS.map((template) =>
        service.createPlaybook(s, identityFor(r).actor_id, {
          client_request_id: "builtin_v1_" + template.key,
          title: template.title,
          definition: template.definition
        })
      )
    ),
    model_dispatched: false
  }));
  post("/playbooks/:id/publish", PlaybookPublishSchema, (s, body, r) =>
    service.publish(s, identityFor(r).actor_id, r.params.id, body)
  );
  post(
    "/playbooks/:id/archive",
    Type.Object(
      { expected_version: version, archived: Type.Boolean() },
      { additionalProperties: false }
    ),
    (s, body, r) => service.archivePlaybook(s, r.params.id, body.expected_version, body.archived)
  );
  post("/playbooks/:id/preview", PlaybookInstantiateSchema, (s, body, r) =>
    service.preview(s, r.params.id, body)
  );
  post("/playbooks/:id/instantiate", PlaybookInstantiateSchema, (s, body, r, reply) =>
    reply.code(201).send(service.instantiate(s, identityFor(r).actor_id, r.params.id, body))
  );
  post("/schedules", AutomationScheduleSchema, (s, body, r, reply) =>
    reply.code(201).send(service.createSchedule(s, identityFor(r).actor_id, body))
  );
  post(
    "/schedules/:id/pause",
    Type.Object(
      { expected_version: version, paused: Type.Boolean() },
      { additionalProperties: false }
    ),
    (s, body, r) => service.pauseSchedule(s, r.params.id, body.expected_version, body.paused)
  );
  post("/tick", Type.Object({}, { additionalProperties: false }), (s) => service.collectDue(s));
  post("/occurrences/:id/accept", Type.Object({}, { additionalProperties: false }), (s, _body, r) =>
    service.acceptOccurrence(s, identityFor(r).actor_id, r.params.id)
  );
  post("/suites", EvaluationSuiteSchema, (s, body, _r, reply) =>
    reply.code(201).send(service.createSuite(s, body))
  );
  post(
    "/suites/:id/evaluate",
    Type.Object({ work_id: id, client_request_id: id }, { additionalProperties: false }),
    (s, body, r) => service.evaluate(s, r.params.id, body.work_id, body.client_request_id)
  );
  post("/collections", KnowledgeCollectionSchema, (s, body, _r, reply) =>
    reply.code(201).send(service.createCollection(s, body))
  );
  post(
    "/collections/:id/context",
    Type.Object({}, { additionalProperties: false }),
    (s, _body, r) => service.collectionContext(s, r.params.id)
  );
}
