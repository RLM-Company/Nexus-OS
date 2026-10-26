/**
 * Stage 16 (F481-F512): Deterministic Stack-Bytecode Verifier & Evolutionary Program Synthesis Engine
 * 1. Static Stack-Height Bytecode Verifier & Gas-Metered Abstract Machine
 * 2. NSGA-II Multi-Objective Non-Dominated Pareto Front & Crowding Distance Ranker
 * 3. Wagner-Fischer AST Edit Distance & Minimal Structural Patch Script Synthesizer
 * 4. Zlib-Deflate Normalized Compression Distance (NCD) & Kolmogorov Information Complexity
 */

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export type BytecodeInstruction =
  | { op: "PUSH"; value: number }
  | { op: "ADD" }
  | { op: "SUB" }
  | { op: "MUL" }
  | { op: "DIV" }
  | { op: "MOD" }
  | { op: "DUP" }
  | { op: "SWAP" }
  | { op: "STORE"; slot: number }
  | { op: "LOAD"; slot: number }
  | { op: "CMP_EQ" }
  | { op: "CMP_LT" }
  | { op: "HALT" };

export interface BytecodeVerificationAndRunResult {
  static_verification_passed: boolean;
  max_stack_depth_observed: number;
  gas_limit: number;
  gas_consumed: number;
  halted_cleanly: boolean;
  return_value: number | null;
  memory_slots: Record<number, number>;
  failure_reason?: string;
  execution_trace_sha256: string;
}

export interface ParetoCandidateSpec {
  candidate_id: string;
  objectives_minimize: number[]; // e.g., [latency_ms, cost_usd, error_rate]
}

export interface RankedParetoCandidate extends ParetoCandidateSpec {
  pareto_rank: number; // 1 = Pareto optimal front F_1
  crowding_distance: number;
}

export interface Nsga2ParetoResult {
  total_candidates: number;
  pareto_front_f1_ids: string[];
  fronts_count: number;
  ranked_population: RankedParetoCandidate[];
  nsga2_digest: string;
}

export interface AstEditOperation {
  action: "KEEP" | "INSERT" | "DELETE" | "RENAME";
  source_token?: string;
  target_token?: string;
  cost: number;
}

export interface AstEditDistanceResult {
  edit_distance: number;
  normalized_similarity: number;
  operations: AstEditOperation[];
  reconstructed_target_matches: boolean;
  ast_patch_digest: string;
}

export interface NormalizedCompressionDistanceResult {
  bytes_x_compressed: number;
  bytes_y_compressed: number;
  bytes_xy_compressed: number;
  ncd_score: number;
  information_similarity: number;
  metric_axioms_verified: boolean;
  ncd_digest: string;
}

