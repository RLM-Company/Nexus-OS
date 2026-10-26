import { expect, it } from "vitest";
import { APEX_CATALOG, apexFeatureCatalog, executeApexAlgorithm } from "../src/apex/index.js";
import { Stage16WasmEvolutionarySynthKernel } from "../src/apex/stage16-wasm-evolutionary-synth/stage-kernel.js";
import { Stage1AutonomyKernel } from "../src/apex/stage1-autonomy/stage-kernel.js";
import { parseApexInput, ApexInputSchemas } from "@cosmora/contracts/apex";

const program = (value: number) => ({
  instruction_stream: [{ op: "PUSH", value }, { op: "HALT" }],
  gas_limit: 100,
  max_stack_limit: 4
});
it("covers all 512 IDs without certifying unbound proposals or running demos", () => {
  const catalog = apexFeatureCatalog();
  expect(catalog).toHaveLength(512);
  expect(new Set(catalog.map((f) => f.featureId)).size).toBe(512);
  expect(
    catalog
      .filter((f) => f.available)
      .map((f) => f.featureId)
      .sort()
  ).toEqual(Object.keys(ApexInputSchemas).sort());
  expect(catalog.every((f) => !f.product_complete)).toBe(true);
  for (const feature of catalog.filter((f) => !f.available))
    expect(() => executeApexAlgorithm(feature.featureId, {})).toThrow("APEX_ADAPTER_UNAVAILABLE");
});
it("F481 executes actual input instead of the fixed 100-result demonstration", () => {
  expect(executeApexAlgorithm("F481", program(999)).result).toMatchObject({
    return_value: 999,
    static_verification_passed: true,
    halted_cleanly: true,
    gas_consumed: 3
  });
  expect(executeApexAlgorithm("F481", program(0)).result).toMatchObject({ return_value: 0 });
  expect(executeApexAlgorithm("F481", program(999)).result_digest).not.toBe(
    executeApexAlgorithm("F481", program(12)).result_digest
  );
  expect(
    executeApexAlgorithm("F481", {
      instruction_stream: [{ op: "ADD" }, { op: "HALT" }],
      gas_limit: 10,
      max_stack_limit: 0
    }).result
  ).toMatchObject({ static_verification_passed: false, halted_cleanly: false, return_value: null });
});
it.each([
  { instruction_stream: [{ op: "PUSH", value: 2 }], gas_limit: 100 },
  { instruction_stream: [{ op: "HALT" }, { op: "PUSH", value: 2 }], gas_limit: 100 },
  { instruction_stream: [{ op: "LOAD", slot: 0 }, { op: "HALT" }], gas_limit: 100 },
  {
    instruction_stream: [{ op: "PUSH", value: 1 }, { op: "PUSH", value: 2 }, { op: "HALT" }],
    gas_limit: 100,
    max_stack_limit: 1
  }
])("rejects invalid program control/stack/memory with no success result", (input) => {
  expect(executeApexAlgorithm("F481", input).result).toMatchObject({
    static_verification_passed: false,
    halted_cleanly: false,
    return_value: null
  });
});
it("F482 enforces gas, arithmetic errors and actual store/load semantics", () => {
  expect(executeApexAlgorithm("F482", { ...program(7), gas_limit: 2 }).result).toMatchObject({
    gas_consumed: 2,
    halted_cleanly: false,
    failure_reason: "OUT_OF_GAS_AT_PC_1"
  });
  expect(
    executeApexAlgorithm("F482", {
      instruction_stream: [
        { op: "PUSH", value: 6 },
        { op: "STORE", slot: 0 },
        { op: "LOAD", slot: 0 },
        { op: "PUSH", value: 7 },
        { op: "MUL" },
        { op: "HALT" }
      ],
      gas_limit: 100
    }).result
  ).toMatchObject({ return_value: 42, memory_slots: { "0": 6 } });
  expect(
    executeApexAlgorithm("F482", {
      instruction_stream: [
        { op: "PUSH", value: 6 },
        { op: "PUSH", value: 0 },
        { op: "DIV" },
        { op: "HALT" }
      ],
      gas_limit: 100
    }).result
  ).toMatchObject({
    halted_cleanly: false,
    return_value: null,
    failure_reason: "DIVISION_BY_ZERO_AT_PC_2"
  });
});
it.each([
  { instruction_stream: [{ op: "EXEC", command: "readfile /private" }], gas_limit: 10 },
  { instruction_stream: [{ op: "PUSH", value: Number.NaN }, { op: "HALT" }], gas_limit: 10 },
  { ...program(1), host_path: "/private" },
  { ...program(1), gas_limit: 1000001 }
])("rejects hostile and unbounded bytecode before evaluation", (input) => {
  expect(() => executeApexAlgorithm("F481", input)).toThrow("APEX_INVALID_INPUT");
});
const machine = {
  machine_id: "test",
  initial_state: "start",
  states: ["start", "done", "dead"],
  transitions: [{ from: "start", to: "done", action: "finish" }],
  accepting_states: ["done"],
  forbidden_states: []
};
it.each(["F193", "F194", "F195", "F196", "F197", "F198"])(
  "%s analyzes the supplied state machine",
  (feature) => {
    expect(executeApexAlgorithm(feature, machine).result).toMatchObject({
      verified_safe: true,
      unreachable_states: ["dead"],
      liveness_satisfied: true
    });
    expect(
      executeApexAlgorithm(feature, { ...machine, forbidden_states: ["done"] }).result
    ).toMatchObject({ verified_safe: false, forbidden_reached: [{ state: "done" }] });
  }
);
it("does not call mere reachability a proof of eventual acceptance", () => {
  expect(
    executeApexAlgorithm("F193", {
      ...machine,
      transitions: [...machine.transitions, { from: "start", to: "start", action: "loop" }]
    }).result
  ).toMatchObject({ liveness_satisfied: false, verified_safe: false });
});
it.each(["F489", "F490"])("%s uses candidate costs and dimensions", (feature) => {
  const candidates = [
    { candidate_id: "a", objectives_minimize: [1, 3] },
    { candidate_id: "b", objectives_minimize: [3, 1] },
    { candidate_id: "c", objectives_minimize: [4, 4] }
  ];
  expect(executeApexAlgorithm(feature, { candidates }).result).toMatchObject({
    pareto_front_f1_ids: ["a", "b"],
    fronts_count: 2,
    ranked_population: [
      { candidate_id: "a", crowding_distance: null, crowding_unbounded: true },
      { candidate_id: "b", crowding_distance: null, crowding_unbounded: true },
      { candidate_id: "c", crowding_distance: null, crowding_unbounded: true }
    ]
  });
  expect(() =>
    executeApexAlgorithm(feature, {
      candidates: [candidates[0], { candidate_id: "b", objectives_minimize: [2] }]
    })
  ).toThrow("APEX_INVALID_INPUT");
});
it.each(["F497", "F498"])("%s computes and reconstructs actual token edit scripts", (feature) => {
  expect(
    executeApexAlgorithm(feature, {
      source_ast_tokens: ["a", "b"],
      target_ast_tokens: ["a", "c", "d"]
    }).result
  ).toMatchObject({ edit_distance: 2, reconstructed_target_matches: true });
  expect(
    executeApexAlgorithm(feature, { source_ast_tokens: [], target_ast_tokens: [] }).result
  ).toMatchObject({ edit_distance: 0, reconstructed_target_matches: true });
});
it("F505 reports a compression heuristic without fake metric certification", () => {
  expect(
    executeApexAlgorithm("F505", { payload_x: "same".repeat(100), payload_y: "same".repeat(100) })
      .result
  ).toMatchObject({ metric_axioms_verified: false });
});
it("F417 respects caller controller limits and rejects invalid clamps", () => {
  const input = {
    config: {
      kp: 1,
      ki: 0.1,
      kd: 0,
      setpoint: 10,
      integral_min: -10,
      integral_max: 10,
      output_min: -2,
      output_max: 2
    },
    initial_measurement: 0,
    plant_gain: 1,
    steps: 10
  };
  const result = executeApexAlgorithm("F417", input).result as { control_outputs: number[] };
  expect(result.control_outputs).toHaveLength(10);
  expect(result.control_outputs.every((x) => x >= -2 && x <= 2)).toBe(true);
  expect(() =>
    executeApexAlgorithm("F417", { ...input, config: { ...input.config, output_min: 3 } })
  ).toThrow("APEX_INVALID_INPUT");
});
it("legacy stage kernels cannot select demonstrations by feature number", () => {
  for (const [kernel, feature] of [
    [new Stage16WasmEvolutionarySynthKernel(), "F481"],
    [new Stage1AutonomyKernel(), "F009"]
  ] as const) {
    const descriptor = APEX_CATALOG.find((f) => f.featureId === feature)!;
    expect(() =>
      kernel.executeDomainOperation({
        featureId: feature,
        operationCode: descriptor.operationCode,
        requestId: "request",
        tenantId: "owner",
        projectId: "project",
        workspaceId: "workspace",
        actorId: "actor",
        autonomyLevel: "A6",
        domainFields: { instruction_stream: "ADD HALT" }
      })
    ).toThrow("APEX_ADAPTER_UNAVAILABLE");
  }
  expect(() => parseApexInput("F193", { ...machine, states: ["constructor"] })).toThrow(
    "APEX_INVALID_INPUT"
  );
});
