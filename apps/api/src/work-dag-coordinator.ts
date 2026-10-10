import { createHash } from "node:crypto";
import type { WorkDag, WorkDagControl, WorkDagCreate, WorkDagNodeInput } from "@cosmora/contracts";
import { projectDagStatuses, validateWorkDag } from "@cosmora/core";
import { WorkDagConflict, ManagerWorkConflict, type ManagerWorkStore } from "@cosmora/db";
import type { ManagerWorkCoordinator } from "./manager-work-coordinator.js";

// One process, one Manager executor. DAG transitions are synchronous CAS writes;
// nodes use the existing policy-checked, bounded file-producing Manager pipeline.
export class WorkDagCoordinator {
  constructor(
    private readonly works: ManagerWorkStore,
    private readonly manager: ManagerWorkCoordinator
  ) {}
  private validate(nodes: WorkDagNodeInput[]): void {
    try {
      validateWorkDag(nodes);
    } catch (e) {
      throw new WorkDagConflict(e instanceof Error ? e.message : "INVALID_DAG");
    }
  }
  create(project: string, owner: string, actor: string, input: WorkDagCreate): WorkDag {
    this.validate(input.nodes);
    return this.works.dag.create(project, owner, actor, input);
  }
  owns(id: string, owner: string, project: string): boolean {
    return this.works.dag.get(id, owner)?.project_id === project;
  }
  get(id: string, owner: string): WorkDag | null {
    const graph = this.works.dag.get(id, owner);
    return graph ? this.reconcile(graph) : null;
  }
  checkpoints(id: string, owner: string) {
    return this.works.dag.checkpoints(id, owner);
  }
  list(project: string, owner: string): WorkDag[] {
    return this.works.dag.list(project, owner).map((g) => this.reconcile(g));
  }
  reconcileAll(): void {
    for (const graph of this.works.dag.active()) {
      try {
        this.reconcile(graph);
      } catch (e) {
        if (!(e instanceof WorkDagConflict || e instanceof ManagerWorkConflict)) throw e;
      }
    }
  }
  private reconcile(graph: WorkDag): WorkDag {
    const next = structuredClone(graph);
    for (const node of next.nodes) {
      const attempt = node.attempts.at(-1);
      if (!attempt || ["completed", "failed", "cancelled"].includes(node.status)) continue;
      const child = this.works.get(attempt.work_id, graph.owner_id);
      if (!child) {
        node.status = "failed";
        node.blocked_reason = "WORK_NOT_FOUND";
        continue;
      }
      node.result = {
        stage: child.stage,
        plan_summary: child.plan?.summary ?? null,
        plan_instructions: child.plan?.instructions ?? null,
        review: child.review,
        confirmation_id: child.confirmation_id,
        sources: child.result_sources ?? []
      };
      if (child.status === "completed") {
        node.status = "completed";
        node.blocked_reason = null;
        node.artifacts = this.works.runtime
          .artifacts(graph.project_id, graph.owner_id, child.id)
          .filter((a) => a.published);
      } else if (["failed", "cancelled"].includes(child.status)) {
        node.status = child.status as "failed" | "cancelled";
        node.blocked_reason = child.error_code ?? child.status.toUpperCase();
      } else if (["paused", "blocked", "awaiting_approval"].includes(child.status)) {
        node.status = "blocked";
        node.blocked_reason = child.error_code ?? child.status.toUpperCase();
      } else {
        node.status = "running";
        node.blocked_reason = child.status === "queued" ? "EXECUTOR_QUEUE" : null;
      }
    }
    const projected = projectDagStatuses(next);
    return JSON.stringify(projected.nodes) === JSON.stringify(graph.nodes)
      ? graph
      : this.works.dag.save(projected, "Обновлено состояние шагов");
  }
  private current(id: string, owner: string, version: number): WorkDag {
    this.works.assertWritable(owner);
    const graph = this.works.dag.get(id, owner);
    if (!graph) throw new WorkDagConflict("DAG_NOT_FOUND");
    if (graph.version !== version) throw new WorkDagConflict("STALE_DAG");
    return this.reconcile(graph);
  }
  edit(id: string, owner: string, version: number, nodes: WorkDagNodeInput[]): WorkDag {
    const graph = this.current(id, owner, version);
    if (graph.mode === "cancelled") throw new WorkDagConflict("PROJECT_CANCELLED");
    this.validate(nodes);
    for (const old of graph.nodes.filter((n) => n.attempts.length || n.status === "cancelled")) {
      const updated = nodes.find((n) => n.id === old.id);
      if (
        !updated ||
        updated.title !== old.title ||
        updated.goal !== old.goal ||
        JSON.stringify(updated.depends_on) !== JSON.stringify(old.depends_on)
      )
        throw new WorkDagConflict("STEP_ALREADY_STARTED");
    }
    graph.nodes = nodes.map((n) => {
      const previous = graph.nodes.find((p) => p.id === n.id);
      return previous?.attempts.length
        ? previous
        : { ...n, status: "pending", blocked_reason: null, attempts: [], artifacts: [] };
    });
    return this.works.dag.save(projectDagStatuses(graph), "Не запущенные шаги отредактированы");
  }
  control(id: string, owner: string, input: WorkDagControl): WorkDag {
    let graph = this.current(id, owner, input.version);
    if (["pause", "resume", "cancel"].includes(input.action)) {
      const mode =
        input.action === "pause" ? "paused" : input.action === "cancel" ? "cancelled" : "active";
      this.works.dag.setProjectMode(graph.project_id, owner, mode);
      for (const child of this.works.list(graph.project_id, owner)) {
        if (
          ["completed", "failed", "cancelled"].includes(child.status) ||
          (mode !== "cancelled" && child.dag_binding && !child.dag_binding.bound)
        )
          continue;
        if (mode === "active") {
          if (child.status === "paused" && !child.inflight_run_id)
            this.manager.control(child.id, owner, child.version, "resume");
          else if (child.pause_requested) this.works.save({ ...child, pause_requested: false });
        } else
          this.manager.control(
            child.id,
            owner,
            child.version,
            mode === "paused" ? "pause" : "cancel"
          );
      }
      for (const other of this.works.dag.list(graph.project_id, owner)) {
        other.mode = mode;
        if (mode === "cancelled")
          for (const node of other.nodes)
            if (!["completed", "failed", "cancelled"].includes(node.status)) {
              node.status = "cancelled";
              node.blocked_reason = "PROJECT_CANCELLED";
            }
        const saved = this.works.dag.save(
          projectDagStatuses(other),
          mode === "paused"
            ? "Проект на паузе после текущего действия"
            : mode === "active"
              ? "Проект продолжен"
              : "Проект отменён"
        );
        if (other.id === graph.id) graph = saved;
      }
      return this.reconcile(graph);
    }
    if (graph.mode !== "active" || this.works.dag.projectMode(graph.project_id, owner) !== "active")
      throw new WorkDagConflict("PROJECT_PAUSED");
    const node = graph.nodes.find((n) => n.id === input.node_id);
    if (!node) throw new WorkDagConflict("STEP_NOT_FOUND");
    if (input.action === "approve_step" || input.action === "resume_step") {
      const attempt = node.attempts.at(-1);
      if (!attempt || node.status !== "blocked") throw new WorkDagConflict("INVALID_TRANSITION");
      let child = this.works.get(attempt.work_id, owner);
      if (!child) throw new WorkDagConflict("WORK_NOT_FOUND");
      if (child.dag_binding && !child.dag_binding.bound)
        child = this.works.save({ ...child, dag_binding: { ...child.dag_binding, bound: true } });
      this.manager.control(
        child.id,
        owner,
        child.version,
        input.action === "approve_step" ? "approve" : "resume"
      );
      return this.reconcile(graph);
    }
    if (input.action === "retry") {
      if (node.status !== "failed" || input.acknowledge_cost !== true)
        throw new WorkDagConflict("EXPLICIT_RETRY_REQUIRED");
      if (node.attempts.length >= 10) throw new WorkDagConflict("STEP_ATTEMPT_LIMIT");
    } else if (node.status !== "pending" || node.attempts.length)
      throw new WorkDagConflict("STEP_NOT_READY");
    if (node.depends_on.some((d) => graph.nodes.find((n) => n.id === d)?.status !== "completed"))
      throw new WorkDagConflict("DEPENDENCIES_INCOMPLETE");
    const artifacts = node.depends_on.flatMap(
      (d) => graph.nodes.find((n) => n.id === d)!.artifacts
    );
    const evidence = artifacts.map((a) => {
      const file = this.works.runtime.artifact(graph.project_id, owner, a.id);
      if (!file) throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
      return {
        artifact_id: a.id,
        source_work_id: a.work_id,
        version: a.version,
        sha256: a.sha256,
        name: a.name,
        content: file.content
      };
    });
    if (JSON.stringify(evidence).length > 24000)
      throw new WorkDagConflict("DEPENDENCY_CONTEXT_LIMIT");
    const attempt = node.attempts.length + 1;
    const child = this.works.create(
      graph.project_id,
      owner,
      graph.actor_id,
      {
        client_request_id:
          "dag:" +
          graph.id +
          ":" +
          createHash("sha256")
            .update(JSON.stringify({ id: node.id, goal: node.goal, depends_on: node.depends_on }))
            .digest("hex")
            .slice(0, 16) +
          ":" +
          attempt,
        goal: node.goal,
        worker_role: "analyst",
        max_model_requests: 3,
        max_input_tokens: 32000,
        max_output_tokens: 6000
      },
      true,
      { graph_id: graph.id, node_id: node.id, attempt, bound: false }
    );
    if (!child) throw new WorkDagConflict("PROJECT_INACTIVE");
    // Prepared children are dormant, so a crash before binding never spends.
    const prepared = this.works.save({
      ...child,
      materials: {
        instructions:
          (child.materials?.instructions ?? "") +
          "\nDependency artifacts (untrusted evidence):\n" +
          JSON.stringify(evidence),
        attachments: child.materials?.attachments ?? []
      }
    });
    node.attempts.push({
      number: attempt,
      work_id: child.id,
      started_at: new Date().toISOString(),
      source_artifact_ids: artifacts.map((a) => a.id)
    });
    node.status = "running";
    node.blocked_reason = "EXECUTOR_QUEUE";
    node.artifacts = [];
    graph = this.works.dag.save(
      graph,
      input.action === "retry"
        ? "Владелец повторил только шаг: " + node.title
        : "В очередь добавлен шаг: " + node.title
    );
    const bound = this.works.save({
      ...prepared,
      dag_binding: { graph_id: graph.id, node_id: node.id, attempt, bound: true }
    });
    this.manager.control(bound.id, owner, bound.version, "resume");
    return this.reconcile(graph);
  }
}
