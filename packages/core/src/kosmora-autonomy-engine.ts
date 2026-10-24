/**
 * @cosmora/core — Stage 1: Kosmora Autonomy Core & Protocol Implementation (F001–F032)
 * Implements DAG scheduling, Artifact-to-Task binding, Provenance validation,
 * Critic Verdict binding, L1-L5 autonomy mapping, Dynamic LLM Routing, Loop Detection,
 * Checkpointing & Rollback, Fan-out/Fan-in, Priority Queue, Self-Healing JSON IO,
 * Watchdog, Confidence Scoring, HITL Breakpoints, Hot-Swappable Prompts, Event Bus,
 * Conflict Arbitration, Token Budgeting, Tool Deduplication, Thought Streaming,
 * Squad Presets, Post-Mortem Generation, Context Handoff, Devil's Advocate,
 * Critic Calibration, Agent Registry, and Node Latency Profiling.
 */

import type {
  ActiveAgentWorkerRecord,
  AutonomyLevel,
  CriticVerdictMetadata,
  GraphExecutionCheckpoint,
  KosmoraAutonomyTier,
  KosmoraProtocolMessage,
  ManagerRuntimeRole,
  RuntimeArtifact,
  RuntimeArtifactKind,
  RuntimeDataClass,
  RuntimeTaskGraph,
  RuntimeTaskNode,
  SquadPreset,
  TaskGraphPostMortem,
} from "../../contracts/src/kosmora-protocol.ts";

// F008: Configurable Autonomy Levels (L1–L5 <-> Cosmora A0–A6)
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
    description: "Пошаговое подтверждение каждого узла графа пользователем",
  },
  L2: {
    cosmora_level: "A2",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: false,
    pause_on_critical_actions: true,
    description: "Автоматическое чтение и анализ, подтверждение перед записью",
  },
  L3: {
    cosmora_level: "A3",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: true,
    pause_on_critical_actions: true,
    description: "Параллельное исполнение суб-агентов с ревью Критика и паузой на критических операциях",
  },
  L4: {
    cosmora_level: "A5",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: true,
    pause_on_critical_actions: true,
    description: "Высокая автономия внутри воркспейса с защитой продакшен-контура",
  },
  L5: {
    cosmora_level: "A6",
    ask_every_step: false,
    auto_execute_safe_tools: true,
    allow_parallel_fanout: true,
    pause_on_critical_actions: false,
    description: "Полный автопилот с итоговым отчётом и проверкой графа происхождения",
  },
};

// F026: Squad Presets
export const DEFAULT_SQUAD_PRESETS: SquadPreset[] = [
  {
    preset_id: "squad-engineering-release",
    name: "Аналитик + Кодер + QA + Критик",
    description: "Полный цикл проектирования, написания кода, юнит-тестов и ревью",
    roles: ["manager", "analyst", "coder", "qa", "critic"],
    default_autonomy_tier: "L3",
    critic_strictness: "production_grade",
  },
  {
    preset_id: "squad-research-content",
    name: "Ресерчер + Копирайтер + Дизайнер + Критик",
    description: "Глубокое исследование, подготовка аналитического отчёта и презентации на Canvas",
    roles: ["manager", "researcher", "copywriter", "designer", "critic"],
    default_autonomy_tier: "L3",
    critic_strictness: "standard",
  },
  {
    preset_id: "squad-architecture-redteam",
    name: "Архитектор + Адвокат дьявола + Критик",
    description: "Стресс-тестирование архитектуры и бизнес-плана на уязвимости и узкие места",
    roles: ["manager", "architect", "devils_advocate", "critic"],
    default_autonomy_tier: "L4",
    critic_strictness: "production_grade",
  },
];

