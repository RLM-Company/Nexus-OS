import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AgentDefinitionScopeSchema,
  AgentHandoffSchema,
  AgentInstanceStatusSchema,
  AgentMemoryScopeSchema,
  AgentStudioDecisionObjectTypeSchema,
  AgentStudioDecisionOperationSchema,
  BehaviorPatternTestStatusSchema,
  CreateAgentBlueprintRequestSchema,
  CreateAgentFunctionRequestSchema,
  CreateBehaviorPatternRequestSchema,
  ProposeDelegatedAgentRequestSchema,
  ProposeRootAgentRequestSchema,
  VersionedAgentReferenceSchema
} from "../src/index.js";

const timestamp = "2026-09-22T20:00:00.000Z";

const reference = {
  id: "object-1",
  version: 1
} as const;

const memoryScope = {
  read_mode: "task",
  source_ids: ["source-1"],
  write_back: "result_only"
} as const;

const grant = {
  capability_ids: ["context.project.read"],
  tool_ids: ["tool-1"],
  data_scope_ids: ["scope-1"],
  object_ids: ["object-1"],
  budget: {
    currency: "USD",
    money_minor: 0,
    tokens: 0,
    operations: 0
  },
  delegation_depth: 0,
  valid_until: timestamp
} as const;

const blueprintRequest = {
  function_ref: reference,
  behavior_pattern_ref: {
    id: "pattern-1",
    version: 1
  },
  model_profile_ref: {
    id: "model-profile-1",
    version: 1
  },
  grant,
  memory_scope: memoryScope,
  task_contract: "return a bounded result",
  start_condition: "when requested",
  close_conditions: ["result delivered"]
} as const;

describe("agent studio vocabulary boundaries", () => {
  it("accepts current scopes and rejects unknown scope values", () => {
    for (const scope of ["product", "owner", "project"]) {
      expect(Value.Check(AgentDefinitionScopeSchema, scope)).toBe(true);
    }

    for (const scope of ["", "global", "Project", " project ", null, 1]) {
      expect(Value.Check(AgentDefinitionScopeSchema, scope)).toBe(false);
    }
  });

  it("accepts current behavior test states and instance states", () => {
    for (const status of ["untested", "verified", "restricted", "rejected"]) {
      expect(Value.Check(BehaviorPatternTestStatusSchema, status)).toBe(true);
    }

    for (const status of [
      "proposed",
      "active",
      "paused",
      "completed",
      "replaced",
      "closed",
      "failed"
    ]) {
      expect(Value.Check(AgentInstanceStatusSchema, status)).toBe(true);
    }

    expect(Value.Check(BehaviorPatternTestStatusSchema, "approved")).toBe(false);
    expect(Value.Check(AgentInstanceStatusSchema, "running")).toBe(false);
  });

  it("accepts all decision operation and object-type literals", () => {
    const operations = [
      "function.create",
      "function.version",
      "pattern.create",
      "pattern.version",
      "pattern.archive",
      "blueprint.create",
      "blueprint.version",
      "proposal.root",
      "proposal.delegated"
    ];

    for (const operation of operations) {
      expect(Value.Check(AgentStudioDecisionOperationSchema, operation)).toBe(true);
    }

    for (const objectType of ["function", "pattern", "blueprint", "proposal"]) {
      expect(Value.Check(AgentStudioDecisionObjectTypeSchema, objectType)).toBe(true);
    }

    expect(Value.Check(AgentStudioDecisionOperationSchema, "proposal.create")).toBe(false);
    expect(Value.Check(AgentStudioDecisionObjectTypeSchema, "instance")).toBe(false);
  });
});

