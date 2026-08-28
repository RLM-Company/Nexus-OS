import {
  AgentBlueprintSchema,
  AgentFunctionDefinitionSchema,
  AgentInstructionPlanSchema,
  BehaviorPatternSchema,
  VersionedInstructionTextSourceSchema,
  type AgentBlueprint,
  type AgentFunctionDefinition,
  type AgentInstructionPlan,
  type BehaviorPattern,
  type VersionedInstructionTextSource
} from "@cosmora/contracts";
import { Value } from "typebox/value";

export interface AgentInstructionTaskInput {
  task_id: string;
  instructions: string;
}

export interface ComposeAgentInstructionPlanInput {
  blueprint: AgentBlueprint;
  agentFunction: AgentFunctionDefinition;
  behaviorPattern: BehaviorPattern;
  constitution: VersionedInstructionTextSource;
  policy: VersionedInstructionTextSource;
  task: AgentInstructionTaskInput;
}

export class AgentInstructionPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInstructionPlanValidationError";
  }
}

const isVisible = (
  definition: AgentFunctionDefinition | BehaviorPattern,
  blueprint: AgentBlueprint
): boolean => {
  if (definition.scope === "product") {
    return definition.owner_id === null && definition.project_id === null;
  }
  if (definition.scope === "owner") {
    return definition.owner_id === blueprint.owner_id && definition.project_id === null;
  }
  return (
    definition.owner_id === blueprint.owner_id && definition.project_id === blueprint.project_id
  );
};

const sameReference = (
  reference: { id: string; version: number },
  id: string,
  version: number
): boolean => reference.id === id && reference.version === version;

export function composeAgentInstructionPlan(
  input: ComposeAgentInstructionPlanInput
): AgentInstructionPlan {
  if (!Value.Check(AgentBlueprintSchema, input.blueprint)) {
    throw new AgentInstructionPlanValidationError("Agent blueprint violates its contract");
  }
  if (!Value.Check(AgentFunctionDefinitionSchema, input.agentFunction)) {
    throw new AgentInstructionPlanValidationError("Agent function violates its contract");
  }
  if (!Value.Check(BehaviorPatternSchema, input.behaviorPattern)) {
    throw new AgentInstructionPlanValidationError("Behavior pattern violates its contract");
  }
  if (
    !Value.Check(VersionedInstructionTextSourceSchema, input.constitution) ||
    !Value.Check(VersionedInstructionTextSourceSchema, input.policy)
  ) {
    throw new AgentInstructionPlanValidationError(
      "Constitution and policy sources must be exact versioned instruction sources"
    );
  }
  if (input.blueprint.grant.project_id !== input.blueprint.project_id) {
    throw new AgentInstructionPlanValidationError("Agent grant is bound to another project");
  }
  if (
    !sameReference(
      input.blueprint.function_ref,
      input.agentFunction.function_id,
      input.agentFunction.version
    ) ||
    !sameReference(
      input.blueprint.behavior_pattern_ref,
      input.behaviorPattern.pattern_id,
      input.behaviorPattern.version
    )
  ) {
    throw new AgentInstructionPlanValidationError(
      "Instruction sources do not match the exact blueprint references"
    );
  }
  if (
    !isVisible(input.agentFunction, input.blueprint) ||
    !isVisible(input.behaviorPattern, input.blueprint)
  ) {
    throw new AgentInstructionPlanValidationError(
      "Instruction sources are not visible to the blueprint owner and project"
    );
  }
  if (input.behaviorPattern.archived_at !== null) {
    throw new AgentInstructionPlanValidationError("Archived behavior patterns cannot be composed");
  }
  if (!input.behaviorPattern.allowed_function_ids.includes(input.agentFunction.function_id)) {
    throw new AgentInstructionPlanValidationError(
      "Behavior pattern is incompatible with the selected function"
    );
  }

  const blueprint = structuredClone(input.blueprint);
  const plan = {
    plan_version: 1 as const,
    executable: false as const,
    blueprint_ref: { id: blueprint.blueprint_id, version: blueprint.version },
    owner_id: blueprint.owner_id,
    project_id: blueprint.project_id,
    model_profile_ref: blueprint.model_profile_ref,
    precedence: ["constitution", "policy", "function", "behavior", "task"] as const,
    layers: {
      constitution: {
        authority: "constitution" as const,
        source: structuredClone(input.constitution)
      },
      policy: {
        authority: "policy" as const,
        source: structuredClone(input.policy)
      },
      function: {
        authority: "function" as const,
        definition: structuredClone(input.agentFunction),
        declared_grant: blueprint.grant,
        memory_scope: blueprint.memory_scope,
        task_contract: blueprint.task_contract,
        start_condition: blueprint.start_condition,
        close_conditions: blueprint.close_conditions
      },
      behavior: {
        authority: "behavior" as const,
        pattern: structuredClone(input.behaviorPattern)
      },
      task: {
        authority: "task" as const,
        task_id: input.task.task_id,
        instructions: input.task.instructions
      }
    }
  };
  if (!Value.Check(AgentInstructionPlanSchema, plan)) {
    throw new AgentInstructionPlanValidationError(
      "Composed instruction plan violates its contract"
    );
  }
  return plan;
}
