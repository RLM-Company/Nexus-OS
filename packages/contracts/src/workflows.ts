import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  WorkDagNodeInputSchema,
  validateWorkDag,
  type WorkDagNodeInput
} from "@cosmora/contracts/work-dag";

const id = Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$" });
export const WorkflowParameterSchema = Type.Object(
  {
    id,
    label: Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" }),
    type: Type.Union([
      Type.Literal("text"),
      Type.Literal("number"),
      Type.Literal("boolean"),
      Type.Literal("choice"),
      Type.Literal("file"),
      Type.Literal("link")
    ]),
    required: Type.Boolean(),
    choices: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        minItems: 1,
        maxItems: 40,
        uniqueItems: true
      })
    )
  },
  { additionalProperties: false }
);
export type WorkflowParameter = Static<typeof WorkflowParameterSchema>;
export const WorkflowDefinitionInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
    description: Type.String({ maxLength: 2000 }),
    parameters: Type.Array(WorkflowParameterSchema, { maxItems: 32 }),
    nodes: Type.Array(WorkDagNodeInputSchema, { minItems: 1, maxItems: 32 }),
    requirements: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
      maxItems: 16,
      uniqueItems: true
    }),
    expected_results: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 16 })
  },
  { additionalProperties: false }
);
export type WorkflowDefinitionInput = Static<typeof WorkflowDefinitionInputSchema>;
export const WorkflowCreateSchema = Type.Object(
  { client_creation_id: id, definition: WorkflowDefinitionInputSchema },
  { additionalProperties: false }
);
export interface WorkflowDefinition extends WorkflowDefinitionInput {
  id: string;
  version: number;
  project_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
export const WorkflowEditSchema = Type.Object(
  { expected_version: Type.Integer({ minimum: 1 }), definition: WorkflowDefinitionInputSchema },
  { additionalProperties: false }
);
export const WorkflowRunInputSchema = Type.Object(
  {
    client_request_id: id,
    expected_version: Type.Integer({ minimum: 1 }),
    inputs: Type.Record(
      Type.String({ maxLength: 100 }),
      Type.Union([Type.String({ maxLength: 2000 }), Type.Number(), Type.Boolean()])
    ),
    auto_start: Type.Boolean()
  },
  { additionalProperties: false }
);
export type WorkflowRunInput = Static<typeof WorkflowRunInputSchema>;
export interface WorkflowRun {
  id: string;
  workflow_id: string;
  definition_version: number;
  definition: WorkflowDefinitionInput;
  inputs: WorkflowRunInput["inputs"];
  dag_id: string;
  client_request_id: string;
  created_at: string;
}
export const WorkflowPackageSchema = Type.Object(
  { format: Type.Literal("kosmora.workflow.v1"), definition: WorkflowDefinitionInputSchema },
  { additionalProperties: false }
);
export const WORKFLOW_PACKAGE_MAX_BYTES = 64000;
const reserved = new Set(["__proto__", "constructor", "prototype"]);
const placeholders = /\\\{\{|\{\{([a-zA-Z0-9_-]+)\}\}/g;
export function validateWorkflowDefinition(
  value: unknown
): asserts value is WorkflowDefinitionInput {
  if (!Value.Check(WorkflowDefinitionInputSchema, value)) throw new Error("INVALID_WORKFLOW");
  if (
    new TextEncoder().encode(JSON.stringify({ format: "kosmora.workflow.v1", definition: value }))
      .length > WORKFLOW_PACKAGE_MAX_BYTES
  )
    throw new Error("WORKFLOW_SIZE_LIMIT");
  const ids = new Set<string>();
  for (const parameter of value.parameters) {
    if (reserved.has(parameter.id) || ids.has(parameter.id))
      throw new Error("INVALID_WORKFLOW_PARAMETER");
    ids.add(parameter.id);
    if ((parameter.type === "choice") !== Boolean(parameter.choices?.length))
      throw new Error("INVALID_PARAMETER_CHOICES");
  }
  for (const node of value.nodes)
    for (const text of [node.title, node.goal])
      text.replace(placeholders, (match: string, key: string | undefined) => {
        if (key && !ids.has(key)) throw new Error("UNKNOWN_WORKFLOW_PARAMETER");
        return match;
      });
  validateWorkDag(value.nodes);
}
export function validateWorkflowInputs(
  definition: WorkflowDefinitionInput,
  inputs: WorkflowRunInput["inputs"]
): void {
  const fields = new Map(definition.parameters.map((p) => [p.id, p]));
  for (const [key, value] of Object.entries(inputs)) {
    const p = fields.get(key);
    if (!p || reserved.has(key)) throw new Error("INVALID_WORKFLOW_INPUT");
    const valid =
      p.type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : p.type === "boolean"
          ? typeof value === "boolean"
          : typeof value === "string" &&
            value.length <= 2000 &&
            (!p.required || value.trim().length > 0) &&
            (p.type !== "choice" || Boolean(p.choices?.includes(value)));
    if (!valid) throw new Error("INVALID_WORKFLOW_INPUT");
    if (p.type === "link") {
      let url: URL;
      try {
        url = new URL(value as string);
      } catch {
        throw new Error("INVALID_WORKFLOW_LINK");
      }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new Error("INVALID_WORKFLOW_LINK");
    }
  }
  for (const p of definition.parameters)
    if (p.required && !Object.hasOwn(inputs, p.id)) throw new Error("MISSING_WORKFLOW_INPUT");
}
export function renderWorkflowNodes(
  definition: WorkflowDefinitionInput,
  inputs: WorkflowRunInput["inputs"]
): WorkDagNodeInput[] {
  validateWorkflowInputs(definition, inputs);
  const render = (text: string) =>
    text.replace(placeholders, (_: string, key: string | undefined) =>
      key ? JSON.stringify(Object.hasOwn(inputs, key) ? inputs[key] : "") : "{{"
    );
  const nodes = definition.nodes.map((node) => ({
    ...structuredClone(node),
    title: render(node.title),
    goal: render(node.goal)
  }));
  if (nodes.some((node) => !Value.Check(WorkDagNodeInputSchema, node)))
    throw new Error("WORKFLOW_RENDER_TOO_LARGE");
  validateWorkDag(nodes);
  return nodes;
}
export function parseWorkflowPackage(value: unknown): WorkflowDefinitionInput {
  if (!Value.Check(WorkflowPackageSchema, value)) throw new Error("INVALID_WORKFLOW_PACKAGE");
  validateWorkflowDefinition(value.definition);
  // Connection permissions, values and previous execution state are never imported.
  return structuredClone(value.definition);
}
