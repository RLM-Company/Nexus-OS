/** Stars team mission state machine.
 *
 * Pure and deterministic. Reuses the existing Kosmora concepts (manager,
 * executors, Work DAG node ids, immutable artifacts and explicit acceptance)
 * without changing shared contracts. A mission always has one manager and at
 * least one executor; the senior agent verifies the combined result, while a
 * human acceptance remains a separate, explicit act.
 */
export type AgentRole = "manager" | "executor" | "senior";

export type MissionAgent = {
  id: string;
  role: AgentRole;
  task: string;
  /** Scopes this agent may read: personal id or shared team scope. */
  context_scopes: string[];
  status: "assigned" | "working" | "completed" | "failed" | "replaced" | "cancelled";
  replaced_by: string | null;
  handoff: string | null;
};

export type MissionMessage = {
  id: string;
  from: string;
  to: string;
  text: string;
  at: number;
};

export type MissionResult = {
  agent_id: string;
  summary: string;
  artifact_ref: string | null;
  verification: "pending" | "verified" | "rejected";
  verified_by: string | null;
};

export type MissionStage =
  "briefing" | "planning" | "working" | "verifying" | "completed" | "paused" | "cancelled";

export type StarsMission = {
  id: string;
  team_scope: string;
  version: number;
  goal: string;
  stage: MissionStage;
  agents: MissionAgent[];
  dependencies: Record<string, string[]>;
  messages: MissionMessage[];
  results: MissionResult[];
  combined_result: string | null;
  question: string | null;
  history: string[];
};

export type StarsMissionEvent =
  | { type: "brief"; goal: string; expected_version?: number }
  | { type: "clarify"; question: string; expected_version?: number }
  | {
      type: "plan";
      agents: Array<{ id: string; role: AgentRole; task: string; context_scopes: string[] }>;
      dependencies?: Record<string, string[]>;
      expected_version?: number;
    }
  | { type: "assign"; agent_id: string; task: string; expected_version?: number }
  | { type: "message"; from: string; to: string; text: string; expected_version?: number }
  | {
      type: "result";
      agent_id: string;
      summary: string;
      artifact_ref?: string | null;
      expected_version?: number;
    }
  | {
      type: "verify";
      agent_id: string;
      verdict: "verified" | "rejected";
      verified_by: string;
      expected_version?: number;
    }
  | { type: "fail"; agent_id: string; reason: string; expected_version?: number }
  | { type: "replace"; failed_agent_id: string; replacement_id: string; expected_version?: number }
  | { type: "handoff"; from: string; to: string; task: string; expected_version?: number }
  | { type: "combine"; summary: string; expected_version?: number }
  | { type: "pause"; expected_version?: number }
  | { type: "resume"; expected_version?: number }
  | { type: "cancel"; expected_version?: number };

export class StarsMissionConflict extends Error {
  constructor(message = "STARS_MISSION_CONFLICT") {
    super(message);
    this.name = "StarsMissionConflict";
  }
}

export function createStarsMission(input: {
  id: string;
  team_scope: string;
  goal?: string;
}): StarsMission {
  if (!input.id || !input.team_scope) throw new Error("INVALID_STARS_MISSION");
  return {
    id: input.id,
    team_scope: input.team_scope,
    version: 1,
    goal: input.goal?.trim() ?? "",
    stage: "briefing",
    agents: [],
    dependencies: {},
    messages: [],
    results: [],
    combined_result: null,
    question: null,
    history: ["mission created"]
  };
}

const bump = (state: StarsMission, entry: string): StarsMission => ({
  ...state,
  version: state.version + 1,
  history: [...state.history, entry]
});

const check = (state: StarsMission, expected?: number) => {
  if (expected !== undefined && expected !== state.version)
    throw new StarsMissionConflict("STALE_MISSION_VERSION");
};

const agent = (state: StarsMission, id: string) => state.agents.find((a) => a.id === id);

/** A context scope is granted only when it is the team scope or listed on the
 * agent. Human/owner scopes are never inferred from mission membership. */
export function canReadContext(state: StarsMission, agentId: string, scope: string): boolean {
  const member = agent(state, agentId);
  if (!member) return false;
  return scope === state.team_scope || member.context_scopes.includes(scope);
}

export function pendingWork(state: StarsMission, agentId: string): string | null {
  const member = agent(state, agentId);
  if (!member || member.status !== "assigned" || !member.handoff) return null;
  return member.handoff;
}

