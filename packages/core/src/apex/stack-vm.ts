import { createHash } from "node:crypto";
import type {
  BytecodeInstruction,
  BytecodeVerificationAndRunResult
} from "./kosmora-wasm-evolutionary-synth-engine.js";
const costs: Record<BytecodeInstruction["op"], number> = {
  PUSH: 2,
  DUP: 2,
  SWAP: 2,
  ADD: 3,
  SUB: 3,
  MUL: 5,
  DIV: 8,
  MOD: 8,
  CMP_EQ: 3,
  CMP_LT: 3,
  LOAD: 4,
  STORE: 6,
  HALT: 1
};

/** Bounded arithmetic VM, never JavaScript/Wasm evaluation, filesystem access or host spawning. */
export function runStackBytecode(params: {
  program: BytecodeInstruction[];
  gas_limit: number;
  max_stack_limit?: number;
}): BytecodeVerificationAndRunResult {
  const max = params.max_stack_limit ?? 64;
  if (
    !Array.isArray(params.program) ||
    params.program.length < 1 ||
    params.program.length > 4096 ||
    !Number.isSafeInteger(params.gas_limit) ||
    params.gas_limit < 0 ||
    params.gas_limit > 1000000 ||
    !Number.isSafeInteger(max) ||
    max < 0 ||
    max > 1024
  )
    throw Error("INVALID_BYTECODE_INPUT");
  const program = structuredClone(params.program),
    trace: string[] = [],
    memory: Record<number, number> = {};
  let depth = 0,
    peak = 0,
    gas = 0;
  const stored = new Set<number>();
  const result = (
    verified: boolean,
    halted: boolean,
    value: number | null,
    reason?: string
  ): BytecodeVerificationAndRunResult => ({
    static_verification_passed: verified,
    max_stack_depth_observed: peak,
    gas_limit: params.gas_limit,
    gas_consumed: gas,
    halted_cleanly: halted,
    return_value: value,
    memory_slots: { ...memory },
    ...(reason ? { failure_reason: reason } : {}),
    execution_trace_sha256: createHash("sha256")
      .update(JSON.stringify({ program, max, gas_limit: params.gas_limit, trace, reason }))
      .digest("hex")
  });
  for (let pc = 0; pc < program.length; pc++) {
    const instruction = program[pc]!;
    if (!instruction || !Object.hasOwn(costs, instruction.op))
      throw Error("INVALID_BYTECODE_OPCODE");
    const expected =
      instruction.op === "PUSH"
        ? ["op", "value"]
        : instruction.op === "LOAD" || instruction.op === "STORE"
          ? ["op", "slot"]
          : ["op"];
    if (Object.keys(instruction).sort().join(",") !== expected.sort().join(","))
      throw Error("INVALID_BYTECODE_INSTRUCTION");
    if (
      instruction.op === "PUSH" &&
      (!Number.isFinite(instruction.value) || Math.abs(instruction.value) > 1e12)
    )
      throw Error("INVALID_BYTECODE_NUMBER");
    if (
      (instruction.op === "LOAD" || instruction.op === "STORE") &&
      (!Number.isSafeInteger(instruction.slot) || instruction.slot < 0 || instruction.slot > 4095)
    )
      throw Error("INVALID_BYTECODE_SLOT");
    const need =
      instruction.op === "DUP" || instruction.op === "STORE"
        ? 1
        : ["SWAP", "ADD", "SUB", "MUL", "DIV", "MOD", "CMP_EQ", "CMP_LT"].includes(instruction.op)
          ? 2
          : 0;
    if (depth < need)
      return result(false, false, null, `STATIC_STACK_UNDERFLOW_AT_PC_${pc}_${instruction.op}`);
    if (instruction.op === "LOAD" && !stored.has(instruction.slot))
      return result(false, false, null, `UNINITIALIZED_LOAD_AT_PC_${pc}`);
    if (instruction.op === "STORE") stored.add(instruction.slot);
    depth +=
      instruction.op === "PUSH" || instruction.op === "LOAD" || instruction.op === "DUP"
        ? 1
        : instruction.op === "STORE" || (need === 2 && instruction.op !== "SWAP")
          ? -1
          : 0;
    peak = Math.max(peak, depth);
    if (depth > max) return result(false, false, null, `STATIC_STACK_OVERFLOW_AT_PC_${pc}`);
    if (instruction.op === "HALT" && pc !== program.length - 1)
      return result(false, false, null, "UNREACHABLE_INSTRUCTIONS_AFTER_HALT");
  }
  if (program.at(-1)?.op !== "HALT") return result(false, false, null, "MISSING_HALT");
  const stack: number[] = [];
  for (let pc = 0; pc < program.length; pc++) {
    const instruction = program[pc]!;
    if (gas + costs[instruction.op] > params.gas_limit)
      return result(true, false, null, `OUT_OF_GAS_AT_PC_${pc}`);
    gas += costs[instruction.op];
    if (instruction.op === "PUSH") stack.push(instruction.value);
    else if (instruction.op === "LOAD") stack.push(memory[instruction.slot]!);
    else if (instruction.op === "STORE") memory[instruction.slot] = stack.pop()!;
    else if (instruction.op === "DUP") stack.push(stack.at(-1)!);
    else if (instruction.op === "SWAP") {
      const b = stack.pop()!,
        a = stack.pop()!;
      stack.push(b, a);
    } else if (instruction.op === "HALT") {
      trace.push(`HALT:${stack.at(-1) ?? "empty"}`);
      return result(true, true, stack.at(-1) ?? null);
    } else {
      const b = stack.pop()!,
        a = stack.pop()!;
      if ((instruction.op === "DIV" || instruction.op === "MOD") && b === 0)
        return result(true, false, null, `DIVISION_BY_ZERO_AT_PC_${pc}`);
      const value =
        instruction.op === "ADD"
          ? a + b
          : instruction.op === "SUB"
            ? a - b
            : instruction.op === "MUL"
              ? a * b
              : instruction.op === "DIV"
                ? Math.trunc(a / b)
                : instruction.op === "MOD"
                  ? a % b
                  : instruction.op === "CMP_EQ"
                    ? Number(a === b)
                    : Number(a < b);
      if (!Number.isFinite(value) || Math.abs(value) > 1e12)
        return result(true, false, null, `NUMERIC_OVERFLOW_AT_PC_${pc}`);
      stack.push(value);
    }
    trace.push(`${pc}:${instruction.op}:${JSON.stringify(stack)}:${JSON.stringify(memory)}`);
  }
  return result(true, false, null, "MISSING_HALT");
}