describe("agent studio reference and function request boundaries", () => {
  it("enforces positive reference versions and strict shape", () => {
    expect(Value.Check(VersionedAgentReferenceSchema, reference)).toBe(true);
    expect(Value.Check(VersionedAgentReferenceSchema, { ...reference, version: 0 })).toBe(false);
    expect(Value.Check(VersionedAgentReferenceSchema, { ...reference, version: 1.5 })).toBe(false);
    expect(Value.Check(VersionedAgentReferenceSchema, { ...reference, id: "object id" })).toBe(false);
    expect(
      Value.Check(VersionedAgentReferenceSchema, {
        ...reference,
        unexpected: true
      })
    ).toBe(false);
  });

  it("checks create-function text limits and strict shape", () => {
    const request = {
      name: "x",
      description: "x",
      result_contract: "x"
    };

    expect(Value.Check(CreateAgentFunctionRequestSchema, request)).toBe(true);
    expect(
      Value.Check(CreateAgentFunctionRequestSchema, {
        ...request,
        name: "x".repeat(120),
        description: "x".repeat(2_000),
        result_contract: "x".repeat(20_000)
      })
    ).toBe(true);

    for (const candidate of [
      { ...request, name: "" },
      { ...request, name: "x".repeat(121) },
      { ...request, description: "" },
      { ...request, description: "x".repeat(2_001) },
      { ...request, result_contract: "" },
      { ...request, result_contract: "x".repeat(20_001) },
      { ...request, unexpected: true }
    ]) {
      expect(Value.Check(CreateAgentFunctionRequestSchema, candidate)).toBe(false);
    }
  });
});

describe("behavior pattern request boundaries", () => {
  const request = {
    name: "Pattern",
    description: "Description",
    instructions: "Do the bounded task",
    allowed_function_ids: ["function-1"],
    known_limitations: [],
    test_status: "untested"
  } as const;

  it("requires unique allowed functions and enforces list size", () => {
    expect(Value.Check(CreateBehaviorPatternRequestSchema, request)).toBe(true);

    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        allowed_function_ids: []
      })
    ).toBe(false);

    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        allowed_function_ids: ["function-1", "function-1"]
      })
    ).toBe(false);

    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        allowed_function_ids: Array.from({ length: 100 }, (_, index) => `function-${index}`)
      })
    ).toBe(true);

    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        allowed_function_ids: Array.from({ length: 101 }, (_, index) => `function-${index}`)
      })
    ).toBe(false);
  });

  it("enforces instruction and limitation boundaries", () => {
    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        instructions: "x".repeat(100_000)
      })
    ).toBe(true);
    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        instructions: ""
      })
    ).toBe(false);
    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        instructions: "x".repeat(100_001)
      })
    ).toBe(false);

    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        known_limitations: Array.from({ length: 50 }, () => "known limitation")
      })
    ).toBe(true);
    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        known_limitations: Array.from({ length: 51 }, () => "known limitation")
      })
    ).toBe(false);
    expect(
      Value.Check(CreateBehaviorPatternRequestSchema, {
        ...request,
        known_limitations: [""]
      })
    ).toBe(false);
  });
});