// F021: Local Reactive Event Bus (Pub/Sub)
export type KosmoraEventType =
  | "protocol:message"
  | "task:started"
  | "task:completed"
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
  private readonly listeners = new Map<KosmoraEventType | "*", Array<(ev: KosmoraEvent) => void>>();
  private readonly history: KosmoraEvent[] = [];

  public subscribe(type: KosmoraEventType | "*", handler: (ev: KosmoraEvent) => void): () => void {
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
    this.history.push(event);
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler(event);
    }
    for (const handler of this.listeners.get("*") ?? []) {
      handler(event);
    }
  }

  public getHistory(graphId?: string): KosmoraEvent[] {
    return graphId ? this.history.filter((e) => e.graph_id === graphId) : [...this.history];
  }
}

// F009: Dynamic LLM Router
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
          estimated_cost_per_1k_tokens: 0.005,
        };
      }
    }
    if (params.complexity === "simple" || params.tokenBudgetRemaining < 1000) {
      return {
        route_id: "route-fast-flash",
        provider_id: "gemini",
        model_id: "gemini-2.5-flash",
        tier: "fast_economy",
        estimated_cost_per_1k_tokens: 0.0005,
      };
    }
    return {
      route_id: "route-balanced-standard",
      provider_id: "gemini",
      model_id: "gemini-2.5-pro",
      tier: "balanced",
      estimated_cost_per_1k_tokens: 0.002,
    };
  }
}

// F001–F032: Unified Kosmora Autonomy & Orchestration Engine
export class KosmoraAutonomyEngine {
  public readonly eventBus = new KosmoraEventBus();
  public readonly router = new DynamicLlmRouter();

  private readonly graphs = new Map<string, RuntimeTaskGraph>();
  private readonly artifacts = new Map<string, RuntimeArtifact>();
  private readonly checkpoints = new Map<string, GraphExecutionCheckpoint[]>();
  private readonly toolCallCache = new Map<string, { output: unknown; cached_at: string }>(); // F024
  private readonly rolePrompts = new Map<ManagerRuntimeRole, { version: string; system_prompt: string }>(); // F020
  private readonly activeWorkers = new Map<string, ActiveAgentWorkerRecord>(); // F031
  private readonly thoughtStreamLogs = new Map<string, string[]>(); // F025

  constructor() {
    this.initializeDefaultRolePrompts();
  }

  private initializeDefaultRolePrompts(): void {
    const defaults: Record<ManagerRuntimeRole, string> = {
      manager: "Ты — Kosmora Manager. Декомпозируй цели в DAG, контролируй бюджет и проверяй provenance.",
      architect: "Ты — Системный Архитектор Kosmora. Проектируй надёжные модульные контракты и схемы.",
      researcher: "Ты — Агент-Исследователь. Собирай проверяемые факты с точными ссылками на источники.",
      analyst: "Ты — Системный Аналитик. Строй таблицы, модели и выводы с привязкой к первичным данным.",
      coder: "Ты — Инженер-Разработчик. Пиши типизированный, чистый код без заглушек и с тестами.",
      qa: "Ты — QA-Инженер. Проверяй граничные случаи, контракты ввода-вывода и регрессии.",
      copywriter: "Ты — Редактор отчётов. Формируй структурированные документы для Kosmora Canvas.",
      designer: "Ты — Дизайнер презентаций и диаграмм. Проектируй визуально чистые слайды и схемы.",
      devils_advocate:
        "Ты — Адвокат дьявола (Red Team). Ищи скрытые риски, слабые места и ошибочные допущения в плане.",
      critic:
        "Ты — Агент-Критик Kosmora. Проверяй артефакты на полноту, точность, безопасность и соответствие ТЗ.",
    };
    for (const [role, prompt] of Object.entries(defaults) as Array<[ManagerRuntimeRole, string]>) {
      this.rolePrompts.set(role, { version: "v1.0", system_prompt: prompt });
    }
  }

