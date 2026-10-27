/**
 * Stage 7 (F193-F224): Formal Verification, Bounded Model Checking, Resource CSP Solver,
 * W3C TraceContext Critical-Path Telemetry, Deterministic Replay Cassettes & Dataflow Taint Analysis.
 */

import { createHash } from "node:crypto";

export interface FiniteStateMachineSpec {
  machine_id: string;
  initial_state: string;
  states: string[];
  transitions: Array<{
    from: string;
    to: string;
    action: string;
    guard_label?: string;
  }>;
  accepting_states: string[];
  forbidden_states: string[];
}

export interface ModelCheckVerificationReport {
  machine_id: string;
  verified_safe: boolean;
  reachable_states: string[];
  unreachable_states: string[];
  deadlock_states: string[];
  forbidden_reached: Array<{
    state: string;
    counterexample_trace: string[];
  }>;
  liveness_satisfied: boolean;
  state_space_digest: string;
}

export interface ResourceTaskDemand {
  task_id: string;
  cpu_cores: number;
  memory_gb: number;
  cost_usd: number;
  anti_affinity_task_ids?: string[];
}

export interface WorkerHostCapacity {
  host_id: string;
  max_cpu_cores: number;
  max_memory_gb: number;
  cost_multiplier: number;
}

export interface CspScheduleSolution {
  feasible: boolean;
  assignments: Record<string, string>;
  total_estimated_cost_usd: number;
  host_utilization: Array<{
    host_id: string;
    used_cpu_cores: number;
    used_memory_gb: number;
    assigned_tasks: string[];
  }>;
  solver_backtracks: number;
}

export interface DistributedTraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  operation_name: string;
  service_name: string;
  start_ms: number;
  end_ms: number;
  attributes: Record<string, string | number | boolean>;
}

export interface CriticalPathAnalysisResult {
  trace_id: string;
  total_duration_ms: number;
  critical_path_span_ids: string[];
  bottleneck_span_id: string;
  bottleneck_self_time_ms: number;
  span_self_times: Record<string, number>;
}

export interface ReplayCassetteFrame {
  step_index: number;
  boundary_kind: "tool_io" | "clock_tick" | "rng_seed" | "model_completion";
  input_canonical: string;
  recorded_output: string;
  frame_sha256: string;
}

export interface ExecutionCassetteRecord {
  cassette_id: string;
  plan_id: string;
  frames: ReplayCassetteFrame[];
  cassette_seal_sha256: string;
}

