/**
 * Stage 14 (F417-F448): Cybernetic Control Theory — Discrete-Time PID Controller with
 * Anti-Windup Clamping, Optimal 1D Kalman State Filter, Spectral Graph Laplacian
 * Algebraic Connectivity (Fiedler Value) & Nemhauser-Wolsey (1 - 1/e) Submodular Greedy Optimizer.
 */

import { createHash } from "node:crypto";

export interface PidControllerConfig {
  kp: number;
  ki: number;
  kd: number;
  setpoint: number;
  integral_min: number;
  integral_max: number;
  output_min: number;
  output_max: number;
}

export interface PidTrajectoryResult {
  final_measurement: number;
  final_error: number;
  clamped_integral_state: number;
  control_outputs: number[];
  anti_windup_triggered: boolean;
  settled_within_tolerance: boolean;
}

export interface KalmanFilterStep {
  step: number;
  noisy_measurement_z: number;
  posterior_estimate_x: number;
  posterior_error_cov_p: number;
  kalman_gain_k: number;
}

export interface KalmanTrajectoryResult {
  initial_estimate: number;
  final_estimate: number;
  initial_covariance_p: number;
  final_covariance_p: number;
  covariance_reduction_ratio: number;
  steps: KalmanFilterStep[];
}

export interface GraphTopologyAnalysis {
  nodes_count: number;
  edges_count: number;
  is_connected: boolean;
  algebraic_connectivity_lambda2: number;
  min_degree: number;
  cheeger_bottleneck_ratio: number;
  topology_digest: string;
}

export interface SubmodularCandidateItem {
  item_id: string;
  cost: number;
  covered_elements: string[];
}