  // F001: Create standard Kosmora Protocol message
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
    const policy = AUTONOMY_TIER_POLICY_MAP[params.autonomy_tier];
    const message: KosmoraProtocolMessage<TPayload> = {
      protocol_version: "1.0.0",
      message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
      ...(params.confidence_score !== undefined ? { confidence_score: params.confidence_score } : {}),
      payload: params.payload,
    };
    this.eventBus.publish({
      type: "protocol:message",
      graph_id: params.graph_id,
      task_id: params.task_id,
      timestamp: message.timestamp,
      data: message,
    });
    return message;
  }

  // F020: Hot-swap role system prompt without runtime restart
  public hotSwapRolePrompt(role: ManagerRuntimeRole, newPrompt: string, version = `v1.${Date.now()}`): {
    role: ManagerRuntimeRole;
    version: string;
    system_prompt: string;
  } {
    const updated = { version, system_prompt: newPrompt };
    this.rolePrompts.set(role, updated);
    return { role, ...updated };
  }

  public getRolePrompt(role: ManagerRuntimeRole): { version: string; system_prompt: string } {
    return this.rolePrompts.get(role) ?? { version: "v1.0", system_prompt: "" };
  }

  // F002: DAG Task Graph Decomposition & Cycle Validation
  public createTaskGraph(params: {
    graph_id: string;
    project_id: string;
    autonomy_tier: KosmoraAutonomyTier;
    total_token_budget: number;
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
    if (params.nodes.length === 0) {
      throw new Error("DAG must contain at least one task node.");
    }
    const fullNodes: RuntimeTaskNode[] = params.nodes.map((n) => ({
      ...n,
      project_id: params.project_id,
      status: n.depends_on.length === 0 ? "ready" : "pending",
      output_artifact_ids: [],
      iteration_count: 0,
      tokens_consumed: 0,
    }));

    this.assertAcyclicGraph(fullNodes);

    const now = new Date().toISOString();
    const graph: RuntimeTaskGraph = {
      contract_version: 1,
      graph_id: params.graph_id,
      project_id: params.project_id,
      root_task_id: fullNodes[0]!.task_id,
      autonomy_tier: params.autonomy_tier,
      autonomy_level: AUTONOMY_TIER_POLICY_MAP[params.autonomy_tier].cosmora_level,
      total_token_budget: params.total_token_budget,
      total_tokens_consumed: 0,
      nodes: fullNodes,
      created_at: now,
      updated_at: now,
    };

    this.graphs.set(graph.graph_id, graph);
    this.saveCheckpoint(graph.graph_id, graph.root_task_id, "Initial DAG created");
    return graph;
  }

  private assertAcyclicGraph(nodes: RuntimeTaskNode[]): void {
    const nodeMap = new Map(nodes.map((n) => [n.task_id, n]));
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Cycle detected in Task Graph involving node: ${taskId}`);
      }
      visiting.add(taskId);
      const node = nodeMap.get(taskId);
      if (!node) {
        throw new Error(`Missing dependency task node: ${taskId}`);
      }
      for (const depId of node.depends_on) {
        visit(depId);
      }
      visiting.delete(taskId);
      visited.add(taskId);
    };

    for (const n of nodes) {
      visit(n.task_id);
    }
  }

  // F013 & F014: Ready Batch Selection with Fan-Out Parallelism & Priority Re-weighting
  public getReadyTaskBatch(graphId: string): RuntimeTaskNode[] {
    const graph = this.getGraphOrThrow(graphId);
    const completedIds = new Set(
      graph.nodes.filter((n) => n.status === "completed").map((n) => n.task_id)
    );
    for (const node of graph.nodes) {
      if (node.status === "pending" && node.depends_on.every((d) => completedIds.has(d))) {
        node.status = "ready";
      }
    }
    return graph.nodes
      .filter((n) => n.status === "ready")
      .sort((a, b) => b.priority_weight - a.priority_weight);
  }

  // F014: Dynamic Task Priority Reprioritization on Urgent User Interrupt
  public reprioritizeTask(graphId: string, taskId: string, newPriorityWeight: number): RuntimeTaskNode {
    const graph = this.getGraphOrThrow(graphId);
    const node = graph.nodes.find((n) => n.task_id === taskId);
    if (!node) throw new Error(`Task ${taskId} not found in graph ${graphId}`);
    node.priority_weight = newPriorityWeight;
    graph.updated_at = new Date().toISOString();
    return node;
  }

  // F003 & F004: Runtime Artifact-to-Task Binding + Provenance Graph Registration
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
    const node = graph.nodes.find((n) => n.task_id === params.task_id);
    if (!node) {
      throw new Error(`Cannot bind artifact ${params.artifact_id}: task ${params.task_id} does not exist.`);
    }

    const now = new Date().toISOString();
    const rolePrompt = this.getRolePrompt(params.producer_role);
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
        source_artifact_ids: params.source_artifact_ids,
        source_document_chunks: params.source_document_chunks ?? [],
        created_at: now,
      },
      created_at: now,
    };

    this.artifacts.set(artifact.artifact_id, artifact);
    if (!node.output_artifact_ids.includes(artifact.artifact_id)) {
      node.output_artifact_ids.push(artifact.artifact_id);
    }

    this.eventBus.publish({
      type: "artifact:bound",
      graph_id: params.graph_id,
      task_id: params.task_id,
      timestamp: now,
      data: { artifact_id: artifact.artifact_id, task_id: params.task_id },
    });

    return artifact;
  }

  // F005: Runtime Provenance Graph Validator
  public validateGraphProvenance(graphId: string): {
    valid: boolean;
    errors: string[];
    checked_artifacts: number;
  } {
    const graph = this.getGraphOrThrow(graphId);
    const errors: string[] = [];
    const nodeIds = new Set(graph.nodes.map((n) => n.task_id));
    let checked = 0;

    for (const node of graph.nodes) {
      for (const artId of node.output_artifact_ids) {
        checked++;
        const artifact = this.artifacts.get(artId);
        if (!artifact) {
          errors.push(`Task ${node.task_id} references missing output artifact ${artId}`);
          continue;
        }
        if (artifact.task_id !== node.task_id) {
          errors.push(`Artifact ${artId} task_id mismatch (${artifact.task_id} !== ${node.task_id})`);
        }
        if (!nodeIds.has(artifact.provenance.task_id)) {
          errors.push(`Artifact ${artId} provenance points to unknown task ${artifact.provenance.task_id}`);
        }
        if (!artifact.provenance.prompt_hash || !artifact.provenance.model_route_id) {
          errors.push(`Artifact ${artId} has incomplete provenance metadata`);
        }
        for (const parentArtId of artifact.provenance.source_artifact_ids) {
          if (!this.artifacts.has(parentArtId)) {
            errors.push(`Artifact ${artId} references non-existent parent artifact ${parentArtId}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, checked_artifacts: checked };
  }

  // F006, F007, F030: Critic Agent Review & Critic Verdict Binding with Strictness Calibration
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
      throw new Error(`Artifact ${params.artifact_id} not found for Critic review.`);
    }

    const threshold =
      params.strictness_mode === "production_grade"
        ? 85
        : params.strictness_mode === "standard"
          ? 70
          : 50;
    const hasBlocker = params.comments.some((c) => c.severity === "blocker");
    const status: CriticVerdictMetadata["status"] =
      hasBlocker || params.score < threshold ? "Needs Revision" : "Approved";

    const verdict: CriticVerdictMetadata = {
      verdict_id: `verdict_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      critic_instance_id: params.critic_instance_id,
      status,
      strictness_mode: params.strictness_mode,
      score: params.score,
      comments: params.comments,
      reviewed_at: new Date().toISOString(),
    };

    artifact.critic_verdict = verdict;
    this.eventBus.publish({
      type: "critic:verdict",
      graph_id: artifact.graph_id,
      task_id: artifact.task_id,
      timestamp: verdict.reviewed_at,
      data: { artifact_id: artifact.artifact_id, verdict },
    });

    return verdict;
  }

  // F010, F017, F018, F019, F023, F032: Execute Task Node with Loop Detection, Watchdog, Budgeting, HITL & Profiling
  public executeTaskIteration(params: {
    graph_id: string;
    task_id: string;
    worker_instance_id: string;
    tokens_used: number;
    simulated_duration_ms: number;
    confidence_score: number;
    human_approved?: boolean;
  }): {
    status: RuntimeTaskNode["status"];
    node: RuntimeTaskNode;
    post_mortem?: TaskGraphPostMortem;
  } {
    const graph = this.getGraphOrThrow(params.graph_id);
    const node = graph.nodes.find((n) => n.task_id === params.task_id);
    if (!node) throw new Error(`Task ${params.task_id} not found.`);

    const policy = AUTONOMY_TIER_POLICY_MAP[graph.autonomy_tier];

    // F019: Human-in-the-Loop Breakpoint Check
    if (
      (node.requires_human_approval ||
        (node.critical_action_kind && policy.pause_on_critical_actions) ||
        policy.ask_every_step) &&
      !params.human_approved
    ) {
      node.status = "paused_hitl";
      this.eventBus.publish({
        type: "task:paused_hitl",
        graph_id: graph.graph_id,
        task_id: node.task_id,
        timestamp: new Date().toISOString(),
        data: { reason: node.critical_action_kind ?? "autonomy_policy_gate" },
      });
      return { status: node.status, node };
    }

    node.iteration_count += 1;

    // F010: Loop Detector
    if (node.iteration_count > node.max_iterations) {
      node.status = "failed";
      const postMortem = this.generatePostMortem(
        graph,
        node,
        "loop_detected",
        `Task ${node.task_id} exceeded max iterations (${node.max_iterations}) between executor and critic.`
      );
      return { status: node.status, node, post_mortem: postMortem };
    }

    // F017: Worker Watchdog Timeout Check
    if (params.simulated_duration_ms > node.timeout_ms) {
      node.status = "failed";
      const postMortem = this.generatePostMortem(
        graph,
        node,
        "watchdog_timeout",
        `Worker ${params.worker_instance_id} exceeded watchdog timeout (${params.simulated_duration_ms}ms > ${node.timeout_ms}ms).`
      );
      return { status: node.status, node, post_mortem: postMortem };
    }

    // F023: Token Budgeting Check
    node.tokens_consumed += params.tokens_used;
    graph.total_tokens_consumed += params.tokens_used;
    if (
      node.tokens_consumed > node.token_budget_limit ||
      graph.total_tokens_consumed > graph.total_token_budget
    ) {
      node.status = "failed";
      const postMortem = this.generatePostMortem(
        graph,
        node,
        "token_budget_exceeded",
        `Token budget exceeded on task ${node.task_id} (${node.tokens_consumed}/${node.token_budget_limit}).`
      );
      return { status: node.status, node, post_mortem: postMortem };
    }

    // F018 & F032: Confidence Score & Node Latency Profiler
    node.confidence_score = params.confidence_score;
    node.latency_ms = (node.latency_ms ?? 0) + params.simulated_duration_ms;
    node.status = "completed";
    graph.updated_at = new Date().toISOString();

    this.saveCheckpoint(graph.graph_id, node.task_id, `Completed task ${node.task_id}`);
    return { status: node.status, node };
  }

  // F011 & F012: Checkpointing & State Rollback
  public saveCheckpoint(
    graphId: string,
    triggerTaskId: string,
    contextSummary: string
  ): GraphExecutionCheckpoint {
    const graph = this.getGraphOrThrow(graphId);
    const list = this.checkpoints.get(graphId) ?? [];
    const graphArtifacts = [...this.artifacts.values()].filter((a) => a.graph_id === graphId);
    const checkpoint: GraphExecutionCheckpoint = {
      checkpoint_id: `ckpt_${graphId}_step_${list.length + 1}`,
      graph_id: graphId,
      project_id: graph.project_id,
      step_index: list.length + 1,
      trigger_task_id: triggerTaskId,
      snapshot_graph: structuredClone(graph),
      artifacts_snapshot: structuredClone(graphArtifacts),
      context_summary: contextSummary,
      created_at: new Date().toISOString(),
    };
    list.push(checkpoint);
    this.checkpoints.set(graphId, list);
    return checkpoint;
  }

  public rollbackToCheckpoint(graphId: string, stepsBack = 1): GraphExecutionCheckpoint {
    const list = this.checkpoints.get(graphId) ?? [];
    if (list.length === 0) {
      throw new Error(`No checkpoints available for graph ${graphId}`);
    }
    const targetIdx = Math.max(0, list.length - 1 - stepsBack);
    const target = list[targetIdx]!;
    this.graphs.set(graphId, structuredClone(target.snapshot_graph));
    this.checkpoints.set(graphId, list.slice(0, targetIdx + 1));

    this.eventBus.publish({
      type: "task:rolled_back",
      graph_id: graphId,
      task_id: target.trigger_task_id,
      timestamp: new Date().toISOString(),
      data: { checkpoint_id: target.checkpoint_id, step_index: target.step_index },
    });
    return target;
  }

  // F015 & F016: Strict JSON Schema IO Validation & Self-Healing Retry
  public executeWithSelfHealingJson<T extends Record<string, unknown>>(params: {
    requiredKeys: Array<keyof T>;
    attempts: Array<() => string>;
  }): { parsed: T; attempts_used: number; healed: boolean } {
    let lastError = "No attempts provided";
    for (let i = 0; i < params.attempts.length; i++) {
      const raw = params.attempts[i]!();
      try {
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
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
    throw new Error(`Self-healing JSON retry failed after ${params.attempts.length} attempts: ${lastError}`);
  }

  // F022: Conflict Resolution Arbitration by Manager
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
        weighted_score: Number((c.confidence_score * 0.7 + Math.min(c.evidence_count, 10) * 0.03).toFixed(4)),
      }))
      .sort((a, b) => b.weighted_score - a.weighted_score);

    const winner = scored[0]!;
    const rationale = `Manager selected conclusion from ${winner.role} (${winner.agent_instance_id}) with weighted score ${winner.weighted_score} based on confidence (${winner.confidence_score}) and verified sources (${winner.evidence_count}).`;
    this.eventBus.publish({
      type: "conflict:resolved",
      graph_id: params.graph_id,
      timestamp: new Date().toISOString(),
      data: { winner: winner.agent_instance_id, rationale },
    });
    return { selected_winner: winner, rationale };
  }

  // F024: Tool Call Deduplication within Session
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
    this.toolCallCache.set(key, { output, cached_at: new Date().toISOString() });
    return { result: output, from_cache: false };
  }

  // F025: Streaming Intermediate Thoughts
  public streamThought(graphId: string, taskId: string, role: ManagerRuntimeRole, thoughtText: string): void {
    const entry = `[${new Date().toISOString()}] [${role}:${taskId}] ${thoughtText}`;
    const list = this.thoughtStreamLogs.get(graphId) ?? [];
    list.push(entry);
    this.thoughtStreamLogs.set(graphId, list);
    this.eventBus.publish({
      type: "thought:stream",
      graph_id: graphId,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      data: { role, thought: thoughtText },
    });
  }

  public getThoughtStream(graphId: string): string[] {
    return this.thoughtStreamLogs.get(graphId) ?? [];
  }

  // F027: Post-Mortem Report Generation on Failure
  public generatePostMortem(
    graph: RuntimeTaskGraph,
    failedNode: RuntimeTaskNode,
    category: TaskGraphPostMortem["failure_category"],
    rootCauseSummary: string
  ): TaskGraphPostMortem {
    const downstream = graph.nodes
      .filter((n) => n.depends_on.includes(failedNode.task_id))
      .map((n) => n.task_id);
    const ckpts = this.checkpoints.get(graph.graph_id) ?? [];
    const lastCheckpoint = ckpts.length > 0 ? ckpts[ckpts.length - 1]!.checkpoint_id : undefined;

    const report: TaskGraphPostMortem = {
      report_id: `pm_${graph.graph_id}_${failedNode.task_id}`,
      graph_id: graph.graph_id,
      failed_task_id: failedNode.task_id,
      failure_category: category,
      root_cause_summary: rootCauseSummary,
      affected_downstream_tasks: downstream,
      ...(lastCheckpoint ? { recommended_recovery_checkpoint_id: lastCheckpoint } : {}),
      mitigation_steps: [
        "Откатить состояние графа к последнему валидному чекпоинту (rollbackToCheckpoint).",
        "Проверить бюджет токенов и входные артефакты упавшего узла.",
        "При необходимости переключить маршрут модели через DynamicLlmRouter.",
      ],
      generated_at: new Date().toISOString(),
    };

    this.eventBus.publish({
      type: "postmortem:created",
      graph_id: graph.graph_id,
      task_id: failedNode.task_id,
      timestamp: report.generated_at,
      data: report,
    });
    return report;
  }

  // F028: Lossless Context Handoff Compression between Agents
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
      `ARTIFACTS: ${params.artifact_ids.join(", ")}`,
    ].join("\n");

    return {
      handoff_id: `handoff_${Date.now()}`,
      from_role: params.from_role,
      to_role: params.to_role,
      compressed_digest: digest,
      preserved_facts_count: params.key_facts.length,
      linked_artifact_ids: params.artifact_ids,
    };
  }

  // F029: Devil's Advocate Challenge Mode
  public runDevilsAdvocateReview(params: {
    artifact_id: string;
    proposal_summary: string;
    assumptions: string[];
  }): {
    challenge_id: string;
    artifact_id: string;
    identified_risks: Array<{ assumption: string; counter_argument: string; severity: "medium" | "high" }>;
    stress_test_passed: boolean;
  } {
    const risks = params.assumptions.map((assumption, idx) => ({
      assumption,
      counter_argument: `Стресс-тест допущения #${idx + 1} («${assumption}»): требуется резервный план на случай отказа внешнего контура или роста задержки в 3x.`,
      severity: (idx === 0 ? "high" : "medium") as "medium" | "high",
    }));
    return {
      challenge_id: `da_${Date.now()}`,
      artifact_id: params.artifact_id,
      identified_risks: risks,
      stress_test_passed: risks.every((r) => r.severity !== "high") || params.assumptions.length <= 3,
    };
  }

  // F031: Active Worker Registry Management
  public upsertWorkerStatus(worker: ActiveAgentWorkerRecord): ActiveAgentWorkerRecord {
    this.activeWorkers.set(worker.instance_id, worker);
    return worker;
  }

  public listActiveWorkers(): ActiveAgentWorkerRecord[] {
    return [...this.activeWorkers.values()];
  }

  // F032: Node Latency Profiler Report
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
      latency_ms: n.latency_ms ?? 0,
    }));
    const sorted = [...profiled].sort((a, b) => b.latency_ms - a.latency_ms);
    const total = profiled.reduce((acc, x) => acc + x.latency_ms, 0);
    return {
      graph_id: graphId,
      total_latency_ms: total,
      bottleneck_task_id: sorted[0]?.latency_ms ? sorted[0].task_id : null,
      nodes: profiled,
    };
  }

  public getGraphOrThrow(graphId: string): RuntimeTaskGraph {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Task Graph ${graphId} not found.`);
    return graph;
  }
}
