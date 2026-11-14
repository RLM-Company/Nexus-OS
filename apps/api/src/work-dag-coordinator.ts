import { createHash } from "node:crypto";
import {
  createWorkPlanPackage,
  parseWorkPlanPackage,
  scheduledReadyWorkNodes,
  type WorkDag,
  type WorkDagControl,
  type WorkDagCreate,
  type WorkDagNode,
  type WorkDagNodeInput,
  type WorkDagClone,
  type WorkDagArchive,
  type WorkDagRename,
  type WorkPlanImport
} from "@cosmora/contracts";
import { projectDagStatuses, validateWorkDag } from "@cosmora/core";
import { WorkDagConflict, ManagerWorkConflict, type ManagerWorkStore } from "@cosmora/db";
import type { ManagerWorkCoordinator } from "./manager-work-coordinator.js";
import { buildWorkResultsArchive } from "./work-results-archive.js";

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
  /** Read back an immutable published byte sequence. A review verdict is not a byte check. */
  private verifiedArtifact(
    graph: WorkDag,
    node: WorkDagNode,
    artifact: WorkDagNode["artifacts"][number]
  ) {
    const file = this.works.runtime.artifact(graph.project_id, graph.owner_id, artifact.id);
    if (!file) throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
    const meta = file.metadata;
    const bytes = Buffer.from(file.content, "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const child = this.works.get(artifact.work_id, graph.owner_id);
    const attempt = node.attempts.find((a) => a.work_id === artifact.work_id);
    if (
      !meta.published ||
      !child ||
      child.owner_id !== graph.owner_id ||
      child.project_id !== graph.project_id ||
      child.status !== "completed" ||
      child.stage !== "done" ||
      child.dag_binding?.graph_id !== graph.id ||
      child.dag_binding.node_id !== node.id ||
      child.dag_binding.attempt !== attempt?.number ||
      !attempt ||
      artifact.work_id !== child.id ||
      artifact.version !== meta.version ||
      artifact.name !== meta.name ||
      artifact.sha256 !== meta.sha256 ||
      artifact.bytes !== meta.bytes ||
      bytes.length !== meta.bytes ||
      digest !== meta.sha256 ||
      digest !== artifact.sha256 ||
      meta.project_id !== graph.project_id ||
      meta.work_id !== artifact.work_id
    )
      throw new WorkDagConflict("DEPENDENCY_ARTIFACT_MISSING");
    return { metadata: meta, content: file.content, bytes, digest };
  }
  create(project: string, owner: string, actor: string, input: WorkDagCreate): WorkDag {
    this.validate(input.nodes);
    return this.works.dag.create(project, owner, actor, input);
  }
  clone(project: string, id: string, owner: string, actor: string, input: WorkDagClone): WorkDag {
    return this.works.dag.clone(project, id, owner, actor, input);
  }
  import(project: string, owner: string, actor: string, input: WorkPlanImport): WorkDag {
    const pkg = parseWorkPlanPackage(input.package);
    return this.create(project, owner, actor, {
      client_request_id: input.client_request_id,
      title: pkg.title,
      nodes: pkg.nodes
    });
  }
  package(id: string, owner: string, project: string) {
    const graph = this.works.dag.get(id, owner);
    if (!graph || graph.project_id !== project) throw new WorkDagConflict("DAG_NOT_FOUND");
    return createWorkPlanPackage(graph);
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
  /** A restart never silently re-arms future billable stages. */
  recoverAutomation(): void {
    for (const graph of this.works.dag.active()) {
      if (!graph.execution || !["running", "waiting"].includes(graph.execution.status)) continue;
      if (!this.works.ownerWritable(graph.owner_id)) continue;
      graph.execution.status = "paused";
      graph.execution.reason = "RESTART_REQUIRES_RESUME";
      this.works.dag.save(graph, "После перезапуска автозапуск ожидает явного продолжения");
    }
  }
  /** Model calls already made or admitted to unfinished child tasks. */
  private allocatedRequests(graph: WorkDag): number {
    const ids = new Set(graph.nodes.flatMap((node) => node.attempts.map((a) => a.work_id)));
    let allocated = 0;
    for (const id of ids) {
      const child = this.works.get(id, graph.owner_id);
      if (!child) throw new WorkDagConflict("WORK_NOT_FOUND");
      allocated += ["completed", "failed", "cancelled"].includes(child.status)
        ? child.model_requests
        : Math.max(child.model_requests, child.request.max_model_requests ?? 3);
    }
    return allocated;
  }
  /** Parts occupying an execution slot: running or awaiting the executor/owner. */
  private liveAttempts(graph: WorkDag): number {
    const ids = new Set(graph.nodes.flatMap((node) => node.attempts.map((a) => a.work_id)));
    let live = 0;
    for (const id of ids) {
      const child = this.works.get(id, graph.owner_id);
      if (!child) throw new WorkDagConflict("WORK_NOT_FOUND");
      if (!["completed", "failed", "cancelled"].includes(child.status)) live++;
    }
    return live;
  }
  /** Timer-only scheduling: GET/reconciliation never starts a paid operation. */
  advance(): void {
    for (const record of this.works.dag.active()) {
      if (!record.execution || !["running", "waiting"].includes(record.execution.status)) continue;
      if (!this.works.ownerWritable(record.owner_id)) continue;
      try {
        const graph = this.reconcile(record);
        if (graph.execution?.status !== "running" || graph.mode !== "active") continue;
        const capacity = this.manager.capacity();
        // A bounded wave: never admit more concurrent parts than the shared cap,
        // counting attempts that are still running or waiting inside the executor.
        const free = capacity - this.liveAttempts(graph);
        if (free <= 0) continue;
        const block = this.manager.schedulingBlock(graph.project_id, graph.owner_id);
        if (block) {
          graph.execution.status = "paused";
          graph.execution.reason = block;
          this.works.dag.save(graph, "Автозапуск остановлен до снятия ограничения");
          continue;
        }
        const ready = scheduledReadyWorkNodes(graph).slice(0, free);
        if (!ready.length) continue;
        // allocatedRequests() already reserves a full 3-request budget for every
        // live child; reserve one more budget per node launched this tick, never
        // more than the free slots. This keeps the cap's total reserve honest
        // without double-charging live attempts against the owner's plan limit.
        if (this.allocatedRequests(graph) + 3 * ready.length > graph.execution.max_model_requests) {
          graph.execution.status = "stopped";
          graph.execution.reason = "PLAN_REQUEST_LIMIT";
          this.works.dag.save(graph, "Достигнут общий лимит запросов плана; новый шаг не запущен");
          continue;
        }
        for (const node of ready) {
          // Each control() is a CAS write that bumps graph.version. Re-read the
          // durable version so a second launch in the same wave cannot go stale.
          const latest = this.works.dag.get(graph.id, graph.owner_id);
          if (!latest) break;
          this.control(
            graph.id,
            graph.owner_id,
            { version: latest.version, action: "run", node_id: node.id },
            true
          );
        }
      } catch (error) {
        if (!(error instanceof WorkDagConflict || error instanceof ManagerWorkConflict))
          throw error;
        const graph = this.works.dag.get(record.id, record.owner_id);
        if (graph?.execution && this.works.ownerWritable(record.owner_id)) {
          graph.execution.status = "stopped";
          graph.execution.reason = error.message;
          this.works.dag.save(graph, "Автозапуск остановлен; сохранённые результаты доступны");
        }
      }
    }
  }
  private reconcile(graph: WorkDag): WorkDag {
    if (graph.archived_at || !this.works.ownerWritable(graph.owner_id)) return graph;
    const next = structuredClone(graph);
    const ids = new Set(next.nodes.flatMap((node) => node.attempts.map((a) => a.work_id)));
    next.usage = { model_requests: 0, reserved_input_tokens: 0, reserved_output_tokens: 0 };
    for (const id of ids) {
      const child = this.works.get(id, graph.owner_id);
      if (child) {
        next.usage.model_requests += child.model_requests;
        next.usage.reserved_input_tokens += child.reserved_input_tokens;
        next.usage.reserved_output_tokens += child.reserved_output_tokens;
      }
    }
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
        sources: child.result_sources ?? [],
        verification: {
          file_bytes: "not_checked_by_reconcile",
          content_review: child.review?.verdict === "PASS" ? "model_critic_pass" : "not_passed",
          code_executed: false,
          owner_accepted: false
        }
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
    if (projected.execution) {
      const execution = projected.execution;
      if (projected.nodes.every((node) => node.status === "completed")) {
        execution.status = "completed";
        execution.reason = null;
      } else if (["running", "waiting"].includes(execution.status)) {
        const failure = projected.nodes.find((node) =>
          ["failed", "cancelled"].includes(node.status)
        );
        const waiting = projected.nodes.find(
          (node) => node.status === "blocked" && node.attempts.length
        );
        if (failure) {
          execution.status = "failed";
          execution.reason = "STEP_FAILED";
        } else if (waiting) {
          execution.status = "waiting";
          execution.reason = waiting.blocked_reason;
        } else {
          execution.status = "running";
          execution.reason = null;
        }
      }
    }
    return JSON.stringify({
      nodes: projected.nodes,
      execution: projected.execution
    }) ===
      JSON.stringify({
        nodes: graph.nodes,
        execution: graph.execution
      })
      ? projected
      : this.works.dag.save(projected, "Обновлено состояние шагов");
  }
  results(id: string, owner: string) {
    const graph = this.get(id, owner);
    if (!graph) throw new WorkDagConflict("DAG_NOT_FOUND");
    return this.resultsFor(graph);
  }
  resultsArchive(id: string, owner: string): Buffer {
    const graph = this.get(id, owner);
    if (!graph) throw new WorkDagConflict("DAG_NOT_FOUND");
    return buildWorkResultsArchive(graph, this.resultsFor(graph).files);
  }
  private resultsFor(graph: WorkDag) {
    const files = graph.nodes
      .filter((node) => node.status === "completed")
      .flatMap((node) =>
        node.artifacts.map((artifact) => {
          const verified = this.verifiedArtifact(graph, node, artifact);
          return {
            node_id: node.id,
            title: node.title,
            ...verified.metadata,
            content: verified.content,
            review: node.result?.review ?? null,
            sources: node.result?.sources ?? [],
            verification: {
              file_created: true,
              file_bytes: "verified",
              content_review:
                node.result?.review?.verdict === "PASS" ? "model_critic_pass" : "not_passed",
              code_executed: false,
              owner_accepted: false
            }
          };
        })
      );
    const bundle = {
      schema_version: 1,
      graph_id: graph.id,
      title: graph.title,
      completed_steps: graph.nodes.filter((node) => node.status === "completed").length,
      total_steps: graph.nodes.length,
      files
    };
    if (Buffer.byteLength(JSON.stringify(bundle)) > 2000000)
      throw new WorkDagConflict("RESULTS_LIMIT");
    return bundle;
  }
  rename(id: string, owner: string, input: WorkDagRename): WorkDag {
    const graph = this.current(id, owner, input.expected_version);
    if (graph.title === input.title) return graph;
    graph.title = input.title;
    return this.works.dag.save(graph, "Название плана изменено");
  }
  archive(id: string, owner: string, input: WorkDagArchive): WorkDag {
    const graph = this.current(id, owner, input.expected_version, true);
    if (Boolean(graph.archived_at) === input.archived) return graph;
    if (input.archived) {
      if (graph.execution && ["running", "waiting"].includes(graph.execution.status))
        throw new WorkDagConflict("AUTO_PLAN_ACTIVE");
      // Check canonical child records, including older attempts. A paused or
      // awaiting-approval child is still resumable and cannot be hidden away.
      for (const attempt of graph.nodes.flatMap((n) => n.attempts)) {
        const child = this.works.get(attempt.work_id, owner);
        if (
          !child ||
          !["completed", "failed", "cancelled"].includes(child.status) ||
          this.manager.hasActiveExecution(child.id)
        )
          throw new WorkDagConflict("PLAN_HAS_UNFINISHED_WORK");
      }
      graph.archived_at = new Date().toISOString();
    } else {
      delete graph.archived_at;
      graph.mode = this.works.dag.projectMode(graph.project_id, owner);
    }
    if (graph.execution && graph.execution.status !== "completed") {
      graph.execution.status = "stopped";
      graph.execution.reason = input.archived ? "PLAN_ARCHIVED" : "RESTORED_REQUIRES_START";
    }
    return this.works.dag.save(
      projectDagStatuses(graph),
      input.archived ? "План перемещён в архив" : "План восстановлен; запуск выполняется отдельно"
    );
  }
  private current(id: string, owner: string, version: number, allowArchived = false): WorkDag {
    this.works.assertWritable(owner);
    const graph = this.works.dag.get(id, owner);
    if (!graph) throw new WorkDagConflict("DAG_NOT_FOUND");
    if (graph.version !== version) throw new WorkDagConflict("STALE_DAG");
    if (graph.archived_at && !allowArchived) throw new WorkDagConflict("PLAN_ARCHIVED");
    return this.reconcile(graph);
  }
  edit(id: string, owner: string, version: number, nodes: WorkDagNodeInput[]): WorkDag {
    const graph = this.current(id, owner, version);
    if (graph.mode === "cancelled") throw new WorkDagConflict("PROJECT_CANCELLED");
    if (graph.execution && ["running", "waiting"].includes(graph.execution.status))
      throw new WorkDagConflict("AUTO_PLAN_ACTIVE");
    this.validate(nodes);
    for (const old of graph.nodes.filter((n) => n.attempts.length || n.status === "cancelled")) {
      const updated = nodes.find((n) => n.id === old.id);
      if (
        !updated ||
        updated.title !== old.title ||
        updated.goal !== old.goal ||
        JSON.stringify(updated.depends_on) !== JSON.stringify(old.depends_on) ||
        updated.requires_critic !== old.requires_critic ||
        (updated.priority ?? "normal") !== (old.priority ?? "normal") ||
        (updated.deadline ?? null) !== (old.deadline ?? null)
      )
        throw new WorkDagConflict("STEP_ALREADY_STARTED");
    }
    graph.nodes = nodes.map((n) => {
      const previous = graph.nodes.find((p) => p.id === n.id);
      return previous?.attempts.length || previous?.status === "cancelled"
        ? previous
        : { ...n, status: "pending", blocked_reason: null, attempts: [], artifacts: [] };
    });
    if (graph.execution) {
      graph.execution.status = "stopped";
      graph.execution.reason = "PLAN_EDITED";
    }
    return this.works.dag.save(projectDagStatuses(graph), "Не запущенные шаги отредактированы");
  }
  control(id: string, owner: string, input: WorkDagControl, automated = false): WorkDag {
    let graph = this.current(id, owner, input.version);
    if (input.action === "cancel_step") {
      const node = graph.nodes.find((n) => n.id === input.node_id);
      if (!node) throw new WorkDagConflict("STEP_NOT_FOUND");
      if (node.status === "cancelled") return graph;
      if (["completed", "failed"].includes(node.status)) throw new WorkDagConflict("TERMINAL_STEP");
      const attempt = node.attempts.at(-1);
      if (attempt) {
        const child = this.works.get(attempt.work_id, owner);
        if (!child) throw new WorkDagConflict("WORK_NOT_FOUND");
        // Cancel the canonical child first. If the graph checkpoint fails,
        // reconciliation observes the terminal child and stops automation.
        this.manager.control(child.id, owner, child.version, "cancel");
      }
      node.status = "cancelled";
      node.blocked_reason = "STEP_CANCELLED_BY_OWNER";
      if (graph.execution) {
        graph.execution.status = "stopped";
        graph.execution.reason = "STEP_CANCELLED_BY_OWNER";
      }
      return this.works.dag.save(
        projectDagStatuses(graph),
        "Владелец отменил только шаг: " + node.title
      );
    }
    if (input.action === "run_plan" || input.action === "stop_plan") {
      if (input.action === "stop_plan") {
        if (!graph.execution) throw new WorkDagConflict("INVALID_TRANSITION");
        graph.execution.status = "stopped";
        graph.execution.reason = "STOPPED_BY_OWNER";
        return this.works.dag.save(graph, "Автозапуск остановлен; текущая работа не повторяется");
      }
      if (
        graph.mode !== "active" ||
        this.works.dag.projectMode(graph.project_id, owner) !== "active"
      )
        throw new WorkDagConflict("PROJECT_PAUSED");
      if (!input.acknowledge_cost) throw new WorkDagConflict("EXPLICIT_RETRY_REQUIRED");
      const limit = input.max_model_requests;
      if (!Number.isInteger(limit) || !limit || limit < 3 || limit > 96)
        throw new WorkDagConflict("INVALID_PLAN_BUDGET");
      const block = this.manager.schedulingBlock(graph.project_id, owner);
      if (block) throw new WorkDagConflict(block);
      if (graph.nodes.some((node) => ["failed", "cancelled"].includes(node.status)))
        throw new WorkDagConflict("STEP_FAILED");
      if (graph.nodes.every((node) => node.status === "completed"))
        throw new WorkDagConflict("PLAN_COMPLETED");
      const allocation = this.allocatedRequests(graph);
      // Budget the first wave: up to cap ready nodes can start on the next tick,
      // each reserving three requests. allocatedRequests() already covers any
      // live attempts from a previously paused plan.
      const firstWave = Math.min(this.manager.capacity(), scheduledReadyWorkNodes(graph).length);
      if (allocation + 3 * firstWave > limit) throw new WorkDagConflict("PLAN_REQUEST_LIMIT");
      graph.execution = {
        status: "running",
        max_model_requests: limit,
        reason: null,
        started_at: graph.execution?.started_at ?? new Date().toISOString()
      };
      return this.works.dag.save(
        graph,
        "Владелец разрешил выполнение плана с ограниченным параллелизмом в общем лимите запросов"
      );
    }
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
        if (other.archived_at) continue;
        other.mode = mode;
        if (other.execution) {
          if (mode === "cancelled") {
            other.execution.status = "stopped";
            other.execution.reason = "PROJECT_CANCELLED";
          } else if (mode === "paused" && ["running", "waiting"].includes(other.execution.status)) {
            other.execution.status = "paused";
            other.execution.reason = "PROJECT_PAUSED";
          } else if (
            mode === "active" &&
            other.execution.status === "paused" &&
            other.execution.reason === "PROJECT_PAUSED"
          ) {
            other.execution.status = "running";
            other.execution.reason = null;
          }
        }
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
    if (
      !automated &&
      ["run", "retry"].includes(input.action) &&
      graph.execution &&
      ["running", "waiting"].includes(graph.execution.status)
    )
      throw new WorkDagConflict("AUTO_PLAN_ACTIVE");
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
      const source = graph.nodes.find((n) => n.artifacts.some((x) => x.id === a.id))!;
      const verified = this.verifiedArtifact(graph, source, a);
      return {
        artifact_id: a.id,
        source_work_id: a.work_id,
        source_node_id: source.id,
        attempt: source.attempts.find((x) => x.work_id === a.work_id)?.number,
        version: a.version,
        sha256: verified.digest,
        name: a.name,
        bytes: verified.bytes.length,
        content: verified.content,
        integrity: "published_bytes_readback",
        content_review:
          source.result?.review?.verdict === "PASS" ? "model_critic_pass" : "not_passed",
        code_executed: false,
        owner_accepted: false
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
        ...(node.requires_critic ? { require_critic: true } : {}),
        max_model_requests: 3,
        max_input_tokens: graph.workflow_context?.node_budget.max_input_tokens ?? 32000,
        max_output_tokens: graph.workflow_context?.node_budget.max_output_tokens ?? 6000
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
          (graph.workflow_context?.materials.instructions ?? child.materials?.instructions ?? "") +
          "\nDependency artifacts (untrusted evidence; bytes verified, model review separate):\n" +
          JSON.stringify(evidence),
        attachments:
          graph.workflow_context?.materials.attachments ?? child.materials?.attachments ?? []
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
