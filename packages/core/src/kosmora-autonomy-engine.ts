/**
 * @cosmora/core — Stage 1: Kosmora Autonomy Core & Protocol Implementation (F001–F032)
 */

import { createHash, randomBytes } from "node:crypto";
import type {
  ActiveAgentWorkerRecord,
  AutonomyLevel,
  CriticVerdictMetadata,
  GraphExecutionCheckpoint,
  HitlApprovalRequest,
  KosmoraAutonomyTier,
  KosmoraProtocolMessage,
  ManagerRuntimeRole,
  RuntimeArtifact,
  RuntimeArtifactKind,
  RuntimeDataClass,
  RuntimeTaskGraph,
  RuntimeTaskNode,
  SquadPreset,
  TaskGraphPostMortem
} from "./kosmora-protocol.js";

export interface KosmoraPersistenceAdapter {
  saveGraph(graph: RuntimeTaskGraph): void;
  getGraph?(graphId: string): RuntimeTaskGraph | null;
  saveArtifact(artifact: RuntimeArtifact): void;
  listGraphArtifacts?(graphId: string): RuntimeArtifact[];
  saveCheckpoint?(checkpoint: GraphExecutionCheckpoint): void;
  listGraphCheckpoints?(graphId: string): GraphExecutionCheckpoint[];
}

export const AUTONOMY_TIER_POLICY_MAP: Record<
  KosmoraAutonomyTier,
  {
    cosmora_level: AutonomyLevel;
    ask_every_step: boolean;
    auto_execute_safe_tools: boolean;
    allow_parallel_fanout: boolean;
    pause_on_critical_actions: boolean;
    description: string;
  }
> = {
  L1: {
    cosmora_level: "A1",
    ask_every_step: true,
    auto_execute_safe_tools: false,
    allow_parallel_fanout: false,
    pause_on_critical_actions: true,
    description: "Пошаговое подтверждение каждого узла графа пользователем"
  },
  L2: {
    cosmora_level: "A2",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: false,
    pause_on_critical_actions: true,
    description: "Автоматическое чтение и анализ, подтверждение перед записью"
  },
  L3: {
    cosmora_level: "A3",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: true,
    pause_on_critical_actions: true,
    description:
      "Параллельное исполнение суб-агентов с ревью Критика и паузой на критических операциях"
  },
  L4: {
    cosmora_level: "A5",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: true,
    pause_on_critical_actions: true,
    description: "Высокая автономия внутри воркспейса с защитой продакшен-контура"
  },
  L5: {
    cosmora_level: "A6",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: true,
    pause_on_critical_actions: false,
    description: "Полный автопилот с итоговым отчётом и проверкой графа происхождения"
  }
};

export const DEFAULT_SQUAD_PRESETS: SquadPreset[] = [
  {
    preset_id: "squad-engineering-release",
    name: "Аналитик + Кодер + QA + Критик",
    description: "Полный цикл проектирования, написания кода, юнит-тестов и ревью",
    roles: ["manager", "analyst", "coder", "qa", "critic"],
    default_autonomy_tier: "L3",
    critic_strictness: "production_grade"
  },
  {
    preset_id: "squad-research-content",
    name: "Ресерчер + Копирайтер + Дизайнер + Критик",
    description:
      "Глубокое исследование, подготовка аналитического отчёта и презентации на Canvas",
    roles: ["manager", "researcher", "copywriter", "designer", "critic"],
    default_autonomy_tier: "L3",
    critic_strictness: "standard"
  },
  {
    preset_id: "squad-architecture-redteam",
    name: "Архитектор + Адвокат дьявола + Критик",
    description:
      "Стресс-тестирование архитектуры и бизнес-плана на уязвимости и узкие места",
    roles: ["manager", "architect", "devils_advocate", "critic"],
    default_autonomy_tier: "L4",
    critic_strictness: "production_grade"
  }
];

export type KosmoraEventType =
  | "protocol:message"
  | "task:started"
  | "task:completed"
  | "task:cancelled"
  | "task:paused_hitl"
  | "task:rolled_back"
  | "artifact:bound"
  | "critic:verdict"
  | "thought:stream"
  | "conflict:resolved"
  | "postmortem:created";

export interface KosmoraEvent<T = unknown> {
  type: KosmoraEventType;
  graph_id: string;
  task_id?: string;
  timestamp: string;
  data: T;
}

export class KosmoraEventBus {
  private readonly listeners = new Map<
    KosmoraEventType | "*",
    Array<(ev: KosmoraEvent) => void>
  >();
  private readonly history: KosmoraEvent[] = [];

  public subscribe(
    type: KosmoraEventType | "*",
    handler: (ev: KosmoraEvent) => void
  ): () => void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
    return () => {
      const current = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        current.filter((h) => h !== handler)
      );
    };
  }

  public publish<T>(event: KosmoraEvent<T>): void {
    this.history.push(structuredClone(event));
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler(event);
    }
    for (const handler of this.listeners.get("*") ?? []) {
      handler(event);
    }
  }

  public getHistory(graphId?: string): KosmoraEvent[] {
    return graphId
      ? this.history.filter((e) => e.graph_id === graphId).map((e) => structuredClone(e))
      : this.history.map((e) => structuredClone(e));
  }
}

export interface ModelRouteSelection {
  route_id: string;
  provider_id: string;
  model_id: string;
  tier: "fast_economy" | "balanced" | "flagship_reasoning";
  estimated_cost_per_1k_tokens: number;
}

export class DynamicLlmRouter {
  public selectRoute(params: {
    role: ManagerRuntimeRole;
    complexity: "simple" | "moderate" | "complex";
    tokenBudgetRemaining: number;
  }): ModelRouteSelection {
    if (
      !Number.isFinite(params.tokenBudgetRemaining) ||
      params.tokenBudgetRemaining < 0
    ) {
      throw new Error("tokenBudgetRemaining must be a non-negative finite number.");
    }
    if (
      params.complexity === "complex" ||
      params.role === "architect" ||
      params.role === "critic" ||
      params.role === "devils_advocate"
    ) {
      if (params.tokenBudgetRemaining >= 2000) {
        return {
          route_id: "route-flagship-reasoning",
          provider_id: "gemini",
          model_id: "gemini-2.5-pro-reasoning",
          tier: "flagship_reasoning",
          estimated_cost_per_1k_tokens: 0.005
        };
      }
    }
    if (params.complexity === "simple" || params.tokenBudgetRemaining < 1000) {
      return {
        route_id: "route-fast-flash",
        provider_id: "gemini",
        model_id: "gemini-2.5-flash",
        tier: "fast_economy",
        estimated_cost_per_1k_tokens: 0.0005
      };
    }
    return {
      route_id: "route-balanced-standard",
      provider_id: "gemini",
      model_id: "gemini-2.5-pro",
      tier: "balanced",
      estimated_cost_per_1k_tokens: 0.002
    };
  }
}

export class KosmoraAutonomyEngine {
  public readonly eventBus = new KosmoraEventBus();
  public readonly router = new DynamicLlmRouter();

  private persistence: KosmoraPersistenceAdapter | null = null;
  private readonly graphs = new Map<string, RuntimeTaskGraph>();
  private readonly artifacts = new Map<string, RuntimeArtifact>();
  private readonly checkpoints = new Map<string, GraphExecutionCheckpoint[]>();
  private readonly hitlApprovals = new Map<string, HitlApprovalRequest>();
  private readonly approvalTokenIndex = new Map<string, string>();
  private readonly completedDeliveries = new Map<
    string,
    {
      status: RuntimeTaskNode["status"];
      node: RuntimeTaskNode;
      already_completed: boolean;
      idempotent_replay: boolean;
    }
  >();
  private readonly toolCallCache = new Map<
    string,
    { output: unknown; cached_at: string }
  >();
  private readonly rolePrompts = new Map<
    ManagerRuntimeRole,
    { version: string; system_prompt: string }
  >();
  private readonly activeWorkers = new Map<string, ActiveAgentWorkerRecord>();
  private readonly thoughtStreamLogs = new Map<string, string[]>();

