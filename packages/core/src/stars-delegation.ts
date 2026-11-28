/** Delegation from a Stars mission into the existing WorkDAG.
 * Pure translation only: every emitted node keeps the mission's author,
 * responsible agent, input versions and acceptance criteria in its goal text,
 * and dependencies are preserved. No second scheduler or status mirror. */
import type { StarsOrgSnapshot } from "./stars-hierarchy.js";
import type { StarsMission } from "./stars-mission.js";
import { accountableManager, resolveAssignee } from "./stars-hierarchy.js";

export type DelegatedNode = {
  id: string;
  title: string;
  goal: string;
  depends_on: string[];
  requires_critic: boolean;
};
export type DelegationPlan = {
  project_id: string;
  composition_version: number;
  mission_version: number;
  nodes: DelegatedNode[];
  skipped: Array<{ agent_id: string; reason: string }>;
};

const briefLine = (mission: StarsMission): string => {
  if (!mission.brief) return "";
  return [
    `Автор: ${mission.brief.author}`,
    `Ответственный: ${mission.brief.responsible}`,
    `Входные версии: ${mission.brief.input_versions.join(", ") || "нет"}`,
    `Критерии: ${mission.brief.criteria.join("; ") || "нет"}`,
    `Приёмка: ${mission.brief.acceptance_rules.join("; ") || "нет"}`
  ].join("\n");
};

/** Build one WorkDAG plan for a project. An executor is chosen only through
 * the accountable manager and a declared responsibility zone; if either is
 * ambiguous the agent is skipped with a visible reason. */
export function delegateMission(
  mission: StarsMission,
  org: StarsOrgSnapshot,
  projectId: string,
  zoneByAgent: Record<string, string>
): DelegationPlan {
  const manager = accountableManager(org, projectId);
  const nodes: DelegatedNode[] = [];
  const skipped: DelegationPlan["skipped"] = [];
  const prefix = briefLine(mission);
  for (const member of mission.agents) {
    if (member.role !== "executor") continue;
    const zone = zoneByAgent[member.id];
    const assignee = manager && zone ? resolveAssignee(org, manager.id, zone) : null;
    if (!assignee || assignee.id !== member.id) {
      skipped.push({
        agent_id: member.id,
        reason: manager
          ? "Нет однозначного исполнителя в зоне ответственности."
          : "Нет одного ответственного менеджера проекта."
      });
      continue;
    }
    const depends = mission.dependencies[member.id] ?? [];
    if (depends.some((dep) => !mission.agents.some((agent) => agent.id === dep))) {
      skipped.push({ agent_id: member.id, reason: "Неизвестная зависимость в поручении." });
      continue;
    }
    nodes.push({
      id: member.id,
      title: member.task,
      goal: [prefix, `Задача: ${member.task}`, `Зона: ${zone}`].filter(Boolean).join("\n"),
      depends_on: [...depends],
      requires_critic: false
    });
  }
  return {
    project_id: projectId,
    composition_version: org.version,
    mission_version: mission.version,
    nodes,
    skipped
  };
}
