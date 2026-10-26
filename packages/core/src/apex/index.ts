import { isApexAlgorithmId, parseApexInput, type ApexAlgorithmId } from "@cosmora/contracts/apex";
import { APEX_CATALOG } from "./catalog.js";
import { apexDigest, ApexAdapterUnavailable } from "./bound-kernel.js";
import { KosmoraWasmEvolutionarySynthEngine } from "./kosmora-wasm-evolutionary-synth-engine.js";
import { KosmoraFormalVerificationEngine } from "./kosmora-formal-verification-engine.js";
import { KosmoraCyberneticControlEngine } from "./kosmora-cybernetic-control-engine.js";
export { ApexAdapterUnavailable } from "./bound-kernel.js";
export { APEX_CATALOG } from "./catalog.js";

export function apexFeatureCatalog() {
  return APEX_CATALOG.map((feature) => ({
    ...feature,
    available: isApexAlgorithmId(feature.featureId),
    readiness: isApexAlgorithmId(feature.featureId) ? "bounded_algorithm" : "adapter_required",
    product_complete: false,
    reason: isApexAlgorithmId(feature.featureId)
      ? "Вычисляет результат на переданных данных; ограничения указаны в контракте."
      : "Нужен проверенный обработчик или интеграция с сервисом Kosmora; демонстрация не исполняется."
  }));
}
/** Stateless, bounded operations. No auth, persistence, subprocess or provider replacement here. */
export function executeApexAlgorithm(featureId: string, input: unknown) {
  if (!isApexAlgorithmId(featureId)) throw new ApexAdapterUnavailable(featureId);
  const result = execute(featureId, input);
  return {
    feature_id: featureId,
    kind: "bounded_algorithm" as const,
    input_digest: apexDigest(input),
    result,
    result_digest: apexDigest(result),
    formal_guarantee: false as const
  };
}
function execute(id: ApexAlgorithmId, input: unknown): unknown {
  const vm = new KosmoraWasmEvolutionarySynthEngine();
  switch (id) {
    case "F481":
    case "F482": {
      const value = parseApexInput(id, input);
      return vm.verifyAndExecuteStackBytecode({
        program: value.instruction_stream,
        gas_limit: value.gas_limit,
        ...(value.max_stack_limit !== undefined ? { max_stack_limit: value.max_stack_limit } : {})
      });
    }
    case "F489":
    case "F490": {
      const value = parseApexInput(id, input),
        dimensions = value.candidates[0]!.objectives_minimize.length;
      if (
        new Set(value.candidates.map((item) => item.candidate_id)).size !==
          value.candidates.length ||
        value.candidates.some((item) => item.objectives_minimize.length !== dimensions)
      )
        throw Error("APEX_INVALID_INPUT");
      return vm.computeNsga2ParetoFronts(value);
    }
    case "F497":
    case "F498":
      return vm.computeAstEditDistanceAndScript(parseApexInput(id, input));
    case "F505":
      return vm.computeNormalizedCompressionDistance(parseApexInput(id, input));
    case "F417": {
      const value = parseApexInput(id, input),
        c = value.config;
      if (c.integral_min > c.integral_max || c.output_min > c.output_max)
        throw Error("APEX_INVALID_INPUT");
      const result = new KosmoraCyberneticControlEngine().simulateDiscretePidControlLoop(value);
      if (
        !Number.isFinite(result.final_measurement) ||
        !result.control_outputs.every(Number.isFinite)
      )
        throw Error("APEX_NUMERIC_OVERFLOW");
      return result;
    }
    case "F193":
    case "F194":
    case "F195":
    case "F196":
    case "F197":
    case "F198": {
      const value = parseApexInput(id, input),
        states = new Set(value.states);
      if (
        !states.has(value.initial_state) ||
        [...value.accepting_states, ...value.forbidden_states].some(
          (state) => !states.has(state)
        ) ||
        value.transitions.some((tr) => !states.has(tr.from) || !states.has(tr.to))
      )
        throw Error("APEX_INVALID_INPUT");
      return new KosmoraFormalVerificationEngine().verifyStateMachineInvariants(value);
    }
  }
}
