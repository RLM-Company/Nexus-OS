import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { WorkDagCreateSchema, validateWorkDag, type WorkDag } from "./work-dag.js";

export const WORK_PLAN_PACKAGE_MAX_BYTES = 600_000;
export const WorkPlanPackageSchema = Type.Object(
  {
    format: Type.Literal("kosmora.work-plan.v1"),
    title: WorkDagCreateSchema.properties.title,
    nodes: WorkDagCreateSchema.properties.nodes
  },
  { additionalProperties: false }
);
export type WorkPlanPackage = Static<typeof WorkPlanPackageSchema>;
export const WorkPlanImportSchema = Type.Object(
  {
    client_request_id: WorkDagCreateSchema.properties.client_request_id,
    package: WorkPlanPackageSchema
  },
  { additionalProperties: false }
);
export type WorkPlanImport = Static<typeof WorkPlanImportSchema>;

export function parseWorkPlanPackage(value: unknown): WorkPlanPackage {
  if (!Value.Check(WorkPlanPackageSchema, value)) throw new Error("INVALID_WORK_PLAN_PACKAGE");
  if (new TextEncoder().encode(JSON.stringify(value)).length > WORK_PLAN_PACKAGE_MAX_BYTES)
    throw new Error("PLAN_PACKAGE_LIMIT");
  validateWorkDag(value.nodes);
  return structuredClone(value);
}
export function parseWorkPlanPackageText(text: string): WorkPlanPackage {
  if (new TextEncoder().encode(text).length > WORK_PLAN_PACKAGE_MAX_BYTES)
    throw new Error("PLAN_PACKAGE_LIMIT");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_WORK_PLAN_PACKAGE");
  }
  return parseWorkPlanPackage(value);
}
export function createWorkPlanPackage(graph: Pick<WorkDag, "title" | "nodes">): WorkPlanPackage {
  return parseWorkPlanPackage({
    format: "kosmora.work-plan.v1",
    title: graph.title,
    nodes: graph.nodes.map(({ id, title, goal, depends_on, requires_critic }) => ({
      id,
      title,
      goal,
      depends_on: [...depends_on],
      ...(requires_critic === undefined ? {} : { requires_critic })
    }))
  });
}
