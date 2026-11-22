import { createHash } from "node:crypto";

/** Снимок входных данных задачи, включая цель, материалы и зависимости.
 * Чистая функция: без БД, без модели, без записи. Позволяет зафиксировать
 * входные данные один раз и проверять их при повторном запросе/рестарте. */
export type AdmissionAttachment = { name: string; content: string };
export type AdmissionMaterials = { instructions: string; attachments: AdmissionAttachment[] };
export type AdmissionPlanNode = { title: string; depends_on?: string[] };
export type WorkAdmissionSnapshot = {
  format: "kosmora.work-admission.v1";
  goal: string;
  materials: AdmissionMaterials;
  dependencies: string[];
  plan: AdmissionPlanNode[];
  digest: string;
};

const compare = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

export const buildWorkAdmissionSnapshot = (input: {
  goal: string;
  materials: AdmissionMaterials;
  plan: AdmissionPlanNode[];
  sourceRunId?: string;
}): WorkAdmissionSnapshot => {
  const goal = input.goal.trim();
  if (!goal) throw new Error("INVALID_GOAL");
  const dependencies = [...new Set(input.plan.flatMap((node) => node.depends_on ?? []))].sort();
  const normalized = {
    format: "kosmora.work-admission.v1" as const,
    goal,
    materials: {
      instructions: input.materials.instructions.trim(),
      attachments: [...input.materials.attachments]
        .map((item) => ({ name: item.name.trim(), content: item.content }))
        .sort((a, b) => compare(a.name, b.name) || compare(a.content, b.content))
    },
    dependencies,
    plan: input.plan.map((node) => ({
      title: node.title.trim(),
      ...(node.depends_on?.length ? { depends_on: [...node.depends_on].sort() } : {})
    }))
  };
  return {
    ...normalized,
    digest: createHash("sha256")
      .update(JSON.stringify({ ...normalized, sourceRunId: input.sourceRunId ?? "" }))
      .digest("hex")
  };
};

/** Повтор запроса допустим, только если снимок алгоритмически совпадает. */
export const sameAdmissionSnapshot = (
  left: WorkAdmissionSnapshot,
  right: WorkAdmissionSnapshot
): boolean => left.digest === right.digest;