export function applyStarsMissionEvent(
  state: StarsMission,
  event: StarsMissionEvent,
  now = Date.now()
): StarsMission {
  check(state, event.expected_version);
  if (state.stage === "cancelled" && event.type !== "resume") return state;

  switch (event.type) {
    case "brief": {
      const goal = event.goal.trim();
      if (!goal) return state;
      return bump({ ...state, goal, stage: "planning", question: null }, "goal accepted");
    }
    case "clarify": {
      const question = event.question.trim();
      if (!question) return state;
      return bump({ ...state, question }, "clarification requested");
    }
    case "plan": {
      if (state.stage === "briefing") return state;
      if (event.agents.some((a) => !a.id || !a.task.trim())) return state;
      const roles = event.agents.filter((a) => a.role === "manager");
      const executors = event.agents.filter((a) => a.role === "executor");
      if (roles.length !== 1 || executors.length < 1) return state;
      const agents: MissionAgent[] = event.agents.map((a) => ({
        id: a.id,
        role: a.role,
        task: a.task.trim(),
        context_scopes: [...a.context_scopes],
        status: "assigned",
        replaced_by: null,
        handoff: null
      }));
      return bump(
        {
          ...state,
          agents,
          dependencies: { ...(event.dependencies ?? {}) },
          stage: "working",
          question: null
        },
        "plan accepted: one manager and executors assigned"
      );
    }
    case "assign": {
      const member = agent(state, event.agent_id);
      if (!member) return state;
      const task = event.task.trim();
      if (!task) return state;
      return bump(
        {
          ...state,
          agents: state.agents.map((a) =>
            a.id === member.id ? { ...a, task, status: "assigned" as const } : a
          )
        },
        `task reassigned to ${member.id}`
      );
    }
    case "message": {
      if (!agent(state, event.from) || !agent(state, event.to)) return state;
      if (!canReadContext(state, event.from, state.team_scope)) return state;
      return bump(
        {
          ...state,
          messages: [
            ...state.messages,
            {
              id: `m-${state.version + 1}`,
              from: event.from,
              to: event.to,
              text: event.text,
              at: now
            }
          ]
        },
        `message ${event.from} -> ${event.to}`
      );
    }
    case "result": {
      const member = agent(state, event.agent_id);
      if (!member || member.status === "failed" || member.status === "replaced") return state;
      return bump(
        {
          ...state,
          agents: state.agents.map((a) =>
            a.id === member.id ? { ...a, status: "completed" as const } : a
          ),
          results: [
            ...state.results.filter((r) => r.agent_id !== member.id),
            {
              agent_id: member.id,
              summary: event.summary,
              artifact_ref: event.artifact_ref ?? null,
              verification: "pending",
              verified_by: null
            }
          ]
        },
        `result from ${member.id}`
      );
    }
    case "verify": {
      if (!state.results.some((r) => r.agent_id === event.agent_id)) return state;
      return bump(
        {
          ...state,
          stage: "verifying",
          results: state.results.map((r) =>
            r.agent_id === event.agent_id
              ? { ...r, verification: event.verdict, verified_by: event.verified_by }
              : r
          )
        },
        `${event.agent_id} result ${event.verdict} by ${event.verified_by}`
      );
    }
    case "fail": {
      const member = agent(state, event.agent_id);
      if (!member) return state;
      return bump(
        {
          ...state,
          agents: state.agents.map((a) =>
            a.id === member.id ? { ...a, status: "failed" as const, handoff: a.task } : a
          )
        },
        `${member.id} failed: ${event.reason}`
      );
    }
    case "replace": {
      const failed = agent(state, event.failed_agent_id);
      if (!failed || failed.status !== "failed") return state;
      if (agent(state, event.replacement_id)) return state;
      return bump(
        {
          ...state,
          agents: [
            ...state.agents.map((a) =>
              a.id === failed.id
                ? { ...a, status: "replaced" as const, replaced_by: event.replacement_id }
                : a
            ),
            {
              id: event.replacement_id,
              role: failed.role,
              task: failed.handoff ?? failed.task,
              context_scopes: [...failed.context_scopes],
              status: "assigned",
              replaced_by: null,
              handoff: failed.handoff
            }
          ],
          dependencies: Object.fromEntries(
            Object.entries(state.dependencies).map(([id, deps]) => [
              id === failed.id ? event.replacement_id : id,
              deps.map((dep) => (dep === failed.id ? event.replacement_id : dep))
            ])
          )
        },
        `replacement ${event.replacement_id} received unfinished work`
      );
    }
    case "handoff": {
      const from = agent(state, event.from);
      const to = agent(state, event.to);
      if (!from || !to) return state;
      return bump(
        {
          ...state,
          agents: state.agents.map((a) =>
            a.id === to.id ? { ...a, handoff: event.task, status: "assigned" as const } : a
          )
        },
        `unfinished part handed from ${event.from} to ${event.to}`
      );
    }
    case "combine": {
      if (state.stage !== "verifying") return state;
      const manager = state.agents.find((a) => a.role === "manager");
      const verified = state.results.filter((r) => r.verification === "verified");
      if (!manager || verified.length < 1) return state;
      if (state.results.some((r) => r.verification === "pending")) return state;
      return bump(
        {
          ...state,
          stage: "completed",
          combined_result: event.summary,
          question: null
        },
        "senior combined the verified results"
      );
    }
    case "pause":
      if (state.stage === "completed" || state.stage === "paused") return state;
      return bump({ ...state, stage: "paused" }, "mission paused");
    case "resume":
      if (state.stage !== "paused") return state;
      return bump({ ...state, stage: "working" }, "mission resumed");
    case "cancel":
      return bump(
        {
          ...state,
          stage: "cancelled",
          question: null,
          agents: state.agents.map((a) => ({ ...a, status: "cancelled" as const }))
        },
        "mission cancelled"
      );
  }
}