  constructor(persistence?: KosmoraPersistenceAdapter) {
    this.persistence = persistence ?? null;
    this.initializeDefaultRolePrompts();
  }

  public attachPersistenceStore(store: KosmoraPersistenceAdapter): void {
    this.persistence = store;
  }

  private initializeDefaultRolePrompts(): void {
    const defaults: Record<ManagerRuntimeRole, string> = {
      manager:
        "Ты — Kosmora Manager. Декомпозируй цели в DAG, контролируй бюджет и проверяй provenance.",
      architect:
        "Ты — Системный Архитектор Kosmora. Проектируй надёжные модульные контракты и схемы.",
      researcher:
        "Ты — Агент-Исследователь. Собирай проверяемые факты с точными ссылками на источники.",
      analyst:
        "Ты — Системный Аналитик. Строй таблицы, модели и выводы с привязкой к первичным данным.",
      coder:
        "Ты — Инженер-Разработчик. Пиши типизированный, чистый код без заглушек и с тестами.",
      qa: "Ты — QA-Инженер. Проверяй граничные случаи, контракты ввода-вывода и регрессии.",
      copywriter:
        "Ты — Редактор отчётов. Формируй структурированные документы для Kosmora Canvas.",
      designer:
        "Ты — Дизайнер презентаций и диаграмм. Проектируй визуально чистые слайды и схемы.",
      devils_advocate:
        "Ты — Адвокат дьявола (Red Team). Ищи скрытые риски, слабые места и ошибочные допущения в плане.",
      critic:
        "Ты — Агент-Критик Kosmora. Проверяй артефакты на полноту, точность, безопасность и соответствие ТЗ."
    };
    for (const [role, prompt] of Object.entries(defaults) as Array<
      [ManagerRuntimeRole, string]
    >) {
      this.rolePrompts.set(role, { version: "v1.0", system_prompt: prompt });
    }
  }

  public createProtocolEnvelope<TPayload>(params: {
    project_id: string;
    graph_id: string;
    task_id: string;
    sender_role: ManagerRuntimeRole;
    sender_instance_id: string;
    recipient_role: ManagerRuntimeRole | "broadcast";
    autonomy_tier: KosmoraAutonomyTier;
    token_budget_remaining: number;
    confidence_score?: number;
    payload: TPayload;
  }): KosmoraProtocolMessage<TPayload> {
    if (!params.project_id.trim() || !params.graph_id.trim() || !params.task_id.trim()) {
      throw new Error("project_id, graph_id, and task_id are required.");
    }
    if (
      !Number.isFinite(params.token_budget_remaining) ||
      params.token_budget_remaining < 0
    ) {
      throw new Error("token_budget_remaining must be a non-negative finite number.");
    }
    const policy = AUTONOMY_TIER_POLICY_MAP[params.autonomy_tier];
    const message: KosmoraProtocolMessage<TPayload> = {
      protocol_version: "1.0.0",
      message_id: `msg_${Date.now()}_${randomBytes(4).toString("hex")}`,
      correlation_id: `corr_${params.graph_id}_${params.task_id}`,
      project_id: params.project_id,
      graph_id: params.graph_id,
      task_id: params.task_id,
      sender_role: params.sender_role,
      sender_instance_id: params.sender_instance_id,
      recipient_role: params.recipient_role,
      timestamp: new Date().toISOString(),
      autonomy_tier: params.autonomy_tier,
      autonomy_level: policy.cosmora_level,
      token_budget_remaining: params.token_budget_remaining,
      ...(params.confidence_score !== undefined
        ? { confidence_score: params.confidence_score }
        : {}),
      payload: params.payload
    };
    this.eventBus.publish({
      type: "protocol:message",
      graph_id: params.graph_id,
      task_id: params.task_id,
      timestamp: message.timestamp,
      data: message
    });
    return message;
  }

  public hotSwapRolePrompt(
    role: ManagerRuntimeRole,
    newPrompt: string,
    version = `v1.${Date.now()}`
  ): {
    role: ManagerRuntimeRole;
    version: string;
    system_prompt: string;
  } {
    if (!newPrompt.trim()) {
      throw new Error("Role prompt cannot be empty.");
    }
    const updated = { version, system_prompt: newPrompt };
    this.rolePrompts.set(role, updated);
    return { role, ...updated };
  }

  public getRolePrompt(role: ManagerRuntimeRole): {
    version: string;
    system_prompt: string;
  } {
    return this.rolePrompts.get(role) ?? { version: "v1.0", system_prompt: "" };
  }

  public createTaskGraph(params: {
    graph_id: string;
    project_id: string;
    autonomy_tier: KosmoraAutonomyTier;
    total_token_budget: number;
    max_parallelism?: number;
    nodes: Array<
      Omit<
        RuntimeTaskNode,
        | "project_id"
        | "status"
        | "output_artifact_ids"
        | "iteration_count"
        | "tokens_consumed"
      >
    >;
  }): RuntimeTaskGraph {
    if (!params.graph_id.trim() || !params.project_id.trim()) {
      throw new Error("graph_id and project_id must be non-empty.");
    }
    if (
      !Number.isFinite(params.total_token_budget) ||
      params.total_token_budget <= 0
    ) {
      throw new Error("total_token_budget must be a positive finite integer.");
    }
    if (params.nodes.length === 0) {
      throw new Error("DAG must contain at least one task node.");
    }

    const seenIds = new Set<string>();
    for (const n of params.nodes) {
      if (!n.task_id.trim()) {
        throw new Error("Every task node must have a non-empty task_id.");
      }
      if (seenIds.has(n.task_id)) {
        throw new Error(`Duplicate task_id in DAG: ${n.task_id}`);
      }
      seenIds.add(n.task_id);
      if (!Number.isFinite(n.token_budget_limit) || n.token_budget_limit <= 0) {
        throw new Error(`Invalid token_budget_limit on task ${n.task_id}`);
      }
      if (!Number.isFinite(n.timeout_ms) || n.timeout_ms <= 0) {
        throw new Error(`Invalid timeout_ms on task ${n.task_id}`);
      }
      if (!Number.isFinite(n.max_iterations) || n.max_iterations < 1) {
        throw new Error(`Invalid max_iterations on task ${n.task_id}`);
      }
    }

    const fullNodes: RuntimeTaskNode[] = params.nodes.map((n) => ({
      ...n,
      project_id: params.project_id,
      status: n.depends_on.length === 0 ? "ready" : "pending",
      blocked_by_task_id: null,
      cancellation_reason: null,
      output_artifact_ids: [],
      iteration_count: 0,
      tokens_consumed: 0
    }));

    const topologicalOrder = this.computeTopologicalOrder(fullNodes);

    const now = new Date().toISOString();
    const graph: RuntimeTaskGraph = {
      contract_version: 1,
      graph_id: params.graph_id,
      project_id: params.project_id,
      root_task_id: topologicalOrder[0] ?? fullNodes[0]!.task_id,
      autonomy_tier: params.autonomy_tier,
      autonomy_level: AUTONOMY_TIER_POLICY_MAP[params.autonomy_tier].cosmora_level,
      max_parallelism: params.max_parallelism ?? 4,
      topological_order: topologicalOrder,
      total_token_budget: params.total_token_budget,
      total_tokens_consumed: 0,
      nodes: fullNodes,
      created_at: now,
      updated_at: now
    };

    this.graphs.set(graph.graph_id, graph);
    this.persistence?.saveGraph(graph);
    this.saveCheckpoint(graph.graph_id, graph.root_task_id, "Initial DAG created");
    return graph;
  }

