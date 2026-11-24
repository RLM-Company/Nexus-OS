import type { WorkDag } from "@cosmora/contracts";

/** Chat task plan and event timers (stage-three, owner-approved 15 Nov 2026).
 *
 * Includes the legacy local state machine used by the stage-three fixtures.
 * Product progress is now projected only from the durable Work DAG below. */

export type StepStatus = "pending" | "running" | "paused" | "completed" | "blocked";
export type BlockReason = "owner_pause" | "awaiting_permission" | "failed" | "cancelled";
export type TimingKind = "model" | "tool" | "queue" | "pause" | "await_owner";
export type Timing = Record<TimingKind, number>;

export type PlanStep = {
  id: string;
  title: string;
  depends_on: string[];
  status: StepStatus;
  /** Distinct from a failure or a permission gate: only an explicit owner pause. */
  block_reason: BlockReason | null;
  started_at: number | null;
  ended_at: number | null;
  timing: Timing;
};

export type ChatTaskPlan = {
  id: string;
  scope: string;
  goal: string;
  steps: PlanStep[];
  active_step_id: string | null;
  collapsed: boolean;
  created_at: number;
};

export const CHAT_TASK_PLAN_PREFIX = "cosmora:chat-task-plan:";
const STORAGE_VERSION = 1;
const MAX_AGE_MS = 7 * 86400_000;
const MAX_STEPS = 32;
const MAX_GOAL = 1000;
const MAX_TITLE = 300;

export const chatTaskPlanKey = (scope: string): string => CHAT_TASK_PLAN_PREFIX + scope;

const emptyTiming = (): Timing => ({
  model: 0,
  tool: 0,
  queue: 0,
  pause: 0,
  await_owner: 0
});

export function createChatTaskPlan(input: {
  id: string;
  scope: string;
  goal: string;
  steps: Array<{ id: string; title: string; depends_on?: string[] }>;
  now: number;
}): ChatTaskPlan {
  const goal = input.goal.trim();
  if (
    !input.id ||
    !input.scope ||
    !goal ||
    goal.length > MAX_GOAL ||
    !input.steps.length ||
    input.steps.length > MAX_STEPS ||
    input.steps.some((s) => !s.id || !s.title.trim() || s.title.length > MAX_TITLE)
  )
    throw new Error("INVALID_CHAT_TASK_PLAN");
  const ids = new Set(input.steps.map((s) => s.id));
  if (ids.size !== input.steps.length) throw new Error("DUPLICATE_STEP_ID");
  for (const step of input.steps)
    if (step.depends_on?.some((dep) => !ids.has(dep) || dep === step.id))
      throw new Error("INVALID_DEPENDENCY");
  const steps: PlanStep[] = input.steps.map((step) => ({
    id: step.id,
    title: step.title.trim(),
    depends_on: [...(step.depends_on ?? [])],
    status: "pending",
    block_reason: null,
    started_at: null,
    ended_at: null,
    timing: emptyTiming()
  }));
  return {
    id: input.id,
    scope: input.scope,
    goal,
    steps,
    active_step_id: null,
    collapsed: false,
    created_at: input.now
  };
}

/** A step is available when every dependency is completed. */
export function nextReadyStep(steps: PlanStep[]): PlanStep | null {
  return (
    steps.find(
      (step) =>
        step.status === "pending" &&
        step.depends_on.every((dep) => steps.find((s) => s.id === dep)?.status === "completed")
    ) ?? null
  );
}

export function startStep(plan: ChatTaskPlan, stepId: string, now: number): ChatTaskPlan {
  if (plan.active_step_id) return plan;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step || step.status !== "pending") return plan;
  if (!step.depends_on.every((dep) => plan.steps.find((s) => s.id === dep)?.status === "completed"))
    return plan;
  return {
    ...plan,
    active_step_id: stepId,
    steps: plan.steps.map((s) =>
      s.id === stepId ? { ...s, status: "running", started_at: now, ended_at: null } : s
    )
  };
}

/** Completing the active step immediately promotes the next available step.
 * Completed steps are never re-run, including after a reload. */
