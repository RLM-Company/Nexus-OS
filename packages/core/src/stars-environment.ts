/** Replaceable environment adapter and event trigger for Stars missions.
 *
 * The default adapter is local and inert: it never starts a model, spends
 * credits or touches a host. Cloud execution is expressed only through this
 * interface, so an integrator can supply a real environment without changing
 * mission state contracts. */
export type StarsEnvironmentKind = "local" | "cloud";

export type StarsExecutionRequest = {
  mission_id: string;
  agent_id: string;
  task: string;
  context_scopes: string[];
};

export type StarsExecutionReceipt = {
  environment: StarsEnvironmentKind;
  mission_id: string;
  agent_id: string;
  accepted: boolean;
  reason?: string;
};

export interface StarsEnvironment {
  readonly kind: StarsEnvironmentKind;
  dispatch(request: StarsExecutionRequest): Promise<StarsExecutionReceipt>;
  cancel(missionId: string, agentId: string): Promise<boolean>;
}

export const localStarsEnvironment: StarsEnvironment = {
  kind: "local",
  dispatch(request) {
    return Promise.resolve({
      environment: "local" as const,
      mission_id: request.mission_id,
      agent_id: request.agent_id,
      accepted: request.task.trim().length > 0
    });
  },
  cancel() {
    return Promise.resolve(true);
  }
};

export type StarsEventTrigger = {
  id: string;
  mission_id: string;
  event: string;
  enabled: boolean;
};

/** Bind an external event to an existing mission. Idempotent by (id, mission). */
export function bindStarsEventTrigger(
  triggers: readonly StarsEventTrigger[],
  input: StarsEventTrigger
): StarsEventTrigger[] {
  if (!input.id || !input.mission_id || !input.event) return [...triggers];
  if (triggers.some((t) => t.id === input.id && t.mission_id === input.mission_id))
    return [...triggers];
  return [...triggers, { ...input, enabled: input.enabled !== false }];
}

export function triggerStarsEvent(
  triggers: readonly StarsEventTrigger[],
  event: string
): StarsEventTrigger[] {
  return triggers.filter((t) => t.event === event && t.enabled);
}