  public computeTopologicalOrder(nodes: RuntimeTaskNode[]): string[] {
    const nodeMap = new Map(nodes.map((n) => [n.task_id, n]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Cycle detected in Task Graph involving node: ${taskId}`);
      }
      const node = nodeMap.get(taskId);
      if (!node) {
        throw new Error(`Missing dependency task node: ${taskId}`);
      }
      visiting.add(taskId);
      for (const depId of node.depends_on) {
        if (!nodeMap.has(depId)) {
          throw new Error(
            `Task ${taskId} depends on non-existent task node: ${depId}`
          );
        }
        visit(depId);
      }
      visiting.delete(taskId);
      visited.add(taskId);
      order.push(taskId);
    };

    for (const n of nodes) {
      visit(n.task_id);
    }
    return order;
  }

  private propagateDependencyStates(graph: RuntimeTaskGraph): void {
    const nodeMap = new Map(graph.nodes.map((n) => [n.task_id, n]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of graph.nodes) {
        if (node.status === "pending" || node.status === "ready") {
          const failedOrCancelledDep = node.depends_on.find((depId) => {
            const dep = nodeMap.get(depId);
            return (
              dep?.status === "failed" ||
              dep?.status === "cancelled" ||
              dep?.status === "blocked"
            );
          });
          if (failedOrCancelledDep) {
            node.status = "blocked";
            node.blocked_by_task_id = failedOrCancelledDep;
            changed = true;
            continue;
          }
          if (
            node.status === "pending" &&
            node.depends_on.every((depId) => nodeMap.get(depId)?.status === "completed")
          ) {
            node.status = "ready";
            changed = true;
          }
        }
      }
    }
  }

  public getReadyTaskBatch(
    graphId: string,
    maxParallelismOverride?: number
  ): RuntimeTaskNode[] {
    const graph = this.getGraphOrThrow(graphId);
    this.propagateDependencyStates(graph);
    const policy = AUTONOMY_TIER_POLICY_MAP[graph.autonomy_tier];
    const limit = !policy.allow_parallel_fanout
      ? 1
      : Math.max(1, maxParallelismOverride ?? graph.max_parallelism ?? 4);

    return graph.nodes
      .filter((n) => n.status === "ready")
      .sort((a, b) => b.priority_weight - a.priority_weight)
      .slice(0, limit);
  }

  public reprioritizeTask(
    graphId: string,
    taskId: string,
    newPriorityWeight: number
  ): RuntimeTaskNode {
    if (!Number.isFinite(newPriorityWeight)) {
      throw new Error("newPriorityWeight must be a finite number.");
    }
    const graph = this.getGraphOrThrow(graphId);
    const node = graph.nodes.find((n) => n.task_id === taskId);
    if (!node) throw new Error(`Task ${taskId} not found in graph ${graphId}`);
    node.priority_weight = newPriorityWeight;
    graph.updated_at = new Date().toISOString();
    this.persistence?.saveGraph(graph);
    return node;
  }

  public cancelTask(
    graphId: string,
    taskId: string,
    reason = "Cancelled by operator"
  ): RuntimeTaskNode {
    const graph = this.getGraphOrThrow(graphId);
    const node = graph.nodes.find((n) => n.task_id === taskId);
    if (!node) throw new Error(`Task ${taskId} not found in graph ${graphId}`);
    if (node.status === "completed") {
      throw new Error(`Cannot cancel already completed task ${taskId}.`);
    }
    node.status = "cancelled";
    node.cancellation_reason = reason;
    this.propagateDependencyStates(graph);
    graph.updated_at = new Date().toISOString();
    this.persistence?.saveGraph(graph);
    this.eventBus.publish({
      type: "task:cancelled",
      graph_id: graphId,
      task_id: taskId,
      timestamp: graph.updated_at,
      data: { reason }
    });
    return node;
  }

  public requestHitlApproval(
    paramsOrPlan:
      | { graph_id: string; task_id: string; action_kind: string }
      | KosmoraDagPlan,
    nodeId?: string,
    actionScope?: string
  ): HitlApprovalRequest & { approval_token: string } {
    if ("plan_id" in paramsOrPlan) {
      const plan = paramsOrPlan;
      const targetNodeId = nodeId ?? "";
      const node = plan.nodes.find((n) => n.node_id === targetNodeId);
      if (!node) {
        throw new Error(`DAG node '${targetNodeId}' not found in plan '${plan.plan_id}'`);
      }
      const key = `${plan.plan_id}::${targetNodeId}`;
      const token = `hitl_tok_${plan.plan_id}_${targetNodeId}_${randomBytes(8).toString("hex")}`;
      const req: HitlApprovalRequest & { approval_token: string } = {
        approval_id: `hitl_${plan.plan_id}_${targetNodeId}_${randomBytes(4).toString("hex")}`,
        graph_id: plan.plan_id,
        project_id: plan.project_id,
        task_id: targetNodeId,
        action_kind: actionScope ?? node.hitl_action_scope ?? "critical_action",
        status: "pending",
        requested_at: new Date().toISOString(),
        approval_token: token
      };
      this.hitlApprovals.set(key, req);
      return req;
    }
    const graph = this.getGraphOrThrow(paramsOrPlan.graph_id);
    const key = `${paramsOrPlan.graph_id}::${paramsOrPlan.task_id}`;
    const existing = this.hitlApprovals.get(key);
    if (existing && existing.status === "pending" && existing.approval_token) {
      return existing as HitlApprovalRequest & { approval_token: string };
    }
    const token = `hitl_tok_${paramsOrPlan.graph_id}_${paramsOrPlan.task_id}_${randomBytes(8).toString("hex")}`;
    const req: HitlApprovalRequest & { approval_token: string } = {
      approval_id: `hitl_${paramsOrPlan.graph_id}_${paramsOrPlan.task_id}_${randomBytes(4).toString("hex")}`,
      graph_id: paramsOrPlan.graph_id,
      project_id: graph.project_id,
      task_id: paramsOrPlan.task_id,
      action_kind: paramsOrPlan.action_kind,
      status: "pending",
      requested_at: new Date().toISOString(),
      approval_token: token
    };
    this.hitlApprovals.set(key, req);
    return req;
  }

  public resolveHitlApproval(params: {
    approval_id: string;
    graph_id: string;
    task_id: string;
    actor_id: string;
    actor_role: "Owner" | "Admin" | "Architect" | "Operator" | "Viewer";
    action_kind: string;
    decision: "approved" | "rejected";
    reason?: string;
  }): HitlApprovalRequest {
    if (params.actor_role !== "Owner" && params.actor_role !== "Admin") {
      throw new Error(
        `Insufficient privilege: role ${params.actor_role} cannot resolve HITL breakpoint.`
      );
    }
    const key = `${params.graph_id}::${params.task_id}`;
    const req = this.hitlApprovals.get(key);
    if (!req || req.approval_id !== params.approval_id) {
      throw new Error(
        `HITL approval request ${params.approval_id} not found for ${params.graph_id}/${params.task_id}.`
      );
    }
    if (req.status !== "pending") {
      throw new Error(
        `HITL approval request ${params.approval_id} was already resolved (${req.status}).`
      );
    }
    if (req.action_kind !== params.action_kind) {
      throw new Error(
        `HITL action_kind mismatch: expected ${req.action_kind}, received ${params.action_kind}.`
      );
    }

    const graph = this.getGraphOrThrow(params.graph_id);
    const node = graph.nodes.find((n) => n.task_id === params.task_id);
    if (!node) {
      throw new Error(`Task ${params.task_id} not found in graph ${params.graph_id}.`);
    }

    req.resolved_by_actor_id = params.actor_id;
    req.resolved_by_role = params.actor_role;
    req.resolved_at = new Date().toISOString();

    if (params.decision === "rejected") {
      req.status = "rejected";
      req.rejection_reason = params.reason ?? "Rejected by owner";
      node.status = "failed";
      this.propagateDependencyStates(graph);
      this.generatePostMortem(
        graph,
        node,
        "hitl_rejected",
        `Human-in-the-Loop breakpoint rejected by ${params.actor_id}: ${req.rejection_reason}`
      );
      this.persistence?.saveGraph(graph);
      return { ...req };
    }

    const tokenPayload = `${req.approval_id}|${req.graph_id}|${req.task_id}|${req.action_kind}|${params.actor_id}|${randomBytes(8).toString("hex")}`;
    const token = `hitl_tok_${createHash("sha256").update(tokenPayload).digest("hex").slice(0, 32)}`;
    req.status = "approved";
    req.approval_token = token;
    this.approvalTokenIndex.set(token, key);
    if (node.status === "paused_hitl") {
      node.status = "ready";
    }
    this.persistence?.saveGraph(graph);
    return { ...req };
  }

  public getPendingHitlApprovals(graphId?: string): HitlApprovalRequest[] {
    const all = [...this.hitlApprovals.values()].filter((r) => r.status === "pending");
    return graphId ? all.filter((r) => r.graph_id === graphId) : all;
  }

  public registerTaskArtifact(params: {
    artifact_id: string;
    project_id: string;
    graph_id: string;
    task_id: string;
    producer_role: ManagerRuntimeRole;
    producer_instance_id: string;
    kind: RuntimeArtifactKind;
    data_class: RuntimeDataClass;
    title: string;
    content: string;
    prompt_hash: string;
    model_route_id: string;
    source_artifact_ids: string[];
    source_document_chunks?: Array<{
      document_id: string;
      chunk_id: string;
      line_range?: [number, number];
      cell_ref?: string;
    }>;
  }): RuntimeArtifact {
    const graph = this.getGraphOrThrow(params.graph_id);
    if (graph.project_id !== params.project_id) {
      throw new Error(
        `Project isolation violation: artifact project_id (${params.project_id}) !== graph project_id (${graph.project_id}).`
      );
    }
    const node = graph.nodes.find((n) => n.task_id === params.task_id);
    if (!node) {
      throw new Error(
        `Cannot bind artifact ${params.artifact_id}: task ${params.task_id} does not exist.`
      );
    }

    for (const parentId of params.source_artifact_ids) {
      const parent = this.artifacts.get(parentId);
      if (!parent) {
        throw new Error(
          `Artifact ${params.artifact_id} references non-existent source artifact ${parentId}.`
        );
      }
      if (parent.project_id !== params.project_id) {
        throw new Error(
          `Cross-project provenance violation: source artifact ${parentId} belongs to project ${parent.project_id}.`
        );
      }
    }

    const now = new Date().toISOString();
    const rolePrompt = this.getRolePrompt(params.producer_role);
    const contentSha256 = createHash("sha256")
      .update(params.content, "utf8")
      .digest("hex");

    const artifact: RuntimeArtifact = {
      artifact_id: params.artifact_id,
      project_id: params.project_id,
      graph_id: params.graph_id,
      task_id: params.task_id,
      producer_role: params.producer_role,
      producer_instance_id: params.producer_instance_id,
      kind: params.kind,
      data_class: params.data_class,
      title: params.title,
      content: params.content,
      version: 1,
      provenance: {
        artifact_id: params.artifact_id,
        task_id: params.task_id,
        graph_id: params.graph_id,
        producer_role: params.producer_role,
        producer_instance_id: params.producer_instance_id,
        prompt_hash: params.prompt_hash,
        prompt_template_version: rolePrompt.version,
        model_route_id: params.model_route_id,
        content_sha256: contentSha256,
        source_artifact_ids: [...params.source_artifact_ids],
        source_document_chunks: params.source_document_chunks ?? [],
        created_at: now
      },
      created_at: now
    };

    this.artifacts.set(artifact.artifact_id, artifact);
    if (!node.output_artifact_ids.includes(artifact.artifact_id)) {
      node.output_artifact_ids.push(artifact.artifact_id);
    }
    this.persistence?.saveArtifact(artifact);
    this.persistence?.saveGraph(graph);

    this.eventBus.publish({
      type: "artifact:bound",
      graph_id: params.graph_id,
      task_id: params.task_id,
      timestamp: now,
      data: {
        artifact_id: artifact.artifact_id,
        task_id: params.task_id,
        content_sha256: contentSha256
      }
    });

    return artifact;
  }

  public getArtifact(artifactId: string): RuntimeArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  public validateGraphProvenance(
    graphId: string,
    requireCriticApproval = false
  ): {
    valid: boolean;
    errors: string[];
    checked_artifacts: number;
  } {
    const graph = this.getGraphOrThrow(graphId);
    const errors: string[] = [];
    const nodeIds = new Set(graph.nodes.map((n) => n.task_id));
    let checked = 0;

    for (const node of graph.nodes) {
      if (node.status === "completed" && node.expected_output_kinds.length > 0) {
        if (node.output_artifact_ids.length === 0) {
          errors.push(
            `Completed task ${node.task_id} produced 0 artifacts but expected [${node.expected_output_kinds.join(", ")}]`
          );
        }
      }
      for (const artId of node.output_artifact_ids) {
        checked++;
        const artifact = this.artifacts.get(artId);
        if (!artifact) {
          errors.push(
            `Task ${node.task_id} references missing output artifact ${artId}`
          );
          continue;
        }
        if (artifact.task_id !== node.task_id) {
          errors.push(
            `Artifact ${artId} task_id mismatch (${artifact.task_id} !== ${node.task_id})`
          );
        }
        if (artifact.project_id !== graph.project_id) {
          errors.push(
            `Artifact ${artId} project_id mismatch (${artifact.project_id} !== ${graph.project_id})`
          );
        }
        if (!nodeIds.has(artifact.provenance.task_id)) {
          errors.push(
            `Artifact ${artId} provenance points to unknown task ${artifact.provenance.task_id}`
          );
        }
        if (
          !artifact.provenance.prompt_hash ||
          !artifact.provenance.model_route_id
        ) {
          errors.push(`Artifact ${artId} has incomplete provenance metadata`);
        }
        const recomputedHash = createHash("sha256")
          .update(artifact.content, "utf8")
          .digest("hex");
        if (
          artifact.provenance.content_sha256 &&
          artifact.provenance.content_sha256 !== recomputedHash
        ) {
          errors.push(
            `Artifact ${artId} content SHA-256 mismatch (tampered payload)`
          );
        }
        for (const parentArtId of artifact.provenance.source_artifact_ids) {
          if (parentArtId === artId) {
            errors.push(`Artifact ${artId} has self-referential provenance cycle`);
          }
          if (!this.artifacts.has(parentArtId)) {
            errors.push(
              `Artifact ${artId} references non-existent parent artifact ${parentArtId}`
            );
          }
        }
        if (
          requireCriticApproval &&
          artifact.critic_verdict?.status !== "Approved"
        ) {
          errors.push(
            `Artifact ${artId} lacks Approved critic verdict (current: ${artifact.critic_verdict?.status ?? "none"})`
          );
        }
      }
    }

    return { valid: errors.length === 0, errors, checked_artifacts: checked };
  }

  public bindCriticVerdict(params: {
    artifact_id: string;
    critic_instance_id: string;
    strictness_mode: "draft" | "standard" | "production_grade";
    score: number;
    comments: Array<{
      line_or_section?: string;
      severity: "info" | "warning" | "blocker";
      message: string;
    }>;
  }): CriticVerdictMetadata {
    const artifact = this.artifacts.get(params.artifact_id);
    if (!artifact) {
      throw new Error(
        `Artifact ${params.artifact_id} not found for Critic review.`
      );
    }

    const threshold =
      params.strictness_mode === "production_grade"
        ? 85
        : params.strictness_mode === "standard"
          ? 70
          : 50;
    const hasBlocker = params.comments.some((c) => c.severity === "blocker");
    const status: CriticVerdictMetadata["status"] =
      params.score < 30
        ? "Rejected"
        : hasBlocker || params.score < threshold
          ? "Needs Revision"
          : "Approved";

    const verdict: CriticVerdictMetadata = {
      verdict_id: `verdict_${Date.now()}_${randomBytes(3).toString("hex")}`,
      critic_instance_id: params.critic_instance_id,
      status,
      strictness_mode: params.strictness_mode,
      score: params.score,
      comments: params.comments.map((c) => ({ ...c })),
      reviewed_at: new Date().toISOString()
    };

    artifact.critic_verdict = verdict;
    this.persistence?.saveArtifact(artifact);
    this.eventBus.publish({
      type: "critic:verdict",
      graph_id: artifact.graph_id,
      task_id: artifact.task_id,
      timestamp: verdict.reviewed_at,
      data: { artifact_id: artifact.artifact_id, verdict }
    });

    return verdict;
  }

  public executeTaskIteration(params: {
    graph_id: string;
    task_id: string;
    worker_instance_id: string;
    tokens_used: number;
    simulated_duration_ms: number;
    confidence_score: number;
    delivery_id?: string;
    approval_token?: string;
    human_approved?: boolean;
  }): {
    status: RuntimeTaskNode["status"];
    node: RuntimeTaskNode;
    already_completed?: boolean;
    idempotent_replay?: boolean;
    pending_approval?: HitlApprovalRequest;
    post_mortem?: TaskGraphPostMortem;
  } {
    if (!Number.isFinite(params.tokens_used) || params.tokens_used < 0) {
      throw new Error("tokens_used must be a non-negative finite number.");
    }
    if (
      !Number.isFinite(params.simulated_duration_ms) ||
      params.simulated_duration_ms < 0
    ) {
      throw new Error("simulated_duration_ms must be a non-negative finite number.");
    }

    const graph = this.getGraphOrThrow(params.graph_id);
    const node = graph.nodes.find((n) => n.task_id === params.task_id);
    if (!node) throw new Error(`Task ${params.task_id} not found.`);

    const deliveryKey = params.delivery_id
      ? `deliv::${params.graph_id}::${params.task_id}::${params.delivery_id}`
      : `task::${params.graph_id}::${params.task_id}`;

    if (node.status === "completed") {
      return {
        status: "completed",
        node,
        already_completed: true,
        idempotent_replay: true
      };
    }
    const existingDelivery = this.completedDeliveries.get(deliveryKey);
    if (existingDelivery) {
      return {
        ...existingDelivery,
        already_completed: true,
        idempotent_replay: true
      };
    }

    if (node.status === "cancelled") {
      throw new Error(`Task ${node.task_id} is cancelled and cannot be executed.`);
    }

    this.propagateDependencyStates(graph);
    if (node.status === "blocked") {
      throw new Error(
        `Task ${node.task_id} is blocked by failed or cancelled dependency ${node.blocked_by_task_id ?? "unknown"}.`
      );
    }
    const unreadyDep = node.depends_on.find((depId) => {
      const dep = graph.nodes.find((n) => n.task_id === depId);
      return dep?.status !== "completed";
    });
    if (unreadyDep) {
      throw new Error(
        `Task ${node.task_id} cannot execute before dependency ${unreadyDep} is completed.`
      );
    }

    const policy = AUTONOMY_TIER_POLICY_MAP[graph.autonomy_tier];
    const needsHitl =
      Boolean(node.requires_human_approval) ||
      Boolean(node.critical_action_kind && policy.pause_on_critical_actions) ||
      policy.ask_every_step;

    if (needsHitl) {
      const actionKind = node.critical_action_kind ?? "autonomy_policy_gate";
      const approvalKey = `${graph.graph_id}::${node.task_id}`;
      const approvalReq = this.hitlApprovals.get(approvalKey);

      const hasValidToken =
        Boolean(params.approval_token) &&
        approvalReq?.status === "approved" &&
        approvalReq.approval_token === params.approval_token &&
        approvalReq.action_kind === actionKind;

      if (!hasValidToken) {
        node.status = "paused_hitl";
        const pending = this.requestHitlApproval({
          graph_id: graph.graph_id,
          task_id: node.task_id,
          action_kind: actionKind
        });
        this.persistence?.saveGraph(graph);
        this.eventBus.publish({
          type: "task:paused_hitl",
          graph_id: graph.graph_id,
          task_id: node.task_id,
          timestamp: new Date().toISOString(),
          data: {
            reason: actionKind,
            approval_id: pending.approval_id
          }
        });
        return { status: node.status, node, pending_approval: pending };
      }

      approvalReq.status = "consumed";
      if (params.approval_token) {
        this.approvalTokenIndex.delete(params.approval_token);
      }
    }

    node.status = "running";
    node.iteration_count += 1;

    if (node.iteration_count > node.max_iterations) {
      node.status = "failed";
      this.propagateDependencyStates(graph);
      const postMortem = this.generatePostMortem(
        graph,
        node,
        "loop_detected",
        `Task ${node.task_id} exceeded max iterations (${node.max_iterations}) between executor and critic.`
      );
      this.persistence?.saveGraph(graph);
      return { status: node.status, node, post_mortem: postMortem };
    }

    if (params.simulated_duration_ms > node.timeout_ms) {
      node.status = "failed";
      this.propagateDependencyStates(graph);
      const postMortem = this.generatePostMortem(
        graph,
        node,
        "watchdog_timeout",
        `Worker ${params.worker_instance_id} exceeded watchdog timeout (${params.simulated_duration_ms}ms > ${node.timeout_ms}ms).`
      );
      this.persistence?.saveGraph(graph);
      return { status: node.status, node, post_mortem: postMortem };
    }

    if (
      node.tokens_consumed + params.tokens_used > node.token_budget_limit ||
      graph.total_tokens_consumed + params.tokens_used > graph.total_token_budget
    ) {
      node.tokens_consumed += params.tokens_used;
      graph.total_tokens_consumed += params.tokens_used;
      node.status = "failed";
      this.propagateDependencyStates(graph);
      const postMortem = this.generatePostMortem(
        graph,
        node,
        "token_budget_exceeded",
        `Token budget exceeded on task ${node.task_id} (${node.tokens_consumed}/${node.token_budget_limit}).`
      );
      this.persistence?.saveGraph(graph);
      return { status: node.status, node, post_mortem: postMortem };
    }

    node.tokens_consumed += params.tokens_used;
    graph.total_tokens_consumed += params.tokens_used;
    node.confidence_score = params.confidence_score;
    node.latency_ms = (node.latency_ms ?? 0) + params.simulated_duration_ms;
    node.status = "completed";
    this.propagateDependencyStates(graph);
    graph.updated_at = new Date().toISOString();

    this.persistence?.saveGraph(graph);
    this.saveCheckpoint(
      graph.graph_id,
      node.task_id,
      `Completed task ${node.task_id}`
    );

    const outcome = {
      status: node.status,
      node,
      already_completed: false,
      idempotent_replay: false
    };
    this.completedDeliveries.set(deliveryKey, outcome);

    this.eventBus.publish({
      type: "task:completed",
      graph_id: graph.graph_id,
      task_id: node.task_id,
      timestamp: graph.updated_at,
      data: { worker_instance_id: params.worker_instance_id, latency_ms: node.latency_ms }
    });

    return outcome;
  }

  public recoverGraphFromStore(graphId: string): RuntimeTaskGraph {
    if (!this.persistence?.getGraph) {
      throw new Error("No persistence adapter attached for graph recovery.");
    }
    const storedGraph = this.persistence.getGraph(graphId);
    if (!storedGraph) {
      throw new Error(`Graph ${graphId} not found in persistent store.`);
    }
    const recovered = structuredClone(storedGraph);
    for (const node of recovered.nodes) {
      if (node.status === "running") {
        node.status = "ready";
      }
    }
    this.propagateDependencyStates(recovered);
    this.graphs.set(graphId, recovered);

    if (this.persistence.listGraphArtifacts) {
      for (const art of this.persistence.listGraphArtifacts(graphId)) {
        this.artifacts.set(art.artifact_id, structuredClone(art));
      }
    }
    if (this.persistence.listGraphCheckpoints) {
      this.checkpoints.set(
        graphId,
        this.persistence.listGraphCheckpoints(graphId).map((c) => structuredClone(c))
      );
    }
    this.persistence.saveGraph(recovered);
    return recovered;
  }

  public saveCheckpoint(
    graphId: string,
    triggerTaskId: string,
    contextSummary: string
  ): GraphExecutionCheckpoint {
    const graph = this.getGraphOrThrow(graphId);
    const list = this.checkpoints.get(graphId) ?? [];
    const graphArtifacts = [...this.artifacts.values()].filter(
      (a) => a.graph_id === graphId
    );
    const checkpoint: GraphExecutionCheckpoint = {
      checkpoint_id: `ckpt_${graphId}_step_${list.length + 1}`,
      graph_id: graphId,
      project_id: graph.project_id,
      step_index: list.length + 1,
      trigger_task_id: triggerTaskId,
      snapshot_graph: structuredClone(graph),
      artifacts_snapshot: structuredClone(graphArtifacts),
      context_summary: contextSummary,
      created_at: new Date().toISOString()
    };
    list.push(checkpoint);
    this.checkpoints.set(graphId, list);
    this.persistence?.saveCheckpoint?.(checkpoint);
    return checkpoint;
  }

  public rollbackToCheckpoint(
    graphId: string,
    stepsBack = 1
  ): GraphExecutionCheckpoint {
    const list = this.checkpoints.get(graphId) ?? [];
    if (list.length === 0) {
      throw new Error(`No checkpoints available for graph ${graphId}`);
    }
    const targetIdx = Math.max(0, list.length - 1 - stepsBack);
    const target = list[targetIdx]!;
    const restoredGraph = structuredClone(target.snapshot_graph);
    this.graphs.set(graphId, restoredGraph);
    this.checkpoints.set(graphId, list.slice(0, targetIdx + 1));

    for (const [artId, art] of this.artifacts.entries()) {
      if (art.graph_id === graphId) {
        this.artifacts.delete(artId);
      }
    }
    for (const art of target.artifacts_snapshot) {
      this.artifacts.set(art.artifact_id, structuredClone(art));
    }
    this.persistence?.saveGraph(restoredGraph);

    this.eventBus.publish({
      type: "task:rolled_back",
      graph_id: graphId,
      task_id: target.trigger_task_id,
      timestamp: new Date().toISOString(),
      data: {
        checkpoint_id: target.checkpoint_id,
        step_index: target.step_index
      }
    });
    return target;
  }

  public executeWithSelfHealingJson<T extends Record<string, unknown>>(params: {
    requiredKeys: Array<keyof T>;
    attempts: Array<() => string>;
  }): { parsed: T; attempts_used: number; healed: boolean } {
    let lastError = "No attempts provided";
    for (let i = 0; i < params.attempts.length; i++) {
      const raw = params.attempts[i]!();
      try {
        const cleaned = raw
          .replace(/^```json\s*/i, "")
          .replace(/```$/i, "")
          .trim();
        const parsed = JSON.parse(cleaned) as T;
        const missing = params.requiredKeys.filter((k) => !(k in parsed));
        if (missing.length > 0) {
          lastError = `Missing required schema keys: ${missing.join(", ")}`;
          continue;
        }
        return { parsed, attempts_used: i + 1, healed: i > 0 };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(
      `Self-healing JSON retry failed after ${params.attempts.length} attempts: ${lastError}`
    );
  }

  public arbitrateParallelResults(params: {
    graph_id: string;
    candidates: Array<{
      agent_instance_id: string;
      role: ManagerRuntimeRole;
      conclusion: string;
      confidence_score: number;
      evidence_count: number;
    }>;
  }): {
    selected_winner: {
      agent_instance_id: string;
      role: ManagerRuntimeRole;
      conclusion: string;
      weighted_score: number;
    };
    rationale: string;
  } {
    if (params.candidates.length === 0) {
      throw new Error("At least one candidate is required for arbitration.");
    }
    const scored = params.candidates
      .map((c) => ({
        ...c,
        weighted_score: Number(
          (c.confidence_score * 0.7 + Math.min(c.evidence_count, 10) * 0.03).toFixed(
            4
          )
        )
      }))
      .sort((a, b) => b.weighted_score - a.weighted_score);

    const winner = scored[0]!;
    const rationale = `Manager selected conclusion from ${winner.role} (${winner.agent_instance_id}) with weighted score ${winner.weighted_score} based on confidence (${winner.confidence_score}) and verified sources (${winner.evidence_count}).`;
    this.eventBus.publish({
      type: "conflict:resolved",
      graph_id: params.graph_id,
      timestamp: new Date().toISOString(),
      data: { winner: winner.agent_instance_id, rationale }
    });
    return { selected_winner: winner, rationale };
  }

  public invokeDeduplicatedTool<T>(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    executor: () => T
  ): { result: T; from_cache: boolean } {
    const key = `${sessionId}::${toolName}::${JSON.stringify(args, Object.keys(args).sort())}`;
    const existing = this.toolCallCache.get(key);
    if (existing) {
      return { result: existing.output as T, from_cache: true };
    }
    const output = executor();
    this.toolCallCache.set(key, {
      output,
      cached_at: new Date().toISOString()
    });
    return { result: output, from_cache: false };
  }

  public streamThought(
    graphId: string,
    taskId: string,
    role: ManagerRuntimeRole,
    thoughtText: string
  ): void {
    const entry = `[${new Date().toISOString()}] [${role}:${taskId}] ${thoughtText}`;
    const list = this.thoughtStreamLogs.get(graphId) ?? [];
    list.push(entry);
    this.thoughtStreamLogs.set(graphId, list);
    this.eventBus.publish({
      type: "thought:stream",
      graph_id: graphId,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      data: { role, thought: thoughtText }
    });
  }

  public getThoughtStream(graphId: string): string[] {
    return [...(this.thoughtStreamLogs.get(graphId) ?? [])];
  }

  public generatePostMortem(
    graph: RuntimeTaskGraph,
    failedNode: RuntimeTaskNode,
    category: TaskGraphPostMortem["failure_category"],
    rootCauseSummary: string
  ): TaskGraphPostMortem {
    const downstream = graph.nodes
      .filter(
        (n) =>
          n.depends_on.includes(failedNode.task_id) ||
          n.blocked_by_task_id === failedNode.task_id
      )
      .map((n) => n.task_id);
    const ckpts = this.checkpoints.get(graph.graph_id) ?? [];
    const lastCheckpoint =
      ckpts.length > 0 ? ckpts[ckpts.length - 1]!.checkpoint_id : undefined;

    const report: TaskGraphPostMortem = {
      report_id: `pm_${graph.graph_id}_${failedNode.task_id}`,
      graph_id: graph.graph_id,
      failed_task_id: failedNode.task_id,
      failure_category: category,
      root_cause_summary: rootCauseSummary,
      affected_downstream_tasks: downstream,
      ...(lastCheckpoint
        ? { recommended_recovery_checkpoint_id: lastCheckpoint }
        : {}),
      mitigation_steps: [
        "Откатить состояние графа к последнему валидному чекпоинту (rollbackToCheckpoint).",
        "Проверить бюджет токенов и входные артефакты упавшего узла.",
        "При необходимости переключить маршрут модели через DynamicLlmRouter."
      ],
      generated_at: new Date().toISOString()
    };

    this.eventBus.publish({
      type: "postmortem:created",
      graph_id: graph.graph_id,
      task_id: failedNode.task_id,
      timestamp: report.generated_at,
      data: report
    });
    return report;
  }

  public buildContextHandoffPacket(params: {
    from_role: ManagerRuntimeRole;
    to_role: ManagerRuntimeRole;
    key_facts: string[];
    artifact_ids: string[];
    open_constraints: string[];
  }): {
    handoff_id: string;
    from_role: ManagerRuntimeRole;
    to_role: ManagerRuntimeRole;
    compressed_digest: string;
    preserved_facts_count: number;
    linked_artifact_ids: string[];
  } {
    const digest = [
      `HANDOFF ${params.from_role.toUpperCase()} -> ${params.to_role.toUpperCase()}`,
      `FACTS (${params.key_facts.length}): ${params.key_facts.join(" | ")}`,
      `CONSTRAINTS (${params.open_constraints.length}): ${params.open_constraints.join(" | ")}`,
      `ARTIFACTS: ${params.artifact_ids.join(", ")}`
    ].join("\n");

    return {
      handoff_id: `handoff_${Date.now()}`,
      from_role: params.from_role,
      to_role: params.to_role,
      compressed_digest: digest,
      preserved_facts_count: params.key_facts.length,
      linked_artifact_ids: [...params.artifact_ids]
    };
  }

  public runDevilsAdvocateReview(params: {
    artifact_id: string;
    proposal_summary: string;
    assumptions: string[];
  }): {
    challenge_id: string;
    artifact_id: string;
    identified_risks: Array<{
      assumption: string;
      counter_argument: string;
      severity: "medium" | "high";
    }>;
    stress_test_passed: boolean;
  } {
    const risks = params.assumptions.map((assumption, idx) => ({
      assumption,
      counter_argument: `Стресс-тест допущения #${idx + 1} («${assumption}»): требуется резервный план на случай отказа внешнего контура или роста задержки в 3x.`,
      severity: (idx === 0 && params.assumptions.length > 3 ? "high" : "medium") as
        | "medium"
        | "high"
    }));
    return {
      challenge_id: `da_${Date.now()}`,
      artifact_id: params.artifact_id,
      identified_risks: risks,
      stress_test_passed: risks.every((r) => r.severity !== "high")
    };
  }

  public upsertWorkerStatus(
    worker: ActiveAgentWorkerRecord
  ): ActiveAgentWorkerRecord {
    this.activeWorkers.set(worker.instance_id, { ...worker });
    return { ...worker };
  }

  public listActiveWorkers(): ActiveAgentWorkerRecord[] {
    return [...this.activeWorkers.values()].map((w) => ({ ...w }));
  }

  public getLatencyProfile(graphId: string): {
    graph_id: string;
    total_latency_ms: number;
    bottleneck_task_id: string | null;
    nodes: Array<{ task_id: string; role: ManagerRuntimeRole; latency_ms: number }>;
  } {
    const graph = this.getGraphOrThrow(graphId);
    const profiled = graph.nodes.map((n) => ({
      task_id: n.task_id,
      role: n.assigned_role,
      latency_ms: n.latency_ms ?? 0
    }));
    const sorted = [...profiled].sort((a, b) => b.latency_ms - a.latency_ms);
    const total = profiled.reduce((acc, x) => acc + x.latency_ms, 0);
    return {
      graph_id: graphId,
      total_latency_ms: total,
      bottleneck_task_id: sorted[0]?.latency_ms ? sorted[0].task_id : null,
      nodes: profiled
    };
  }

  public getGraphOrThrow(graphId: string): RuntimeTaskGraph {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Task Graph ${graphId} not found.`);
    return graph;
  }

  public compilePlan(params: {
    plan_id: string;
    tenant_id: string;
    workspace_id: string;
    project_id: string;
    goal: string;
    max_parallelism: number;
    budget_limit_usd: number;
    tasks: Array<{
      node_id: string;
      title: string;
      agent_role:
        | "planner"
        | "researcher"
        | "coder"
        | "analyst"
        | "critic"
        | "verifier"
        | "synthesizer";
      dependencies: string[];
      estimated_tokens: number;
      estimated_cost_usd: number;
      requires_hitl?: boolean;
      hitl_action_scope?: string;
    }>;
  }): KosmoraDagPlan {
    if (!params.tasks || params.tasks.length === 0) {
      throw new Error("Cannot compile an empty DAG plan");
    }
    const nodeMap = new Map<string, typeof params.tasks[number]>();
    for (const t of params.tasks) {
      if (nodeMap.has(t.node_id)) {
        throw new Error(`Duplicate task node_id '${t.node_id}' in plan`);
      }
      nodeMap.set(t.node_id, t);
    }

    // Verify all dependencies exist & run cycle detection
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const topoOrder: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Cycle detected in DAG plan involving node '${id}'`);
      }
      const node = nodeMap.get(id);
      if (!node) {
        throw new Error(`Missing dependency node '${id}'`);
      }
      visiting.add(id);
      for (const depId of node.dependencies) {
        if (!nodeMap.has(depId)) {
          throw new Error(
            `Node '${id}' depends on non-existent dependency '${depId}'`
          );
        }
        visit(depId);
      }
      visiting.delete(id);
      visited.add(id);
      topoOrder.push(id);
    };

    for (const t of params.tasks) {
      visit(t.node_id);
    }

    const now = new Date().toISOString();
    const nodes: KosmoraDagTaskNode[] = params.tasks.map((t) => ({
      node_id: t.node_id,
      title: t.title,
      agent_role: t.agent_role,
      dependencies: [...t.dependencies],
      estimated_tokens: t.estimated_tokens,
      estimated_cost_usd: t.estimated_cost_usd,
      actual_tokens: 0,
      actual_cost_usd: 0,
      requires_hitl: Boolean(t.requires_hitl),
      hitl_action_scope: t.hitl_action_scope,
      human_approved: false,
      status: t.dependencies.length === 0
        ? (t.requires_hitl ? "awaiting_hitl" : "ready")
        : "pending",
      citations: []
    }));

    return {
      plan_id: params.plan_id,
      tenant_id: params.tenant_id,
      workspace_id: params.workspace_id,
      project_id: params.project_id,
      goal: params.goal,
      max_parallelism: Math.max(1, params.max_parallelism),
      budget_limit_usd: params.budget_limit_usd,
      consumed_tokens: 0,
      consumed_cost_usd: 0,
      acyclic_verified: true,
      topological_order: topoOrder,
      nodes,
      completed_delivery_ids: [],
      created_at: now,
      updated_at: now
    };
  }

  public scheduleNextBatch(plan: KosmoraDagPlan): {
    ready_batch: KosmoraDagTaskNode[];
    awaiting_hitl_nodes: KosmoraDagTaskNode[];
    blocked_nodes: KosmoraDagTaskNode[];
  } {
    const nodeMap = new Map(plan.nodes.map((n) => [n.node_id, n]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of plan.nodes) {
        if (node.status === "succeeded" || node.status === "failed" || node.status === "cancelled" || node.status === "blocked") {
          continue;
        }
        const badDep = node.dependencies.find((depId) => {
          const dep = nodeMap.get(depId);
          return dep?.status === "failed" || dep?.status === "cancelled" || dep?.status === "blocked";
        });
        if (badDep) {
          node.status = "blocked";
          changed = true;
          continue;
        }
        const allDepsSucceeded = node.dependencies.every(
          (depId) => nodeMap.get(depId)?.status === "succeeded"
        );
        if (allDepsSucceeded) {
          if (node.requires_hitl && !node.human_approved) {
            if (node.status !== "awaiting_hitl") {
              node.status = "awaiting_hitl";
              changed = true;
            }
          } else if (node.status === "pending" || node.status === "awaiting_hitl") {
            node.status = "ready";
            changed = true;
          }
        }
      }
    }

    const readyBatch = plan.nodes
      .filter((n) => n.status === "ready")
      .slice(0, Math.max(1, plan.max_parallelism));
    const awaitingHitl = plan.nodes.filter((n) => n.status === "awaiting_hitl");
    const blockedNodes = plan.nodes.filter((n) => n.status === "blocked");

    return {
      ready_batch: readyBatch,
      awaiting_hitl_nodes: awaitingHitl,
      blocked_nodes: blockedNodes
    };
  }

  public recordTaskResult(
    plan: KosmoraDagPlan,
    nodeId: string,
    result: {
      succeeded: boolean;
      actual_tokens: number;
      actual_cost_usd: number;
      output_summary?: string;
      error_message?: string;
      citations?: KosmoraCitation[];
      delivery_id?: string;
    }
  ): { node: KosmoraDagTaskNode; idempotent_replay: boolean } {
    const node = plan.nodes.find((n) => n.node_id === nodeId);
    if (!node) {
      throw new Error(`DAG node '${nodeId}' not found in plan '${plan.plan_id}'`);
    }
    if (result.delivery_id && plan.completed_delivery_ids.includes(result.delivery_id)) {
      return { node, idempotent_replay: true };
    }
    if (node.status === "succeeded") {
      return { node, idempotent_replay: true };
    }
    if (node.requires_hitl && !node.human_approved) {
      throw new Error(
        `HITL Violation: Node '${nodeId}' requires verified human approval before execution.`
      );
    }

    node.actual_tokens = Math.max(0, result.actual_tokens);
    node.actual_cost_usd = Math.max(0, result.actual_cost_usd);
    plan.consumed_tokens += node.actual_tokens;
    plan.consumed_cost_usd = Number(
      (plan.consumed_cost_usd + node.actual_cost_usd).toFixed(4)
    );

    if (result.succeeded) {
      node.status = "succeeded";
      node.output_summary = result.output_summary ?? `Completed ${node.title}`;
      node.citations = result.citations ?? [];
    } else {
      node.status = "failed";
      node.error_message = result.error_message ?? `Task ${nodeId} failed`;
    }

    if (result.delivery_id) {
      plan.completed_delivery_ids.push(result.delivery_id);
    }
    plan.updated_at = new Date().toISOString();
    this.scheduleNextBatch(plan);
    return { node, idempotent_replay: false };
  }

  public approveHitlNode(params: {
    plan: KosmoraDagPlan;
    node_id: string;
    approval_token: string;
    approver_id: string;
    reason?: string;
  }): HitlApprovalRequest {
    const { plan, node_id, approval_token, approver_id } = params;
    if (!approver_id || approver_id.trim().length === 0) {
      throw new Error("approver_id is required for HITL approval");
    }
    const node = plan.nodes.find((n) => n.node_id === node_id);
    if (!node) {
      throw new Error(`DAG node '${node_id}' not found in plan '${plan.plan_id}'`);
    }
    const key = `${plan.plan_id}::${node_id}`;
    const pendingReq = this.hitlApprovals.get(key);
    if (!pendingReq || pendingReq.approval_token !== approval_token) {
      throw new Error(
        `Valid HITL approval request with matching token not found for node '${node_id}'`
      );
    }
    if (pendingReq.status !== "pending") {
      throw new Error(
        `HITL approval token for node '${node_id}' has already been ${pendingReq.status}`
      );
    }

    pendingReq.status = "consumed";
    pendingReq.resolved_by_actor_id = approver_id;
    pendingReq.resolved_at = new Date().toISOString();

    node.human_approved = true;
    node.approved_by = approver_id;
    node.approved_at = pendingReq.resolved_at;
    node.approval_token_used = approval_token;
    if (node.status === "awaiting_hitl") {
      node.status = "ready";
    }
    plan.updated_at = pendingReq.resolved_at;
    return { ...pendingReq };
  }

  public cancelTaskNode(
    plan: KosmoraDagPlan,
    nodeId: string,
    reason = "Cancelled by operator"
  ): KosmoraDagTaskNode {
    const node = plan.nodes.find((n) => n.node_id === nodeId);
    if (!node) {
      throw new Error(`DAG node '${nodeId}' not found in plan '${plan.plan_id}'`);
    }
    if (node.status === "succeeded") {
      throw new Error(`Cannot cancel already succeeded node '${nodeId}'`);
    }
    node.status = "cancelled";
    node.error_message = reason;
    this.scheduleNextBatch(plan);
    plan.updated_at = new Date().toISOString();
    return node;
  }

  public evaluateBudgetGuard(plan: KosmoraDagPlan): {
    within_budget: boolean;
    remaining_usd: number;
    utilization_pct: number;
  } {
    const remaining = Number((plan.budget_limit_usd - plan.consumed_cost_usd).toFixed(4));
    const pct = Number(
      ((plan.consumed_cost_usd / Math.max(0.0001, plan.budget_limit_usd)) * 100).toFixed(2)
    );
    return {
      within_budget: plan.consumed_cost_usd <= plan.budget_limit_usd,
      remaining_usd: remaining,
      utilization_pct: pct
    };
  }

  public routeModelForTask(
    agentRole: string,
    complexity: "low" | "medium" | "high" | "extreme",
    remainingBudgetUsd: number
  ): {
    selected_model: string;
    fallback_model: string;
    tier: string;
  } {
    if (remainingBudgetUsd < 0.05 || complexity === "low") {
      return {
        selected_model: "kosmora-flash-v3",
        fallback_model: "kosmora-nano-local",
        tier: "fast_economical"
      };
    }
    if (complexity === "extreme" || agentRole === "critic" || agentRole === "verifier") {
      return {
        selected_model: "kosmora-frontier-pro-v3",
        fallback_model: "kosmora-reasoning-v3",
        tier: "frontier_reasoning"
      };
    }
    return {
      selected_model: "kosmora-reasoning-v3",
      fallback_model: "kosmora-flash-v3",
      tier: "balanced_reasoning"
    };
  }

  public evaluateWithCritic(
    artifactId: string,
    iteration: number,
    rubric: Array<{ dimension: string; score: number; weight: number; findings: string[] }>
  ): {
    artifact_id: string;
    iteration: number;
    aggregate_score: number;
    passed: boolean;
    blocking_findings: string[];
  } {
    let weightedSum = 0;
    let totalWeight = 0;
    const blocking: string[] = [];
    for (const r of rubric) {
      weightedSum += r.score * r.weight;
      totalWeight += r.weight;
      if (r.score < 0.75) {
        blocking.push(...r.findings);
      }
    }
    const agg = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(4)) : 0;
    return {
      artifact_id: artifactId,
      iteration,
      aggregate_score: agg,
      passed: agg >= 0.8 && blocking.length === 0,
      blocking_findings: blocking
    };
  }
}