export function completeStep(plan: ChatTaskPlan, stepId: string, now: number): ChatTaskPlan {
  if (plan.active_step_id !== stepId) return plan;
  const steps = plan.steps.map((s) =>
    s.id === stepId ? { ...s, status: "completed" as const, block_reason: null, ended_at: now } : s
  );
  const next = nextReadyStep(steps);
  if (!next) return { ...plan, steps, active_step_id: null };
  // Promotion is a real start: without started_at the panel reports "—" for a
  // running step and durations cannot be reconciled with run events. Replace
  // the object instead of mutating it: map() reused the old reference, and
  // mutating it would silently corrupt the previous plan snapshot.
  const promoted = {
    ...next,
    status: "running" as const,
    block_reason: null,
    started_at: now,
    ended_at: null
  };
  return {
    ...plan,
    steps: steps.map((s) => (s.id === promoted.id ? promoted : s)),
    active_step_id: promoted.id
  };
}

export function failStep(
  plan: ChatTaskPlan,
  stepId: string,
  now: number,
  reason: Exclude<BlockReason, "owner_pause"> = "failed"
): ChatTaskPlan {
  if (plan.active_step_id !== stepId) return plan;
  return {
    ...plan,
    active_step_id: null,
    steps: plan.steps.map((s) =>
      s.id === stepId
        ? { ...s, status: "blocked" as const, block_reason: reason, ended_at: now }
        : s
    )
  };
}

/** An explicit owner pause keeps the step assigned and records why. It must not
 * be confused with an error or a permission gate: resume only touches pauses. */
export function pauseActiveStep(plan: ChatTaskPlan): ChatTaskPlan {
  if (!plan.active_step_id) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === plan.active_step_id
        ? { ...s, status: "paused" as const, block_reason: "owner_pause" as const }
        : s
    )
  };
}

export function resumeActiveStep(plan: ChatTaskPlan): ChatTaskPlan {
  if (!plan.active_step_id) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === plan.active_step_id && s.status === "paused"
        ? { ...s, status: "running" as const, block_reason: null }
        : s
    )
  };
}

/** Permission gate or owner confirmation: the step stays active but waits.
 * Unlike pause, resume does not clear it — an explicit approval is required. */
export function blockActiveStep(
  plan: ChatTaskPlan,
  reason: "awaiting_permission" | "failed"
): ChatTaskPlan {
  if (!plan.active_step_id) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === plan.active_step_id ? { ...s, status: "blocked" as const, block_reason: reason } : s
    )
  };
}

/** Gates are cleared only by an explicit owner decision, never by a pause resume. */
export function unblockActiveStep(plan: ChatTaskPlan): ChatTaskPlan {
  if (!plan.active_step_id) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === plan.active_step_id && s.status === "blocked"
        ? { ...s, status: "running" as const, block_reason: null }
        : s
    )
  };
}

/** One measured interval, attributed to the active step only. Overlapping or
 * non-positive intervals are rejected instead of inflating totals. */
export function recordInterval(
  plan: ChatTaskPlan,
  kind: TimingKind,
  from: number,
  to: number
): ChatTaskPlan {
  const ms = to - from;
  if (!plan.active_step_id || !Number.isFinite(ms) || ms <= 0) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === plan.active_step_id
        ? { ...s, timing: { ...s.timing, [kind]: s.timing[kind] + ms } }
        : s
    )
  };
}

export function toggleCollapsed(plan: ChatTaskPlan): ChatTaskPlan {
  return { ...plan, collapsed: !plan.collapsed };
}

