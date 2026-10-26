import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
const object = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const id = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9][A-Za-z0-9_-]*$"
});
const number = () => Type.Number({ minimum: -1e9, maximum: 1e9 });
const ids = (min = 0, max = 128) =>
  Type.Array(id, { minItems: min, maxItems: max, uniqueItems: true });
const instruction = Type.Union([
  object({ op: Type.Literal("PUSH"), value: number() }),
  object({
    op: Type.Union([Type.Literal("LOAD"), Type.Literal("STORE")]),
    slot: Type.Integer({ minimum: 0, maximum: 4095 })
  }),
  object({
    op: Type.Union(
      (["ADD", "SUB", "MUL", "DIV", "MOD", "DUP", "SWAP", "CMP_EQ", "CMP_LT", "HALT"] as const).map(
        (value) => Type.Literal(value)
      )
    )
  })
]);
const vm = object({
  instruction_stream: Type.Array(instruction, { minItems: 1, maxItems: 4096 }),
  gas_limit: Type.Integer({ minimum: 0, maximum: 1000000 }),
  max_stack_limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 1024 }))
});
const pareto = object({
  candidates: Type.Array(
    object({
      candidate_id: id,
      objectives_minimize: Type.Array(number(), { minItems: 1, maxItems: 16 })
    }),
    { minItems: 1, maxItems: 128 }
  )
});
const tokens = object({
  source_ast_tokens: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 }),
  target_ast_tokens: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 256 })
});
const fsm = object({
  machine_id: id,
  initial_state: id,
  states: ids(1, 128),
  transitions: Type.Array(
    object({ from: id, to: id, action: Type.String({ minLength: 1, maxLength: 128 }) }),
    { maxItems: 1024 }
  ),
  accepting_states: ids(),
  forbidden_states: ids()
});
const pid = object({
  config: object({
    kp: number(),
    ki: number(),
    kd: number(),
    setpoint: number(),
    integral_min: number(),
    integral_max: number(),
    output_min: number(),
    output_max: number()
  }),
  initial_measurement: number(),
  plant_gain: number(),
  steps: Type.Integer({ minimum: 1, maximum: 1000 }),
  dt_sec: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 100 }))
});
export const ApexInputSchemas = {
  F193: fsm,
  F194: fsm,
  F195: fsm,
  F196: fsm,
  F197: fsm,
  F198: fsm,
  F417: pid,
  F481: vm,
  F482: vm,
  F489: pareto,
  F490: pareto,
  F497: tokens,
  F498: tokens,
  F505: object({
    payload_x: Type.String({ maxLength: 32768 }),
    payload_y: Type.String({ maxLength: 32768 })
  })
} as const;
export type ApexAlgorithmId = keyof typeof ApexInputSchemas;
export type ApexAlgorithmInput<K extends ApexAlgorithmId> = Static<(typeof ApexInputSchemas)[K]>;
export function isApexAlgorithmId(value: string): value is ApexAlgorithmId {
  return Object.hasOwn(ApexInputSchemas, value);
}
export function parseApexInput<K extends ApexAlgorithmId>(
  id: K,
  value: unknown
): ApexAlgorithmInput<K> {
  if (!Value.Check(ApexInputSchemas[id], value)) throw Error("APEX_INVALID_INPUT");
  return structuredClone(value);
}