describe("agent memory and blueprint input boundaries", () => {
  it("checks memory read/write vocabularies, uniqueness and strict shape", () => {
    for (const read_mode of ["none", "task", "project_segments", "handoff"]) {
      expect(Value.Check(AgentMemoryScopeSchema, { ...memoryScope, read_mode })).toBe(true);
    }

    for (const write_back of ["none", "result_only", "result_and_evidence"]) {
      expect(Value.Check(AgentMemoryScopeSchema, { ...memoryScope, write_back })).toBe(true);
    }

    expect(
      Value.Check(AgentMemoryScopeSchema, {
        ...memoryScope,
        source_ids: ["source-1", "source-1"]
      })
    ).toBe(false);

    expect(
      Value.Check(AgentMemoryScopeSchema, {
        ...memoryScope,
        source_ids: Array.from({ length: 1_001 }, (_, index) => `source-${index}`)
      })
    ).toBe(false);

    expect(Value.Check(AgentMemoryScopeSchema, { ...memoryScope, read_mode: "all" })).toBe(false);
    expect(Value.Check(AgentMemoryScopeSchema, { ...memoryScope, write_back: "full" })).toBe(false);
    expect(Value.Check(AgentMemoryScopeSchema, { ...memoryScope, unexpected: true })).toBe(false);
  });

  it("checks grant budget, delegation and collection constraints through blueprint input", () => {
    expect(Value.Check(CreateAgentBlueprintRequestSchema, blueprintRequest)).toBe(true);

    for (const delegation_depth of [0, 16]) {
      expect(
        Value.Check(CreateAgentBlueprintRequestSchema, {
          ...blueprintRequest,
          grant: { ...grant, delegation_depth }
        })
      ).toBe(true);
    }

    for (const delegation_depth of [-1, 17, 1.5]) {
      expect(
        Value.Check(CreateAgentBlueprintRequestSchema, {
          ...blueprintRequest,
          grant: { ...grant, delegation_depth }
        })
      ).toBe(false);
    }

    for (const budget of [
      { ...grant.budget, money_minor: -1 },
      { ...grant.budget, tokens: -1 },
      { ...grant.budget, operations: -1 },
      { ...grant.budget, money_minor: 1.5 },
      { ...grant.budget, currency: "EUR" }
    ]) {
      expect(
        Value.Check(CreateAgentBlueprintRequestSchema, {
          ...blueprintRequest,
          grant: { ...grant, budget }
        })
      ).toBe(false);
    }

    expect(
      Value.Check(CreateAgentBlueprintRequestSchema, {
        ...blueprintRequest,
        grant: {
          ...grant,
          tool_ids: ["tool-1", "tool-1"]
        }
      })
    ).toBe(false);
  });

  it("checks blueprint task and close-condition boundaries", () => {
    expect(
      Value.Check(CreateAgentBlueprintRequestSchema, {
        ...blueprintRequest,
        task_contract: "x".repeat(20_000),
        start_condition: "x".repeat(2_000),
        close_conditions: ["x".repeat(2_000)]
      })
    ).toBe(true);

    for (const candidate of [
      { ...blueprintRequest, task_contract: "" },
      { ...blueprintRequest, task_contract: "x".repeat(20_001) },
      { ...blueprintRequest, start_condition: "" },
      { ...blueprintRequest, start_condition: "x".repeat(2_001) },
      { ...blueprintRequest, close_conditions: [] },
      {
        ...blueprintRequest,
        close_conditions: Array.from({ length: 51 }, () => "condition")
      },
      { ...blueprintRequest, close_conditions: [""] },
      { ...blueprintRequest, unexpected: true }
    ]) {
      expect(Value.Check(CreateAgentBlueprintRequestSchema, candidate)).toBe(false);
    }
  });
});

describe("agent proposal and handoff boundaries", () => {
  it("checks root and delegated proposal strict shapes", () => {
    expect(
      Value.Check(ProposeRootAgentRequestSchema, {
        blueprint_ref: reference
      })
    ).toBe(true);
    expect(
      Value.Check(ProposeRootAgentRequestSchema, {
        blueprint_ref: reference,
        unexpected: true
      })
    ).toBe(false);

    expect(
      Value.Check(ProposeDelegatedAgentRequestSchema, {
        parent_instance_id: "instance-1",
        blueprint_ref: reference
      })
    ).toBe(true);
    expect(
      Value.Check(ProposeDelegatedAgentRequestSchema, {
        parent_instance_id: "instance id",
        blueprint_ref: reference
      })
    ).toBe(false);
  });

  it("checks handoff text, list and strict-object boundaries", () => {
    const handoff = {
      handoff_id: "handoff-1",
      project_id: "project-1",
      from_instance_id: "instance-1",
      to_instance_id: null,
      summary: "handoff summary",
      artifact_ids: ["artifact-1"],
      open_questions: [],
      known_errors: [],
      created_at: timestamp
    } as const;

    expect(Value.Check(AgentHandoffSchema, handoff)).toBe(true);
    expect(
      Value.Check(AgentHandoffSchema, {
        ...handoff,
        summary: "x".repeat(20_000)
      })
    ).toBe(true);

    for (const candidate of [
      { ...handoff, summary: "" },
      { ...handoff, summary: "x".repeat(20_001) },
      { ...handoff, artifact_ids: ["artifact-1", "artifact-1"] },
      {
        ...handoff,
        artifact_ids: Array.from({ length: 1_001 }, (_, index) => `artifact-${index}`)
      },
      {
        ...handoff,
        open_questions: Array.from({ length: 101 }, () => "question")
      },
      {
        ...handoff,
        known_errors: Array.from({ length: 101 }, () => "error")
      },
      { ...handoff, open_questions: [""] },
      { ...handoff, known_errors: [""] },
      { ...handoff, created_at: "2026-09-22" },
      { ...handoff, unexpected: true }
    ]) {
      expect(Value.Check(AgentHandoffSchema, candidate)).toBe(false);
    }
  });
});
