import { createHash } from "node:crypto";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import {
  CreateStarsMissionSchema,
  EntityIdSchema,
  StarsMissionEventSchema,
  type CreateStarsMission,
  type IdentityContext,
  type StarsMissionEvent
} from "@cosmora/contracts";
import {
  applyStarsMissionEvent,
  changeStarsOrg,
  createStarsMission,
  createStarsOrg,
  delegateMission,
  StarsMissionConflict,
  StarsOrgConflict
} from "@cosmora/core";
import {
  AgentInstanceValidationError,
  AgentTeamRunNotFoundError,
  AgentTeamRunValidationError,
  StarsMissionConflict as StarsMissionStoreConflict,
  StarsOrgStoreConflict,
  WorkDagConflict,
  ManagerWorkConflict,
  type ProjectStore,
  type AgentTeamRunStore,
  type StarsMissionStore,
  type StoredStarsMission,
  type StarsOrgStore
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { bindStarsTeam, starsTeamStatus } from "./stars-team-adapter.js";
import type { WorkDagCoordinator } from "./work-dag-coordinator.js";

type MissionRun = {
  project_id: string;
  composition_id: string;
  graph_id: string;
  manager_node_id: string;
};

export function registerStarsMissionRoutes({
  app,
  store,
  teamRuns,
  projects,
  dag,
  orgStore,
  identityFor
}: {
  app: FastifyInstance;
  store: StarsMissionStore;
  teamRuns?: AgentTeamRunStore;
  projects?: ProjectStore;
  dag?: WorkDagCoordinator;
  orgStore?: StarsOrgStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const base = "/api/v1/stars/missions";
  const params = Type.Object({ id: EntityIdSchema });
  const orgParams = Type.Object({ teamScope: Type.String({ minLength: 1, maxLength: 120 }) });

  if (orgStore) {
    app.get<{ Params: { teamScope: string } }>(
      "/api/v1/stars/org/:teamScope",
      { schema: { params: orgParams } },
      (request, reply) => {
        const owner = identityFor(request).owner_id;
        const current = orgStore.current(request.params.teamScope, owner);
        return current ?? reply.code(404).send({ error: { code: "ORG_NOT_FOUND" } });
      }
    );
    app.post<{
      Params: { teamScope: string };
      Body: {
        nodes: Array<{
          id: string;
          role: "owner" | "chief" | "submanager" | "executor" | "senior";
          manager_id: string | null;
          responsibility_zones: string[];
          project_ids: string[];
          effective_from: string;
        }>;
      };
    }>("/api/v1/stars/org/:teamScope", { schema: { params: orgParams } }, (request, reply) => {
      const owner = identityFor(request).owner_id;
      if (orgStore.current(request.params.teamScope, owner))
        return reply.code(409).send({ error: { code: "ORG_EXISTS" } });
      try {
        const created = createStarsOrg(
          request.params.teamScope,
          request.body.nodes.map((node) => ({ ...node, status: "active" as const }))
        );
        return reply.code(201).send(orgStore.save(created, owner, 0));
      } catch (cause) {
        if (cause instanceof StarsOrgConflict)
          return reply.code(422).send({ error: { code: cause.code } });
        throw cause;
      }
    });
    app.post<{
      Params: { teamScope: string };
      Body: {
        expected_version: number;
        changes: Array<{
          op: "add" | "update" | "remove";
          node: {
            id: string;
            role: "owner" | "chief" | "submanager" | "executor" | "senior";
            manager_id: string | null;
            responsibility_zones: string[];
            project_ids: string[];
            status?: "active" | "removed";
            effective_from: string;
          };
        }>;
      };
    }>(
      "/api/v1/stars/org/:teamScope/change",
      { schema: { params: orgParams } },
      (request, reply) => {
        const owner = identityFor(request).owner_id;
        const current = orgStore.current(request.params.teamScope, owner);
        if (!current) return reply.code(404).send({ error: { code: "ORG_NOT_FOUND" } });
        try {
          const next = changeStarsOrg(
            current as never,
            request.body.expected_version,
            request.body.changes.map((change) => ({
              ...change,
              node: { ...change.node, status: change.node.status ?? "active" }
            }))
          );
          return orgStore.save(next, owner, current.version);
        } catch (cause) {
          if (cause instanceof StarsOrgConflict || cause instanceof StarsOrgStoreConflict)
            return reply.code(409).send({ error: { code: cause.code } });
          throw cause;
        }
      }
    );
  }
  if (orgStore && dag) {
    app.post<{
      Params: { id: string };
      Body: { project_id: string; zones: Record<string, string> };
    }>(
      base + "/:id/delegation",
      {
        schema: {
          params,
          body: Type.Object(
            {
              project_id: Type.String({ minLength: 1, maxLength: 120 }),
              zones: Type.Record(Type.String(), Type.String(), { maxProperties: 32 })
            },
            { additionalProperties: false }
          )
        }
      },
      (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const owner = identityFor(request).owner_id;
        const mission = store.get(request.params.id, owner);
        if (!mission) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
        const org = orgStore.current(mission.team_scope, owner);
        if (!org) return reply.code(404).send({ error: "STARS_ORG_NOT_FOUND" });
        if (!projects?.getProject(request.body.project_id, owner))
          return reply.code(404).send({ error: "STARS_PROJECT_NOT_FOUND" });
        const plan = delegateMission(
          mission as never,
          org as never,
          request.body.project_id,
          request.body.zones
        );
        if (!plan.nodes.length)
          return reply.code(422).send({ error: "NO_ASSIGNEES", skipped: plan.skipped });
        const planDigest = createHash("sha256")
          .update(
            JSON.stringify({
              project_id: request.body.project_id,
              composition_version: plan.composition_version,
              nodes: plan.nodes
            })
          )
          .digest("hex");
        const existing = mission.delegation as
          | {
              graph_id: string;
              project_id: string;
              plan_digest?: string;
              mission_version: number;
              composition_version: number;
            }
          | undefined;
        if (existing && existing.plan_digest === planDigest)
          return {
            delegation: existing,
            graph: dag.get(existing.graph_id, owner, request.body.project_id),
            plan
          };
        try {
          const graph = dag.create(owner, owner, owner, {
            client_request_id: `stars-delegation:${mission.id}:${plan.mission_version}:${plan.composition_version}`,
            title:
              typeof mission.goal === "string" && mission.goal ? mission.goal : "Stars mission",
            nodes: plan.nodes
          });
          const delegation = {
            graph_id: graph.id,
            project_id: request.body.project_id,
            plan_digest: planDigest,
            mission_version: plan.mission_version,
            composition_version: plan.composition_version
          };
          const saved = store.save(
            { ...mission, version: mission.version + 1, delegation },
            owner,
            mission.version
          );
          return { delegation, mission_version: saved.version, graph, plan };
        } catch (cause) {
          if (cause instanceof StarsMissionStoreConflict || cause instanceof WorkDagConflict)
            return reply.code(409).send({ error: cause.message });
          throw cause;
        }
      }
    );
  }

  if (dag) {
    app.post<{
      Params: { id: string };
      Body: { expected_version: number; max_model_requests: number };
    }>(
      base + "/:id/delegation/execute",
      {
        schema: {
          params,
          body: Type.Object(
            {
              expected_version: Type.Integer({ minimum: 1 }),
              max_model_requests: Type.Integer({ minimum: 3, maximum: 96 })
            },
            { additionalProperties: false }
          )
        }
      },
      (request, reply) => {
        const owner = identityFor(request).owner_id;
        const mission = store.get(request.params.id, owner);
        if (!mission) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
        const delegation = mission.delegation as
          { graph_id: string; project_id: string } | undefined;
        if (!delegation) return reply.code(409).send({ error: "STARS_NOT_DELEGATED" });
        if (mission.version !== request.body.expected_version)
          return reply.code(409).send({ error: "STALE_MISSION_VERSION" });
        try {
          const armed = dag.control(delegation.graph_id, owner, {
            version: dag.get(delegation.graph_id, owner, delegation.project_id)!.version,
            action: "run_plan",
            acknowledge_cost: true,
            max_model_requests: request.body.max_model_requests
          });
          dag.advance();
          return {
            graph: dag.get(delegation.graph_id, owner, delegation.project_id),
            armed_version: armed.version
          };
        } catch (cause) {
          if (cause instanceof WorkDagConflict || cause instanceof StarsMissionStoreConflict)
            return reply.code(409).send({ error: cause.message });
          throw cause;
        }
      }
    );
  }

  app.post<{ Body: CreateStarsMission }>(
    base,
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { body: CreateStarsMissionSchema }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = identityFor(request).owner_id;
      const id = "mission-" + request.body.client_request_id;
      const existing = store.get(id, owner);
      if (existing) return existing;
      const mission = createStarsMission({
        id,
        team_scope: request.body.team_scope,
        ...(request.body.goal !== undefined ? { goal: request.body.goal } : {})
      });
      return store.save(mission, owner, 0);
    }
  );

  const projectIdFor = (teamScope: string) => teamScope;

  const withTeamBinding = (
    mission: Record<string, unknown>,
    owner: string,
    actor: string
  ): Record<string, unknown> => {
    const stored = mission.team_binding as
      { composition_id?: string; project_id?: string } | undefined;
    if (!teamRuns || !stored?.composition_id || !stored.project_id) return mission;
    const live = teamRuns.parts(
      { owner_id: owner, actor_id: actor },
      stored.project_id,
      stored.composition_id
    );
    const merged = starsTeamStatus(live.parts, stored as Parameters<typeof starsTeamStatus>[1]);
    return { ...mission, team_binding: merged };
  };

  const withExecution = (mission: StoredStarsMission, owner: string) => {
    const run = mission.execution as MissionRun | undefined;
    if (!run) return mission;
    const graph = dag?.get(run.graph_id, owner, run.project_id);
    const parts =
      graph &&
      teamRuns?.parts(
        { owner_id: owner, actor_id: graph.actor_id },
        run.project_id,
        run.composition_id
      ).parts;
    const complete =
      graph?.nodes.length && graph.nodes.every((node) => node.status === "completed");
    const cancelled =
      graph?.nodes.some((node) => node.status === "cancelled") &&
      graph.nodes.every((node) => ["completed", "failed", "cancelled"].includes(node.status));
    return {
      ...mission,
      runtime: graph
        ? {
            mode: graph.mode,
            status: complete
              ? "completed"
              : cancelled
                ? "cancelled"
                : (graph.execution?.status ?? "awaiting_owner_run"),
            reason: graph.execution?.reason ?? null,
            version: graph.version,
            nodes: graph.nodes.map(({ id, title, status, depends_on, artifacts, attempts }) => ({
              id,
              title,
              status,
              depends_on,
              artifact_count: artifacts.length,
              instance_id: parts?.find((part) => part.node_id === id)?.instance_id ?? null,
              attempts: attempts.length
            }))
          }
        : null
    };
  };

  app.post<{
    Params: { id: string };
    Body: { expected_version: number; composition_id: string; manager_instance_id: string };
  }>(
    base + "/:id/execution",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            composition_id: Type.String({ pattern: "^[a-f0-9]{64}$" }),
            manager_instance_id: EntityIdSchema
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const identity = identityFor(request);
      const owner = identity.owner_id;
      const mission = store.get(request.params.id, owner);
      if (!mission || !projects?.getProject(mission.team_scope, owner))
        return reply.code(404).send({ error: "STARS_PROJECT_NOT_FOUND" });
      if (!dag || !teamRuns) return reply.code(503).send({ error: "STARS_EXECUTION_UNAVAILABLE" });
      const existing = mission.execution as
        (MissionRun & { manager_instance_id: string }) | undefined;
      const { expected_version, composition_id, manager_instance_id } = request.body;
      if (existing) {
        return existing.composition_id === composition_id &&
          existing.manager_instance_id === manager_instance_id
          ? withExecution(mission, owner)
          : reply.code(409).send({ error: "STARS_TEAM_ALREADY_BOUND" });
      }
      if (
        mission.version !== expected_version ||
        mission.stage !== "working" ||
        typeof mission.goal !== "string"
      )
        return reply.code(409).send({ error: "STARS_MISSION_NOT_READY" });
      try {
        const active = teamRuns.activate(identity, mission.team_scope, composition_id, {
          runKey: "stars:" + createHash("sha256").update(mission.id).digest("hex"),
          goal: mission.goal,
          managerInstance: manager_instance_id
        });
        const graph = dag.get(active.graph_id, owner, mission.team_scope);
        const managerNode = active.parts.find((part) => part.instance_id === manager_instance_id);
        if (
          !managerNode ||
          graph?.nodes.find((node) => node.id === managerNode.node_id)?.depends_on.length !== 2
        )
          return reply.code(409).send({ error: "STARS_TEAM_DOES_NOT_MATCH" });
        const execution = {
          project_id: mission.team_scope,
          composition_id,
          graph_id: active.graph_id,
          manager_node_id: managerNode.node_id,
          manager_instance_id
        };
        return withExecution(
          store.save(
            { ...mission, version: mission.version + 1, execution },
            owner,
            mission.version
          ),
          owner
        );
      } catch (error) {
        if (error instanceof AgentTeamRunNotFoundError)
          return reply.code(404).send({ error: "STARS_TEAM_NOT_FOUND" });
        if (error instanceof AgentTeamRunValidationError)
          return reply.code(409).send({ error: "STARS_TEAM_INVALID", message: error.message });
        if (
          error instanceof StarsMissionStoreConflict ||
          error instanceof WorkDagConflict ||
          error instanceof ManagerWorkConflict
        )
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { node_id: string; expected_instance_id: string } }>(
    base + "/:id/execution/replace",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          { node_id: EntityIdSchema, expected_instance_id: EntityIdSchema },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const identity = identityFor(request);
      const mission = store.get(request.params.id, identity.owner_id);
      const run = mission?.execution as MissionRun | undefined;
      if (
        !mission ||
        !run ||
        !teamRuns ||
        !dag?.owns(run.graph_id, identity.owner_id, run.project_id)
      )
        return reply.code(404).send({ error: "STARS_RUN_NOT_FOUND" });
      if (request.body.node_id === run.manager_node_id)
        return reply.code(409).send({ error: "STARS_ONLY_WORKERS_CAN_BE_REPLACED" });
      try {
        teamRuns.replaceFailedPart(
          identity,
          run.project_id,
          run.composition_id,
          run.graph_id,
          request.body.node_id,
          request.body.expected_instance_id
        );
        return withExecution(mission, identity.owner_id);
      } catch (error) {
        if (error instanceof AgentTeamRunNotFoundError)
          return reply.code(404).send({ error: "STARS_PART_NOT_FOUND" });
        if (
          error instanceof AgentTeamRunValidationError ||
          error instanceof AgentInstanceValidationError
        )
          return reply
            .code(409)
            .send({ error: "STARS_REPLACEMENT_INVALID", message: error.message });
        throw error;
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { expected_version: number } }>(
    base + "/:id/execution/cancel",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          { expected_version: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = identityFor(request).owner_id;
      const mission = store.get(request.params.id, owner);
      const run = mission?.execution as MissionRun | undefined;
      if (!mission || !run || !dag) return reply.code(404).send({ error: "STARS_RUN_NOT_FOUND" });
      let graph = dag.get(run.graph_id, owner, run.project_id);
      if (!graph) return reply.code(404).send({ error: "STARS_RUN_NOT_FOUND" });
      const cancellable = graph.nodes.filter((node) =>
        ["pending", "running", "blocked"].includes(node.status)
      );
      if (cancellable.length && request.body.expected_version !== graph.version)
        return reply.code(409).send({ error: "STALE_DAG" });
      try {
        for (const node of cancellable) {
          graph = dag.control(graph.id, owner, {
            version: graph.version,
            action: "cancel_step",
            node_id: node.id
          });
        }
        return withExecution(mission, owner);
      } catch (error) {
        if (error instanceof WorkDagConflict || error instanceof ManagerWorkConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );

  app.get(base, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const identity = identityFor(request);
    return {
      items: store
        .list(identity.owner_id)
        .map((m) =>
          withTeamBinding(withExecution(m, identity.owner_id), identity.owner_id, identity.actor_id)
        )
    };
  });

  app.get<{ Params: { id: string } }>(base + "/:id", { schema: { params } }, (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const mission = store.get(request.params.id, identityFor(request).owner_id);
    if (!mission) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
    return withExecution(mission, identityFor(request).owner_id);
  });

  app.post<{ Params: { id: string }; Body: StarsMissionEvent }>(
    base + "/:id/events",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: StarsMissionEventSchema }
    },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const owner = identityFor(request).owner_id;
      const current = store.get(request.params.id, owner);
      if (!current) return reply.code(404).send({ error: "STARS_MISSION_NOT_FOUND" });
      if (current.execution) return reply.code(409).send({ error: "STARS_USE_WORK_PLAN" });
      if (request.body.expected_version !== current.version)
        return reply.code(409).send({ error: "STALE_MISSION_VERSION" });
      const { expected_version: _checked, ...event } = request.body;
      void _checked;
      let next;
      try {
        next = applyStarsMissionEvent(
          current as Parameters<typeof applyStarsMissionEvent>[0],
          event
        );
      } catch (error) {
        if (error instanceof StarsMissionConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
      const savedState = next as unknown as StoredStarsMission & Record<string, unknown>;
      if (event.type === "plan" && Array.isArray(savedState.agents)) {
        const missionId = typeof savedState.id === "string" ? savedState.id : "";
        const teamScope = typeof savedState.team_scope === "string" ? savedState.team_scope : "";
        const binding = bindStarsTeam(
          {
            id: missionId,
            team_scope: teamScope,
            agents: (savedState.agents as Array<{ id: string }>).map((a) => ({ id: a.id }))
          },
          projectIdFor(teamScope)
        );
        savedState.team_binding = binding;
      }
      try {
        return store.save(savedState, owner, current.version);
      } catch (error) {
        if (error instanceof StarsMissionStoreConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );
}
