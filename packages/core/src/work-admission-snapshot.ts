/** Снимок admissible-контекста задачи: цель + материалы + зависимости.
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

/** Стабильный SHA-256 через WebCrypto-независимый FNV-1a (детерминизм важнее
 * криптостойкости: снимок не является подписью и не доказывает происхождение). */
const digestOf = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

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
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    dependencies,
    plan: input.plan.map((node) => ({
      title: node.title.trim(),
      ...(node.depends_on?.length ? { depends_on: [...node.depends_on].sort() } : {})
    }))
  };
  return {
    ...normalized,
    digest: digestOf(JSON.stringify({ ...normalized, sourceRunId: input.sourceRunId ?? "" }))
  };
};

/** Повтор запроса допустим, только если снимок алгоритмически совпадает. */
export const sameAdmissionSnapshot = (
  left: WorkAdmissionSnapshot,
  right: WorkAdmissionSnapshot
): boolean => left.digest === right.digest;
