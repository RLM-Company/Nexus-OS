/** Explicit local/remote runner selection for Stars task transfer. This is a
 * contract boundary only: no environment is created, no VPS is contacted and
 * no task is dispatched here. A remote runner must provide a real isolated
 * adapter; synthetic fixtures are never claimed as production cloud. */
export type StarsRunnerKind = "local" | "remote";
export type StarsRunnerLease = {
  lease_id: string;
  runner: StarsRunnerKind;
  task_id: string;
  holder: string;
  expires_at: string;
  heartbeat_at: string | null;
  status: "requested" | "active" | "cancelled" | "expired" | "completed";
  artifacts: string[];
  checkpoint: string | null;
};
export class StarsRunnerConflict extends Error {
  constructor(readonly code: "UNKNOWN_RUNNER" | "LEASE_NOT_ACTIVE" | "DOUBLE_LEASE") {
    super(code);
  }
}
export function requestRunnerLease(input: {
  lease_id: string;
  runner: StarsRunnerKind;
  task_id: string;
  holder: string;
  expires_at: string;
  active: StarsRunnerLease[];
}): StarsRunnerLease {
  if (!["local", "remote"].includes(input.runner)) throw new StarsRunnerConflict("UNKNOWN_RUNNER");
  if (input.active.some((lease) => lease.task_id === input.task_id && lease.status === "active"))
    throw new StarsRunnerConflict("DOUBLE_LEASE");
  return {
    lease_id: input.lease_id,
    runner: input.runner,
    task_id: input.task_id,
    holder: input.holder,
    expires_at: input.expires_at,
    heartbeat_at: null,
    status: "requested",
    artifacts: [],
    checkpoint: null
  };
}
export function heartbeat(lease: StarsRunnerLease, at: string): StarsRunnerLease {
  if (lease.status !== "active" && lease.status !== "requested")
    throw new StarsRunnerConflict("LEASE_NOT_ACTIVE");
  return { ...lease, heartbeat_at: at, status: "active" };
}
export function cancelLease(lease: StarsRunnerLease): StarsRunnerLease {
  if (lease.status === "completed" || lease.status === "cancelled") return lease;
  return { ...lease, status: "cancelled" };
}