export interface SubmodularGreedyResult {
  selected_item_ids: string[];
  covered_elements_count: number;
  total_universe_size: number;
  coverage_ratio: number;
  diminishing_returns_verified: boolean;
  marginal_gains_sequence: number[];
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class KosmoraCyberneticControlEngine {
  // ==========================================================================
  // F417-F424: Discrete-Time PID Controller with Anti-Windup Clamping
  // ==========================================================================

  public simulateDiscretePidControlLoop(params: {
    config: PidControllerConfig;
    initial_measurement: number;
    plant_gain: number;
    steps: number;
    dt_sec?: number;
  }): PidTrajectoryResult {
    const { config, plant_gain, steps } = params;
    const dt = params.dt_sec ?? 1.0;

    let measurement = params.initial_measurement;
    let integral = 0;
    let prevError = config.setpoint - measurement;
    let antiWindupTriggered = false;
    const outputs: number[] = [];

    for (let t = 0; t < steps; t++) {
      const error = config.setpoint - measurement;
      const rawIntegral = integral + error * dt;
      if (rawIntegral > config.integral_max || rawIntegral < config.integral_min) {
        antiWindupTriggered = true;
      }
      integral = Math.max(config.integral_min, Math.min(config.integral_max, rawIntegral));

      const derivative = t === 0 ? 0 : (error - prevError) / dt;
      prevError = error;

      const rawOutput = config.kp * error + config.ki * integral + config.kd * derivative;
      const clampedOutput = Math.max(config.output_min, Math.min(config.output_max, rawOutput));
      outputs.push(Number(clampedOutput.toFixed(4)));

      // Plant dynamics response: y_{t+1} = y_t + plant_gain * u_t * dt
      measurement = measurement + plant_gain * clampedOutput * dt;
    }

    const finalError = Number((config.setpoint - measurement).toFixed(6));
    return {
      final_measurement: Number(measurement.toFixed(6)),
      final_error: finalError,
      clamped_integral_state: Number(integral.toFixed(6)),
      control_outputs: outputs,
      anti_windup_triggered: antiWindupTriggered,
      settled_within_tolerance: Math.abs(finalError) < Math.abs(config.setpoint - params.initial_measurement) * 0.15
    };
  }

  // ==========================================================================
  // F425-F432: Optimal 1D Discrete Kalman Filter State Estimator
  // ==========================================================================

  public runKalmanFilterEstimation(params: {
    initial_estimate_x0: number;
    initial_covariance_p0: number;
    process_noise_q: number;
    measurement_noise_r: number;
    measurements_z: number[];
  }): KalmanTrajectoryResult {
    let x = params.initial_estimate_x0;
    let p = params.initial_covariance_p0;
    const q = Math.max(1e-9, params.process_noise_q);
    const r = Math.max(1e-6, params.measurement_noise_r);
    const steps: KalmanFilterStep[] = [];

    for (let i = 0; i < params.measurements_z.length; i++) {
      const z = params.measurements_z[i]!;
      // 1. Predict step: x_{k|k-1} = x_{k-1|k-1}, P_{k|k-1} = P_{k-1|k-1} + Q
      const xPred = x;
      const pPred = p + q;

      // 2. Update step: K_k = P_{k|k-1} / (P_{k|k-1} + R)
      const kGain = pPred / (pPred + r);
      x = xPred + kGain * (z - xPred);
      p = (1 - kGain) * pPred;

      steps.push({
        step: i + 1,
        noisy_measurement_z: z,
        posterior_estimate_x: Number(x.toFixed(6)),
        posterior_error_cov_p: Number(p.toFixed(6)),
        kalman_gain_k: Number(kGain.toFixed(6))
      });
    }

    const ratio =
      params.initial_covariance_p0 > 0
        ? Number((1 - p / params.initial_covariance_p0).toFixed(6))
        : 0;

    return {
      initial_estimate: params.initial_estimate_x0,
      final_estimate: Number(x.toFixed(6)),
      initial_covariance_p: params.initial_covariance_p0,
      final_covariance_p: Number(p.toFixed(6)),
      covariance_reduction_ratio: ratio,
      steps
    };
  }

  // ==========================================================================
  // F433-F440: Graph Laplacian Algebraic Connectivity (Fiedler Value)
  // ==========================================================================

  public analyzeGraphLaplacianConnectivity(params: {
    nodes: string[];
    undirected_edges: Array<[string, string]>;
  }): GraphTopologyAnalysis {
    const n = params.nodes.length;
    if (n === 0) {
      throw new Error("Graph topology requires at least 1 node.");
    }
    const idxMap = new Map<string, number>();
    params.nodes.forEach((id, idx) => idxMap.set(id, idx));

    const adj: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const degrees = Array<number>(n).fill(0);

    for (const [u, v] of params.undirected_edges) {
      const i = idxMap.get(u);
      const j = idxMap.get(v);
      if (i !== undefined && j !== undefined && i !== j && adj[i]![j] === 0) {
        adj[i]![j] = 1;
        adj[j]![i] = 1;
        degrees[i] += 1;
        degrees[j] += 1;
      }
    }

    // BFS Connectivity check
    const visited = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (let nb = 0; nb < n; nb++) {
        if (adj[cur]![nb] === 1 && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    const isConnected = visited.size === n;

    // Estimate Fiedler value lambda_2 (smallest non-zero eigenvalue of L = D - A)
    // Using Rayleigh quotient on deflated vector orthogonal to [1, 1, ..., 1]
    let lambda2 = 0;
    if (isConnected && n > 1) {
      const maxDeg = Math.max(...degrees, 1);
      const shiftM = 2 * maxDeg;
      // Power iteration on M*I - L orthogonal to constant vector 1
      let vec = params.nodes.map((_, i) => (i % 2 === 0 ? 1.0 : -1.0));
      const projectOutOnes = (v: number[]) => {
        const mean = v.reduce((a, b) => a + b, 0) / n;
        const centered = v.map((x) => x - mean);
        const norm = Math.sqrt(centered.reduce((acc, x) => acc + x * x, 0)) || 1;
        return centered.map((x) => x / norm);
      };
      vec = projectOutOnes(vec);

      const multiplyLaplacian = (v: number[]): number[] => {
        const out = Array<number>(n).fill(0);
        for (let i = 0; i < n; i++) {
          let sum = degrees[i]! * v[i]!;
          for (let j = 0; j < n; j++) {
            if (adj[i]![j] === 1) sum -= v[j]!;
          }
          out[i] = sum;
        }
        return out;
      };

      for (let iter = 0; iter < 40; iter++) {
        const lv = multiplyLaplacian(vec);
        const shifted = vec.map((vi, i) => shiftM * vi - lv[i]!);
        vec = projectOutOnes(shifted);
      }
      const lvFinal = multiplyLaplacian(vec);
      const rayleigh = vec.reduce((acc, vi, i) => acc + vi * lvFinal[i]!, 0);
      lambda2 = Number(Math.max(0.0001, rayleigh).toFixed(6));
    }

    // Cheeger cut ratio across half-split
    const half = Math.max(1, Math.floor(n / 2));
    let cutEdges = 0;
    for (let i = 0; i < half; i++) {
      for (let j = half; j < n; j++) {
        if (adj[i]![j] === 1) cutEdges += 1;
      }
    }
    const cheeger = Number((cutEdges / half).toFixed(6));

    return {
      nodes_count: n,
      edges_count: params.undirected_edges.length,
      is_connected: isConnected,
      algebraic_connectivity_lambda2: lambda2,
      min_degree: Math.min(...degrees),
      cheeger_bottleneck_ratio: cheeger,
      topology_digest: sha256Hex(JSON.stringify({ n, degrees, lambda2 }))
    };
  }

  // ==========================================================================
  // F441-F448: Nemhauser-Wolsey (1 - 1/e) Submodular Greedy Coverage Maximizer
  // ==========================================================================

  public maximizeSubmodularCoverageGreedy(params: {
    universe_elements: string[];
    candidates: SubmodularCandidateItem[];
    max_picks_k: number;
  }): SubmodularGreedyResult {
    const universe = new Set(params.universe_elements);
    const covered = new Set<string>();
    const selected: string[] = [];
    const marginalGains: number[] = [];
    const remaining = [...params.candidates];

    const k = Math.max(1, Math.min(params.max_picks_k, remaining.length));

    for (let step = 0; step < k; step++) {
      let bestIdx = -1;
      let bestGain = -1;

      for (let i = 0; i < remaining.length; i++) {
        const item = remaining[i]!;
        let gain = 0;
        for (const el of item.covered_elements) {
          if (universe.has(el) && !covered.has(el)) {
            gain += 1;
          }
        }
        if (gain > bestGain) {
          bestGain = gain;
          bestIdx = i;
        }
      }

      if (bestIdx === -1 || bestGain <= 0) break;
      const chosen = remaining.splice(bestIdx, 1)[0]!;
      selected.push(chosen.item_id);
      marginalGains.push(bestGain);
      for (const el of chosen.covered_elements) {
        if (universe.has(el)) covered.add(el);
      }
    }

    // Verify diminishing marginal returns: gain[t] >= gain[t+1]
    let diminishingVerified = true;
    for (let i = 1; i < marginalGains.length; i++) {
      if (marginalGains[i]! > marginalGains[i - 1]!) {
        diminishingVerified = false;
      }
    }

    return {
      selected_item_ids: selected,
      covered_elements_count: covered.size,
      total_universe_size: universe.size,
      coverage_ratio:
        universe.size > 0 ? Number((covered.size / universe.size).toFixed(4)) : 1,
      diminishing_returns_verified: diminishingVerified,
      marginal_gains_sequence: marginalGains
    };
  }
}