export interface DataflowTaintFinding {
  variable_chain: string[];
  source_expr: string;
  sink_expr: string;
  line_number: number;
  sanitized: boolean;
  severity: "critical" | "high" | "none";
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class KosmoraFormalVerificationEngine {
  private readonly cassettes = new Map<string, ExecutionCassetteRecord>();

  // ==========================================================================
  // F193-F198: Bounded Model Checker & Finite State Machine Invariant Verifier
  // ==========================================================================

  public verifyStateMachineInvariants(spec: FiniteStateMachineSpec): ModelCheckVerificationReport {
    if (!spec.states.includes(spec.initial_state)) {
      throw new Error(`Initial state '${spec.initial_state}' is not declared in states list.`);
    }

    const outgoing = new Map<string, Array<{ to: string; action: string }>>();
    for (const s of spec.states) {
      outgoing.set(s, []);
    }
    for (const tr of spec.transitions) {
      if (!outgoing.has(tr.from) || !spec.states.includes(tr.to)) {
        throw new Error(`Invalid transition ${tr.from} -> ${tr.to}`);
      }
      outgoing.get(tr.from)!.push({ to: tr.to, action: tr.action });
    }

    const visited = new Set<string>([spec.initial_state]);
    const traceMap = new Map<string, string[]>([[spec.initial_state, [spec.initial_state]]]);
    const queue: string[] = [spec.initial_state];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const pathSoFar = traceMap.get(current) ?? [current];
      for (const edge of outgoing.get(current) ?? []) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          traceMap.set(edge.to, [...pathSoFar, `${edge.action}->${edge.to}`]);
          queue.push(edge.to);
        }
      }
    }

    const reachableStates = Array.from(visited);
    const unreachableStates = spec.states.filter((s) => !visited.has(s));
    const acceptingSet = new Set(spec.accepting_states);
    const forbiddenSet = new Set(spec.forbidden_states);

    const deadlockStates: string[] = [];
    const forbiddenReached: Array<{ state: string; counterexample_trace: string[] }> = [];

    for (const s of reachableStates) {
      const outs = outgoing.get(s) ?? [];
      if (outs.length === 0 && !acceptingSet.has(s)) {
        deadlockStates.push(s);
      }
      if (forbiddenSet.has(s)) {
        forbiddenReached.push({
          state: s,
          counterexample_trace: traceMap.get(s) ?? [s]
        });
      }
    }

    // Universal eventual acceptance: a reachable accepting branch alone is insufficient.
    const terminating = new Set(spec.accepting_states);
    let changed = true;
    while (changed) {
      changed = false;
      for (const state of reachableStates) {
        const edges = outgoing.get(state) ?? [];
        if (
          !terminating.has(state) &&
          edges.length > 0 &&
          edges.every((edge) => terminating.has(edge.to))
        ) {
          terminating.add(state);
          changed = true;
        }
      }
    }
    const livenessSatisfied = terminating.has(spec.initial_state);
    const verifiedSafe =
      deadlockStates.length === 0 && forbiddenReached.length === 0 && livenessSatisfied;

    return {
      machine_id: spec.machine_id,
      verified_safe: verifiedSafe,
      reachable_states: reachableStates,
      unreachable_states: unreachableStates,
      deadlock_states: deadlockStates,
      forbidden_reached: forbiddenReached,
      liveness_satisfied: livenessSatisfied,
      state_space_digest: sha256Hex(
        JSON.stringify({
          machine_id: spec.machine_id,
          reachableStates,
          deadlockStates,
          forbiddenReached
        })
      )
    };
  }

  // ==========================================================================
  // F199-F204: Backtracking CSP Resource & Anti-Affinity Constraint Solver
  // ==========================================================================

  public solveResourceAllocationConstraints(
    tasks: ResourceTaskDemand[],
    hosts: WorkerHostCapacity[]
  ): CspScheduleSolution {
    const orderedTasks = [...tasks].sort(
      (a, b) => b.cpu_cores + b.memory_gb - (a.cpu_cores + a.memory_gb)
    );
    const orderedHosts = [...hosts].sort((a, b) => a.cost_multiplier - b.cost_multiplier);

    const usedCpu = new Map<string, number>();
    const usedMem = new Map<string, number>();
    const hostTasks = new Map<string, Set<string>>();
    for (const h of orderedHosts) {
      usedCpu.set(h.host_id, 0);
      usedMem.set(h.host_id, 0);
      hostTasks.set(h.host_id, new Set());
    }

    const assignments: Record<string, string> = {};
    let backtracks = 0;

    const solveStep = (idx: number): boolean => {
      if (idx >= orderedTasks.length) {
        return true;
      }
      const task = orderedTasks[idx]!;
      for (const host of orderedHosts) {
        const curCpu = usedCpu.get(host.host_id)!;
        const curMem = usedMem.get(host.host_id)!;
        if (
          curCpu + task.cpu_cores > host.max_cpu_cores ||
          curMem + task.memory_gb > host.max_memory_gb
        ) {
          continue;
        }
        const assignedOnHost = hostTasks.get(host.host_id)!;
        const conflict = (task.anti_affinity_task_ids ?? []).some((otherId) =>
          assignedOnHost.has(otherId)
        );
        if (conflict) {
          continue;
        }

        // Tentatively assign
        usedCpu.set(host.host_id, curCpu + task.cpu_cores);
        usedMem.set(host.host_id, curMem + task.memory_gb);
        assignedOnHost.add(task.task_id);
        assignments[task.task_id] = host.host_id;

        if (solveStep(idx + 1)) {
          return true;
        }

        // Backtrack
        backtracks += 1;
        usedCpu.set(host.host_id, curCpu);
        usedMem.set(host.host_id, curMem);
        assignedOnHost.delete(task.task_id);
        delete assignments[task.task_id];
      }
      return false;
    };

    const feasible = solveStep(0);
    let totalCost = 0;
    if (feasible) {
      for (const t of tasks) {
        const hostId = assignments[t.task_id];
        const host = hosts.find((h) => h.host_id === hostId);
        totalCost += t.cost_usd * (host?.cost_multiplier ?? 1);
      }
    }

    return {
      feasible,
      assignments: feasible ? assignments : {},
      total_estimated_cost_usd: Number(totalCost.toFixed(4)),
      host_utilization: orderedHosts.map((h) => ({
        host_id: h.host_id,
        used_cpu_cores: usedCpu.get(h.host_id) ?? 0,
        used_memory_gb: usedMem.get(h.host_id) ?? 0,
        assigned_tasks: Array.from(hostTasks.get(h.host_id) ?? [])
      })),
      solver_backtracks: backtracks
    };
  }

  // ==========================================================================
  // F205-F210: W3C TraceContext Propagation & Critical-Path Bottleneck Analyzer
  // ==========================================================================

  public parseAndPropagateW3cTraceContext(
    traceparentHeader: string,
    newSpanSeed: string
  ): {
    version: "00";
    trace_id: string;
    parent_span_id: string;
    child_span_id: string;
    trace_flags: string;
    child_traceparent: string;
  } {
    const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
      traceparentHeader.trim()
    );
    if (!match) {
      throw new Error(`Invalid W3C traceparent header: '${traceparentHeader}'`);
    }
    const traceId = match[1]!.toLowerCase();
    const parentSpanId = match[2]!.toLowerCase();
    const flags = match[3]!.toLowerCase();

    if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) {
      throw new Error("W3C traceparent forbids all-zero trace_id or span_id.");
    }

    const childSpanId = sha256Hex(`${traceId}:${parentSpanId}:${newSpanSeed}`).slice(0, 16);
    return {
      version: "00",
      trace_id: traceId,
      parent_span_id: parentSpanId,
      child_span_id: childSpanId,
      trace_flags: flags,
      child_traceparent: `00-${traceId}-${childSpanId}-${flags}`
    };
  }

  public analyzeDistributedTraceCriticalPath(
    spans: DistributedTraceSpan[]
  ): CriticalPathAnalysisResult {
    if (spans.length === 0) {
      throw new Error("Cannot analyze empty trace span list.");
    }
    const traceId = spans[0]!.trace_id;
    const childrenByParent = new Map<string, DistributedTraceSpan[]>();
    for (const s of spans) {
      if (s.parent_span_id) {
        const list = childrenByParent.get(s.parent_span_id) ?? [];
        list.push(s);
        childrenByParent.set(s.parent_span_id, list);
      }
    }

    const selfTimes: Record<string, number> = {};
    let bottleneckId = spans[0]!.span_id;
    let maxSelfTime = -1;

    for (const s of spans) {
      const totalSpanMs = Math.max(0, s.end_ms - s.start_ms);
      const childSpans = childrenByParent.get(s.span_id) ?? [];
      const childrenDuration = childSpans.reduce(
        (acc, c) => acc + Math.max(0, c.end_ms - c.start_ms),
        0
      );
      const selfMs = Math.max(0, totalSpanMs - childrenDuration);
      selfTimes[s.span_id] = selfMs;
      if (selfMs > maxSelfTime) {
        maxSelfTime = selfMs;
        bottleneckId = s.span_id;
      }
    }

    const minStart = Math.min(...spans.map((s) => s.start_ms));
    const maxEnd = Math.max(...spans.map((s) => s.end_ms));

    // Trace longest duration path from root
    const roots = spans.filter((s) => s.parent_span_id === null);
    const buildLongestChain = (span: DistributedTraceSpan): string[] => {
      const kids = childrenByParent.get(span.span_id) ?? [];
      if (kids.length === 0) return [span.span_id];
      let bestKidChain: string[] = [];
      let bestKidDuration = -1;
      for (const k of kids) {
        const d = k.end_ms - k.start_ms;
        if (d > bestKidDuration) {
          bestKidDuration = d;
          bestKidChain = buildLongestChain(k);
        }
      }
      return [span.span_id, ...bestKidChain];
    };

    const criticalPath =
      roots.length > 0 ? buildLongestChain(roots[0]!) : spans.map((s) => s.span_id);

    return {
      trace_id: traceId,
      total_duration_ms: Math.max(0, maxEnd - minStart),
      critical_path_span_ids: criticalPath,
      bottleneck_span_id: bottleneckId,
      bottleneck_self_time_ms: maxSelfTime,
      span_self_times: selfTimes
    };
  }

  // ==========================================================================
  // F211-F216: Deterministic Execution Cassette Recorder & Bit-Exact Replay
  // ==========================================================================

  public recordExecutionCassette(params: {
    cassette_id: string;
    plan_id: string;
    interactions: Array<{
      boundary_kind: ReplayCassetteFrame["boundary_kind"];
      input_canonical: string;
      recorded_output: string;
    }>;
  }): ExecutionCassetteRecord {
    const frames: ReplayCassetteFrame[] = params.interactions.map((item, idx) => {
      const frameHash = sha256Hex(
        `${idx}|${item.boundary_kind}|${item.input_canonical}|${item.recorded_output}`
      );
      return {
        step_index: idx,
        boundary_kind: item.boundary_kind,
        input_canonical: item.input_canonical,
        recorded_output: item.recorded_output,
        frame_sha256: frameHash
      };
    });

    const seal = sha256Hex(
      `${params.cassette_id}|${params.plan_id}|${frames.map((f) => f.frame_sha256).join(",")}`
    );
    const record: ExecutionCassetteRecord = Object.freeze({
      cassette_id: params.cassette_id,
      plan_id: params.plan_id,
      frames,
      cassette_seal_sha256: seal
    });
    this.cassettes.set(record.cassette_id, record);
    return record;
  }

  public replayExecutionCassette(
    cassetteId: string,
    candidateInputs: Array<{
      boundary_kind: ReplayCassetteFrame["boundary_kind"];
      input_canonical: string;
    }>
  ): {
    deterministic_match: boolean;
    replayed_outputs: string[];
    divergence_step: number | null;
    reason: string;
  } {
    const cassette = this.cassettes.get(cassetteId);
    if (!cassette) {
      throw new Error(`Execution cassette '${cassetteId}' not found.`);
    }
    if (candidateInputs.length !== cassette.frames.length) {
      return {
        deterministic_match: false,
        replayed_outputs: [],
        divergence_step: Math.min(candidateInputs.length, cassette.frames.length),
        reason: `Frame count mismatch: expected ${cassette.frames.length}, got ${candidateInputs.length}`
      };
    }

    const outputs: string[] = [];
    for (let i = 0; i < cassette.frames.length; i++) {
      const frame = cassette.frames[i]!;
      const cand = candidateInputs[i]!;
      if (
        frame.boundary_kind !== cand.boundary_kind ||
        frame.input_canonical !== cand.input_canonical
      ) {
        return {
          deterministic_match: false,
          replayed_outputs: outputs,
          divergence_step: i,
          reason: `Non-deterministic divergence at step ${i}: expected (${frame.boundary_kind}: ${frame.input_canonical}), got (${cand.boundary_kind}: ${cand.input_canonical})`
        };
      }
      outputs.push(frame.recorded_output);
    }

    return {
      deterministic_match: true,
      replayed_outputs: outputs,
      divergence_step: null,
      reason: "Bit-exact deterministic replay verified."
    };
  }

  // ==========================================================================
  // F217-F224: Static Dataflow Taint & Sink Security Analyzer
  // ==========================================================================

  public analyzeCodeDataflowTaint(sourceCode: string): {
    safe: boolean;
    findings: DataflowTaintFinding[];
    tainted_variables: string[];
  } {
    const lines = sourceCode.split("\n");
    const taintedVars = new Map<string, { source: string; chain: string[]; sanitized: boolean }>();
    const findings: DataflowTaintFinding[] = [];

    const sourcePattern = /\b(req\.body|req\.query|untrustedInput|externalWebhookPayload)\b/;
    const sanitizerPattern = /\b(redactPii|escapeSql|sanitizeInput|verifySignature)\s*\(/;
    const sinkPattern = /\b(eval|execSync|spawnSync|db\.exec|rawSqlQuery)\s*\(([^)]+)\)/;

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      const assignMatch = /^(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(.+?);?$/.exec(line);
      if (assignMatch) {
        const varName = assignMatch[1]!;
        const rhs = assignMatch[2]!;
        const isSanitized = sanitizerPattern.test(rhs);

        if (sourcePattern.test(rhs)) {
          taintedVars.set(varName, {
            source: rhs,
            chain: [varName],
            sanitized: isSanitized
          });
        } else {
          for (const [existingVar, info] of taintedVars.entries()) {
            const varRegex = new RegExp(`\\b${existingVar}\\b`);
            if (varRegex.test(rhs)) {
              taintedVars.set(varName, {
                source: info.source,
                chain: [...info.chain, varName],
                sanitized: info.sanitized || isSanitized
              });
            }
          }
        }
      }

      const sinkMatch = sinkPattern.exec(line);
      if (sinkMatch) {
        const sinkFn = sinkMatch[1]!;
        const sinkArg = sinkMatch[2]!;
        for (const [tVar, info] of taintedVars.entries()) {
          if (new RegExp(`\\b${tVar}\\b`).test(sinkArg)) {
            findings.push({
              variable_chain: info.chain,
              source_expr: info.source,
              sink_expr: `${sinkFn}(${sinkArg})`,
              line_number: idx + 1,
              sanitized: info.sanitized,
              severity: info.sanitized ? "none" : "critical"
            });
          }
        }
      }
    });

    const unsafeFindings = findings.filter((f) => !f.sanitized);
    return {
      safe: unsafeFindings.length === 0,
      findings,
      tainted_variables: Array.from(taintedVars.keys())
    };
  }
}
