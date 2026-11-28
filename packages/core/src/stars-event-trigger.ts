/** Lightweight Stars event/schedule wake checks. The model is invoked only
 * when a check actually selects a mission action; waiting itself is cheap. */
import type { StarsMission } from "./stars-mission.js";

export type StarsWakeInput = {
  kind: "event" | "schedule" | "condition";
  source_id: string;
  project_id: string | null;
  mission_id?: string;
  at: string;
  condition?: "all_verified" | "pending_result" | "awaiting_owner";
};
export type StarsWakeDecision = {
  wake: boolean;
  reason: string;
  mission_id: string | null;
};
export function shouldWakeStars(mission: StarsMission, input: StarsWakeInput): StarsWakeDecision {
  const idle = ["completed", "cancelled", "paused"].includes(mission.stage);
  if (idle) return { wake: false, reason: "terminal_or_paused", mission_id: mission.id };
  if (input.mission_id && input.mission_id !== mission.id)
    return { wake: false, reason: "other_mission", mission_id: mission.id };
  if (
    input.project_id &&
    !mission.agents.some((agent) => agent.context_scopes.includes(input.project_id!))
  )
    return { wake: false, reason: "project_not_in_scope", mission_id: mission.id };
  if (input.kind === "condition") {
    if (input.condition === "all_verified")
      return {
        wake:
          mission.results.length > 0 && mission.results.every((r) => r.verification === "verified"),
        reason: "all_verified",
        mission_id: mission.id
      };
    if (input.condition === "pending_result")
      return {
        wake: mission.agents.some((agent) => agent.status === "assigned"),
        reason: "pending_result",
        mission_id: mission.id
      };
    if (input.condition === "awaiting_owner")
      return { wake: Boolean(mission.question), reason: "awaiting_owner", mission_id: mission.id };
    return { wake: false, reason: "unknown_condition", mission_id: mission.id };
  }
  // Event/schedule wake only for a mission that is actually in progress.
  return {
    wake: mission.stage === "working" || mission.stage === "verifying",
    reason: input.kind,
    mission_id: mission.id
  };
}