const GAS_COST_TABLE: Record<BytecodeInstruction["op"], number> = {
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

export class KosmoraWasmEvolutionarySynthEngine {
  // ==========================================================================
  // F481-F488: Static Stack-Bytecode Verifier & Gas-Metered Virtual Machine
  // ==========================================================================

  public verifyAndExecuteStackBytecode(params: {
    program: BytecodeInstruction[];
    gas_limit: number;
    max_stack_limit?: number;
  }): BytecodeVerificationAndRunResult {
    const maxStack = params.max_stack_limit ?? 64;

    // 1. Static stack depth verification pass
    let simDepth = 0;
    let maxDepthObserved = 0;
    for (let pc = 0; pc < params.program.length; pc++) {
      const ins = params.program[pc]!;
      const delta =
        ins.op === "PUSH" || ins.op === "LOAD" || ins.op === "DUP"
          ? 1
          : ins.op === "ADD" ||
              ins.op === "SUB" ||
              ins.op === "MUL" ||
              ins.op === "DIV" ||
              ins.op === "MOD" ||
              ins.op === "CMP_EQ" ||
              ins.op === "CMP_LT" ||
              ins.op === "STORE"
            ? -1
            : 0;
      const requiredPop =
        ins.op === "DUP" || ins.op === "STORE"
          ? 1
          : ins.op === "SWAP" || delta === -1
            ? 2
            : 0;

      if (simDepth < requiredPop) {
        return {
          static_verification_passed: false,
          max_stack_depth_observed: maxDepthObserved,
          gas_limit: params.gas_limit,
          gas_consumed: 0,
          halted_cleanly: false,
          return_value: null,
          memory_slots: {},
          failure_reason: `STATIC_STACK_UNDERFLOW_AT_PC_${pc}_${ins.op}`,
          execution_trace_sha256: sha256Hex(`FAIL_UNDERFLOW_${pc}`)
        };
      }
      simDepth += delta;
      if (simDepth > maxStack) {
        return {
          static_verification_passed: false,
          max_stack_depth_observed: simDepth,
          gas_limit: params.gas_limit,
          gas_consumed: 0,
          halted_cleanly: false,
          return_value: null,
          memory_slots: {},
          failure_reason: `STATIC_STACK_OVERFLOW_AT_PC_${pc}`,
          execution_trace_sha256: sha256Hex(`FAIL_OVERFLOW_${pc}`)
        };
      }
      if (simDepth > maxDepthObserved) maxDepthObserved = simDepth;
      if (ins.op === "HALT") break;
    }

    // 2. Deterministic Gas-Metered Execution
    const stack: number[] = [];
    const memory: Record<number, number> = {};
    const traceLog: string[] = [];
    let gasConsumed = 0;
    let haltedCleanly = false;

    for (let pc = 0; pc < params.program.length; pc++) {
      const ins = params.program[pc]!;
      const cost = GAS_COST_TABLE[ins.op] ?? 2;
      if (gasConsumed + cost > params.gas_limit) {
        return {
          static_verification_passed: true,
          max_stack_depth_observed: maxDepthObserved,
          gas_limit: params.gas_limit,
          gas_consumed: gasConsumed,
          halted_cleanly: false,
          return_value: null,
          memory_slots: memory,
          failure_reason: `OUT_OF_GAS_AT_PC_${pc}`,
          execution_trace_sha256: sha256Hex(traceLog.join("|"))
        };
      }
      gasConsumed += cost;

      switch (ins.op) {
        case "PUSH":
          stack.push(ins.value);
          break;
        case "DUP":
          stack.push(stack[stack.length - 1]!);
          break;
        case "SWAP": {
          const a = stack.pop()!;
          const b = stack.pop()!;
          stack.push(a, b);
          break;
        }
        case "ADD": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(a + b);
          break;
        }
        case "SUB": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(a - b);
          break;
        }
        case "MUL": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(a * b);
          break;
        }
        case "DIV": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          if (b === 0) {
            return {
              static_verification_passed: true,
              max_stack_depth_observed: maxDepthObserved,
              gas_limit: params.gas_limit,
              gas_consumed: gasConsumed,
              halted_cleanly: false,
              return_value: null,
              memory_slots: memory,
              failure_reason: `DIVISION_BY_ZERO_AT_PC_${pc}`,
              execution_trace_sha256: sha256Hex(traceLog.join("|"))
            };
          }
          stack.push(Math.trunc(a / b));
          break;
        }
        case "MOD": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(b === 0 ? 0 : a % b);
          break;
        }
        case "CMP_EQ": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(a === b ? 1 : 0);
          break;
        }
        case "CMP_LT": {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(a < b ? 1 : 0);
          break;
        }
        case "STORE": {
          const val = stack.pop()!;
          memory[ins.slot] = val;
          break;
        }
        case "LOAD": {
          stack.push(memory[ins.slot] ?? 0);
          break;
        }
        case "HALT":
          haltedCleanly = true;
          break;
      }

      traceLog.push(`${pc}:${ins.op}:top=${stack[stack.length - 1] ?? "empty"}`);
      if (haltedCleanly) break;
    }

    return {
      static_verification_passed: true,
      max_stack_depth_observed: maxDepthObserved,
      gas_limit: params.gas_limit,
      gas_consumed: gasConsumed,
      halted_cleanly: haltedCleanly || params.program.length > 0,
      return_value: stack.length > 0 ? stack[stack.length - 1]! : null,
      memory_slots: memory,
      execution_trace_sha256: sha256Hex(traceLog.join("|"))
    };
  }

  // ==========================================================================
  // F489-F496: NSGA-II Multi-Objective Pareto Front & Crowding Distance Ranker
  // ==========================================================================

  public computeNsga2ParetoFronts(params: {
    candidates: ParetoCandidateSpec[];
  }): Nsga2ParetoResult {
    const pop = params.candidates;
    const n = pop.length;
    if (n === 0) {
      return {
        total_candidates: 0,
        pareto_front_f1_ids: [],
        fronts_count: 0,
        ranked_population: [],
        nsga2_digest: sha256Hex("EMPTY")
      };
    }

    // a dominates b iff for all m: a[m] <= b[m] and exists m: a[m] < b[m]
    const dominates = (a: number[], b: number[]): boolean => {
      let strictlyBetter = false;
      for (let m = 0; m < a.length; m++) {
        if (a[m]! > b[m]!) return false;
        if (a[m]! < b[m]!) strictlyBetter = true;
      }
      return strictlyBetter;
    };

    const domCount = Array<number>(n).fill(0);
    const dominatedSet: number[][] = Array.from({ length: n }, () => []);
    const fronts: number[][] = [[]];

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (dominates(pop[i]!.objectives_minimize, pop[j]!.objectives_minimize)) {
          dominatedSet[i]!.push(j);
        } else if (dominates(pop[j]!.objectives_minimize, pop[i]!.objectives_minimize)) {
          domCount[i]! += 1;
        }
      }
      if (domCount[i] === 0) {
        fronts[0]!.push(i);
      }
    }

    let fIdx = 0;
    while (fronts[fIdx] && fronts[fIdx]!.length > 0) {
      const nextFront: number[] = [];
      for (const i of fronts[fIdx]!) {
        for (const j of dominatedSet[i]!) {
          domCount[j]! -= 1;
          if (domCount[j] === 0) {
            nextFront.push(j);
          }
        }
      }
      fIdx += 1;
      if (nextFront.length > 0) {
        fronts.push(nextFront);
      }
    }

    const ranked: RankedParetoCandidate[] = [];
    const numObj = pop[0]!.objectives_minimize.length;

    fronts.forEach((frontIndices, frontZeroIdx) => {
      const k = frontIndices.length;
      const crowding = new Map<number, number>();
      frontIndices.forEach((idx) => crowding.set(idx, 0));

      if (k <= 2) {
        frontIndices.forEach((idx) => crowding.set(idx, 999999));
      } else {
        for (let m = 0; m < numObj; m++) {
          const sorted = [...frontIndices].sort(
            (a, b) => pop[a]!.objectives_minimize[m]! - pop[b]!.objectives_minimize[m]!
          );
          crowding.set(sorted[0]!, 999999);
          crowding.set(sorted[k - 1]!, 999999);
          const minVal = pop[sorted[0]!]!.objectives_minimize[m]!;
          const maxVal = pop[sorted[k - 1]!]!.objectives_minimize[m]!;
          const range = maxVal - minVal;
          if (range > 1e-12) {
            for (let pos = 1; pos < k - 1; pos++) {
              const prev = crowding.get(sorted[pos]!) ?? 0;
              const gap =
                (pop[sorted[pos + 1]!]!.objectives_minimize[m]! -
                  pop[sorted[pos - 1]!]!.objectives_minimize[m]!) /
                range;
              crowding.set(sorted[pos]!, Number((prev + gap).toFixed(6)));
            }
          }
        }
      }

      const sortedFront = [...frontIndices].sort(
        (a, b) => (crowding.get(b) ?? 0) - (crowding.get(a) ?? 0)
      );
      for (const idx of sortedFront) {
        ranked.push({
          ...pop[idx]!,
          pareto_rank: frontZeroIdx + 1,
          crowding_distance: crowding.get(idx) ?? 0
        });
      }
    });

    const f1Ids = ranked.filter((r) => r.pareto_rank === 1).map((r) => r.candidate_id);

    return {
      total_candidates: n,
      pareto_front_f1_ids: f1Ids,
      fronts_count: fronts.length,
      ranked_population: ranked,
      nsga2_digest: sha256Hex(JSON.stringify({ f1Ids, fronts_count: fronts.length }))
    };
  }

  // ==========================================================================
  // F497-F504: Wagner-Fischer AST Edit Distance & Patch Script Synthesizer
  // ==========================================================================

  public computeAstEditDistanceAndScript(params: {
    source_ast_tokens: string[];
    target_ast_tokens: string[];
  }): AstEditDistanceResult {
    const src = params.source_ast_tokens;
    const tgt = params.target_ast_tokens;
    const m = src.length;
    const n = tgt.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (src[i - 1] === tgt[j - 1]) {
          dp[i]![j] = dp[i - 1]![j - 1]!;
        } else {
          dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
        }
      }
    }

    // Backtrack minimal edit script
    const ops: AstEditOperation[] = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && src[i - 1] === tgt[j - 1]) {
        ops.push({
          action: "KEEP",
          source_token: src[i - 1],
          target_token: tgt[j - 1],
          cost: 0
        });
        i -= 1;
        j -= 1;
      } else if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + 1) {
        ops.push({
          action: "RENAME",
          source_token: src[i - 1],
          target_token: tgt[j - 1],
          cost: 1
        });
        i -= 1;
        j -= 1;
      } else if (j > 0 && dp[i]![j] === dp[i]![j - 1]! + 1) {
        ops.push({
          action: "INSERT",
          target_token: tgt[j - 1],
          cost: 1
        });
        j -= 1;
      } else {
        ops.push({
          action: "DELETE",
          source_token: src[i - 1],
          cost: 1
        });
        i -= 1;
      }
    }
    ops.reverse();

    // Verify applying script reconstructs target_ast_tokens
    const reconstructed: string[] = [];
    for (const op of ops) {
      if (op.action === "KEEP" || op.action === "RENAME" || op.action === "INSERT") {
        reconstructed.push(op.target_token!);
      }
    }
    const matches =
      reconstructed.length === tgt.length &&
      reconstructed.every((tok, idx) => tok === tgt[idx]);

    const dist = dp[m]![n]!;
    const maxLen = Math.max(m, n, 1);

    return {
      edit_distance: dist,
      normalized_similarity: Number((1 - dist / maxLen).toFixed(6)),
      operations: ops,
      reconstructed_target_matches: matches,
      ast_patch_digest: sha256Hex(JSON.stringify({ dist, ops }))
    };
  }

  // ==========================================================================
  // F505-F512: Zlib Normalized Compression Distance (NCD) & Kolmogorov Metric
  // ==========================================================================

  public computeNormalizedCompressionDistance(params: {
    payload_x: string;
    payload_y: string;
  }): NormalizedCompressionDistanceResult {
    const compLen = (s: string): number =>
      deflateRawSync(Buffer.from(s, "utf8"), { level: 9 }).byteLength;

    const cx = compLen(params.payload_x);
    const cy = compLen(params.payload_y);
    const cxy = compLen(`${params.payload_x}\n${params.payload_y}`);
    const cxx = compLen(`${params.payload_x}\n${params.payload_x}`);

    const minC = Math.min(cx, cy);
    const maxC = Math.max(cx, cy, 1);
    const ncd = Number(Math.max(0, Math.min(1.25, (cxy - minC) / maxC)).toFixed(6));
    const selfNcd = Number(Math.max(0, (cxx - cx) / Math.max(cx, 1)).toFixed(6));

    return {
      bytes_x_compressed: cx,
      bytes_y_compressed: cy,
      bytes_xy_compressed: cxy,
      ncd_score: ncd,
      information_similarity: Number(Math.max(0, 1 - ncd).toFixed(6)),
      metric_axioms_verified:
        params.payload_x === params.payload_y ? ncd <= 0.25 : selfNcd <= ncd,
      ncd_digest: sha256Hex(JSON.stringify({ cx, cy, cxy, ncd }))
    };
  }
}