export function planSummary(plan: ChatTaskPlan): {
  total: number;
  completed: number;
  running: number;
  pending: number;
  paused: number;
  blocked: number;
  total_ms: number;
  timing: Timing;
} {
  const timing = emptyTiming();
  for (const step of plan.steps)
    for (const kind of Object.keys(timing) as TimingKind[]) timing[kind] += step.timing[kind];
  const total_ms = Object.values(timing).reduce((sum, value) => sum + value, 0);
  return {
    total: plan.steps.length,
    completed: plan.steps.filter((s) => s.status === "completed").length,
    running: plan.steps.filter((s) => s.status === "running").length,
    pending: plan.steps.filter((s) => s.status === "pending").length,
    paused: plan.steps.filter((s) => s.status === "paused").length,
    blocked: plan.steps.filter((s) => s.status === "blocked").length,
    total_ms,
    timing
  };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const seconds = ms / 1000;
  if (ms < 100) return `${ms} мс`;
  if (seconds < 60) return `${seconds.toFixed(1)} с`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} мин ${Math.round(seconds % 60)} с`;
}

type Stored = { version: number; saved_at: number; plan: ChatTaskPlan };

export function readChatTaskPlan(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: string
): ChatTaskPlan | null {
  try {
    const raw = storage.getItem(chatTaskPlanKey(scope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Stored;
    if (
      value.version !== STORAGE_VERSION ||
      typeof value.saved_at !== "number" ||
      !Number.isFinite(value.saved_at) ||
      Date.now() - value.saved_at > MAX_AGE_MS
    ) {
      storage.removeItem(chatTaskPlanKey(scope));
      return null;
    }
    const plan = value.plan;
    if (
      !plan ||
      plan.scope !== scope ||
      typeof plan.goal !== "string" ||
      !Array.isArray(plan.steps) ||
      !plan.steps.length ||
      plan.steps.some(
        (s) =>
          !["pending", "running", "paused", "completed", "blocked"].includes(s.status) ||
          (s.block_reason != null &&
            !["owner_pause", "awaiting_permission", "failed", "cancelled"].includes(
              s.block_reason
            )) ||
          !Array.isArray(s.depends_on) ||
          typeof s.timing !== "object"
      )
    )
      return null;
    return plan;
  } catch {
    return null;
  }
}

export function saveChatTaskPlan(storage: Pick<Storage, "setItem">, plan: ChatTaskPlan): void {
  const value: Stored = { version: STORAGE_VERSION, saved_at: Date.now(), plan };
  try {
    storage.setItem(chatTaskPlanKey(plan.scope), JSON.stringify(value));
  } catch {
    /* Storage may be unavailable; the in-memory panel stays honest. */
  }
}

export function clearChatTaskPlan(storage: Pick<Storage, "removeItem">, scope: string): void {
  try {
    storage.removeItem(chatTaskPlanKey(scope));
  } catch {
    /* Nothing to clear when storage is unavailable. */
  }
}

/** Projection only: admission, dependency order and completion belong to the server. */
export function projectChatTaskPlan(graph: WorkDag, collapsed: boolean): ChatTaskPlan {
  const steps: PlanStep[] = graph.nodes.map((node) => {
    const attempt = node.attempts.at(-1);
    const measured = node.result?.timing;
    const sameRun =
      attempt && measured?.work_id === attempt.work_id && measured.attempt === attempt.number;
    const duration = (value: number | undefined) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const timing = emptyTiming();
    if (sameRun) {
      timing.queue = duration(measured.queue_ms);
      timing.tool = duration(measured.tool_ms);
    }
    let status: StepStatus =
      node.status === "cancelled" || node.status === "failed" ? "blocked" : node.status;
    let block_reason: BlockReason | null = null;
    if (node.blocked_reason === "EXECUTOR_QUEUE") status = "pending";
    else if (node.blocked_reason === "PAUSED" || node.blocked_reason === "PROJECT_PAUSED") {
      status = "paused";
      block_reason = "owner_pause";
    } else if (node.status === "cancelled") block_reason = "cancelled";
    else if (node.status === "failed") block_reason = "failed";
    else if (["AWAITING_APPROVAL", "WAITING_CONFIRMATION"].includes(node.blocked_reason ?? ""))
      block_reason = "awaiting_permission";
    return {
      id: node.id,
      title: node.title,
      depends_on: [...node.depends_on],
      status,
      block_reason,
      started_at: null,
      ended_at: null,
      timing
    };
  });
  return {
    id: graph.id,
    scope: graph.project_id,
    goal: graph.title,
    steps,
    active_step_id: steps.find((step) => step.status === "running")?.id ?? null,
    collapsed,
    created_at: Date.parse(graph.created_at)
  };
}
