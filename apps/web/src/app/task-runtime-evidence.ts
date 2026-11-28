import type { WorkCheckpointRecord } from "@cosmora/contracts";

export function observedInterval(start: string | undefined, end: string | undefined) {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? to - from : null;
}

type WorkPhase = "queue" | "model" | "review" | "save" | "wait" | "pause";
const assess = (checkpoint: WorkCheckpointRecord): WorkPhase | null => {
  if (checkpoint.status === "queued") return "queue";
  if (checkpoint.status === "paused") return "pause";
  if (checkpoint.status === "blocked" || checkpoint.status === "awaiting_approval") return "wait";
  if (checkpoint.status !== "running") return null;
  if (checkpoint.inflight_run_id) return "model";
  if (checkpoint.stage === "publish") return "save";
  if (checkpoint.stage === "review") return "review";
  return null;
};

export function computeWorkEvidence(workId: string, checkpoints: readonly WorkCheckpointRecord[]) {
  if (checkpoints.some((entry) => entry.work_id !== workId)) return null;
  const ordered = [...checkpoints].sort((a, b) => a.version - b.version);
  const latest = ordered.at(-1);
  if (!latest) return null;
  const samples = new Map<WorkPhase, number>();
  for (let index = 1; index < ordered.length; index++) {
    const from = ordered[index - 1]!;
    const to = ordered[index]!;
    if (from.version + 1 !== to.version) continue;
    const phase = assess(from);
    const interval = observedInterval(from.at, to.at);
    // Only adjacent durable checkpoints form an observation. No extrapolation
    // beyond their timestamps or attribution to a model with no recorded run.
    if (phase && interval !== null) samples.set(phase, (samples.get(phase) ?? 0) + interval);
  }
  return { latest, current: assess(latest), samples };
}

export function acceptsMediaProgress(
  current: { id: string; status: string; updated_at?: string },
  incoming: { id: string; status: string; updated_at?: string }
) {
  if (current.id !== incoming.id) return false;
  if (!["queued", "running"].includes(current.status))
    return (
      incoming.status === current.status &&
      (observedInterval(current.updated_at, incoming.updated_at) !== null ||
        !current.updated_at ||
        !incoming.updated_at)
    );
  if (current.status === "running" && incoming.status === "queued") return false;
  return (
    !current.updated_at ||
    !incoming.updated_at ||
    observedInterval(current.updated_at, incoming.updated_at) !== null
  );
}

type StarsObservation = {
  id: string;
  version: number;
  execution?: { graph_id: string };
  runtime?: { version: number } | null;
};
export function acceptsStarsProgress(current: StarsObservation, incoming: StarsObservation) {
  if (current.id !== incoming.id || current.version > incoming.version) return false;
  if (current.execution && incoming.execution?.graph_id !== current.execution.graph_id)
    return incoming.version > current.version;
  return (
    !incoming.runtime || !current.runtime || incoming.runtime.version >= current.runtime.version
  );
}
