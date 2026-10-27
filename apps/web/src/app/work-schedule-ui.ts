import type { WorkDagNode } from "@cosmora/contracts";
import type { WorkPriority } from "@cosmora/contracts/work-schedule";

export const workPriorityLabels: Record<WorkPriority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный"
};
export type WorkDueFilter = "all" | "overdue" | "week" | "none";
export function workDeadlineState(
  node: Pick<WorkDagNode, "deadline" | "status">,
  now: number
): "none" | "done" | "overdue" | "upcoming" {
  if (!node.deadline) return "none";
  if (node.status === "completed" || node.status === "cancelled") return "done";
  return Date.parse(node.deadline) < now ? "overdue" : "upcoming";
}
export function filterWorkSteps(
  nodes: WorkDagNode[],
  status: string,
  due: WorkDueFilter,
  now: number
): WorkDagNode[] {
  return nodes.filter((node) => {
    if (status !== "all" && node.status !== status) return false;
    if (due === "all") return true;
    if (due === "none") return !node.deadline;
    const state = workDeadlineState(node, now);
    if (due === "overdue") return state === "overdue";
    return state === "upcoming" && Date.parse(node.deadline!) <= now + 7 * 86_400_000;
  });
}
export function workDeadlineLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
export function workDeadlineUtc(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || workDeadlineLocal(date.toISOString()) !== value)
    throw Error("Неверная локальная дата или время.");
  return date.toISOString();
}
