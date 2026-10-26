/**
 * Stage 11 (F321-F352): Causal Inference, Pearl's do-Calculus Structural Causal Models (SCM),
 * 3-Step Counterfactual Abduction-Action-Prediction, Exact Bayesian Belief Network
 * Posterior Propagation & Beta-Bernoulli Conjugate Thompson Sampling Engine.
 */

import { createHash } from "node:crypto";

export interface CausalEdgeSpec {
  from: string;
  to: string;
  weight: number;
}

export interface StructuralCausalModelSpec {
  variables: string[]; // Topological or arbitrary order (engine topologically sorts)
  edges: CausalEdgeSpec[];
  exogenous_means: Record<string, number>;
}

export interface CausalInterventionResult {
  treatment_var: string;
  outcome_var: string;
  do_value: number;
   baseline_do_zero_value: number;
  observational_outcome: number;
  interventional_outcome_do_v: number;
  interventional_outcome_do_0: number;
  average_causal_effect: number;
  confounding_bias: number;
  backdoor_confounders: string[];
  causal_digest: string;
}

export interface CounterfactualResult {
  observed_evidence: Record<string, number>;
  abducted_exogenous_noise: Record<string, number>;
  intervention_var: string;
  intervention_value: number;
  outcome_var: string;
  factual_outcome: number;
  counterfactual_outcome: number;
  individual_treatment_effect: number;
  counterfactual_digest: string;
}

export interface BayesianHypothesisPrior {
  hypothesis_id: string;
  prior_probability: number;
  likelihood_given_evidence: Record<string, number>; // evidence_key -> P(E=true | H)
}

export interface BayesianPosteriorResult {
  posteriors: Record<string, number>;
  map_hypothesis_id: string;
  map_probability: number;
  prior_entropy_bits: number;
  posterior_entropy_bits: number;
  information_gain_bits: number;
}

export interface ThompsonArmSpec {
  arm_id: string;
  alpha_successes: number;
  beta_failures: number;
}

export interface ThompsonSamplingDecision {
  selected_arm_id: string;
  sampled_theta_scores: Record<string, number>;
  posterior_means: Record<string, number>;
  credible_intervals_95: Record<string, [number, number]>;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function shannonEntropyBits(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 1e-12) {
      h -= p * Math.log2(p);
    }
  }
  return Number(h.toFixed(6));
}

export class KosmoraCausalBayesianEngine {
  // ==========================================================================
  // F321-F328: Structural Causal Model (SCM) & Pearl's do(X = v) Calculus
  // ==========================================================================

  public evaluateStructuralCausalIntervention(params: {
    model: StructuralCausalModelSpec;
    treatment_var: string;
    outcome_var: string;
    do_value: number;
    baseline_value?: number;
  }): CausalInterventionResult {
    const { model, treatment_var, outcome_var, do_value } = params;
    const baselineVal = params.baseline_value ?? 0;
    const topo = this.topologicalSort(model.variables, model.edges);

    // 1. Evaluate observational expectations E[X]
    const obsValues = this.forwardPropagateScm(topo, model.edges, model.exogenous_means);

    // 2. Evaluate interventional E[Y | do(T = do_value)] (sever incoming edges into T)
    const doVValues = this.forwardPropagateScm(topo, model.edges, model.exogenous_means, {
      [treatment_var]: do_value
    });

    // 3. Evaluate interventional E[Y | do(T = baselineVal)]
    const doZeroValues = this.forwardPropagateScm(topo, model.edges, model.exogenous_means, {
      [treatment_var]: baselineVal
    });

    // 4. Identify backdoor confounders (common ancestors of both treatment_var and outcome_var)
    const treatmentAncestors = this.findAncestors(treatment_var, model.edges);
    const outcomeAncestors = this.findAncestors(outcome_var, model.edges);
    const confounders = [...treatmentAncestors].filter((a) => outcomeAncestors.has(a));

    // Compute observational association slope vs causal effect
    const parentWeightSumOnTreatment = model.edges
      .filter((e) => e.to === treatment_var && confounders.includes(e.from))
      .reduce((acc, e) => acc + e.weight * (obsValues[e.from] ?? 0), 0);

    const acePerUnit =
      do_value !== baselineVal
        ? (doVValues[outcome_var]! - doZeroValues[outcome_var]!) / (do_value - baselineVal)
        : 0;
    const ace = Number((doVValues[outcome_var]! - doZeroValues[outcome_var]!).toFixed(6));
    const confoundingBias = Number((parentWeightSumOnTreatment * (acePerUnit || 1)).toFixed(6));

    return {
      treatment_var,
      outcome_var,
      do_value,
      baseline_do_zero_value: baselineVal,
      observational_outcome: Number(obsValues[outcome_var]!.toFixed(6)),
      interventional_outcome_do_v: Number(doVValues[outcome_var]!.toFixed(6)),
      interventional_outcome_do_0: Number(doZeroValues[outcome_var]!.toFixed(6)),
      average_causal_effect: ace,
      confounding_bias: confoundingBias,
      backdoor_confounders: confounders,
      causal_digest: sha256Hex(
        JSON.stringify({ treatment_var, outcome_var, ace, confounders })
      )
    };
  }

  // ==========================================================================
  // F329-F336: 3-Step Counterfactual Calculus (Abduction -> Action -> Prediction)
  // ==========================================================================

  public computeCounterfactualTrajectory(params: {
    model: StructuralCausalModelSpec;
    observed_evidence: Record<string, number>;
    intervention_var: string;
    intervention_value: number;
    outcome_var: string;
  }): CounterfactualResult {
    const { model, observed_evidence, intervention_var, intervention_value, outcome_var } = params;
    const topo = this.topologicalSort(model.variables, model.edges);

    // Step 1 (Abduction): Infer structural exogenous noise U_i = X_i - sum_{p in pa(i)} w_{p->i} * X_p
    const fullFactual: Record<string, number> = {};
    for (const v of topo) {
      if (observed_evidence[v] !== undefined) {
        fullFactual[v] = observed_evidence[v]!;
      } else {
        const parentSum = model.edges
          .filter((e) => e.to === v)
          .reduce((acc, e) => acc + e.weight * (fullFactual[e.from] ?? 0), 0);
        fullFactual[v] = (model.exogenous_means[v] ?? 0) + parentSum;
      }
    }

    const abductedU: Record<string, number> = {};
    for (const v of topo) {
      const parentSum = model.edges
        .filter((e) => e.to === v)
        .reduce((acc, e) => acc + e.weight * (fullFactual[e.from] ?? 0), 0);
      abductedU[v] = Number((fullFactual[v]! - parentSum).toFixed(6));
    }

    // Step 2 (Action) & Step 3 (Prediction): Apply do(intervention_var = intervention_value) with abductedU
    const cfValues = this.forwardPropagateScm(topo, model.edges, abductedU, {
      [intervention_var]: intervention_value
    });

    const factualOutcome = Number(fullFactual[outcome_var]!.toFixed(6));
    const counterfactualOutcome = Number(cfValues[outcome_var]!.toFixed(6));
    const ite = Number((counterfactualOutcome - factualOutcome).toFixed(6));

    return {
      observed_evidence,
      abducted_exogenous_noise: abductedU,
      intervention_var,
      intervention_value,
      outcome_var,
      factual_outcome: factualOutcome,
      counterfactual_outcome: counterfactualOutcome,
      individual_treatment_effect: ite,
      counterfactual_digest: sha256Hex(
        JSON.stringify({ abductedU, intervention_var, intervention_value, counterfactualOutcome })
      )
    };
  }

  // ==========================================================================
  // F337-F344: Exact Bayesian Belief Network Posterior Propagation
  // ==========================================================================

  public updateBayesianBeliefNetwork(params: {
    hypotheses: BayesianHypothesisPrior[];
    observed_evidence: Record<string, boolean>;
  }): BayesianPosteriorResult {
    const { hypotheses, observed_evidence } = params;
    if (hypotheses.length === 0) {
      throw new Error("Bayesian belief update requires at least 1 hypothesis.");
    }

    const priorSum = hypotheses.reduce((acc, h) => acc + h.prior_probability, 0);
    if (priorSum <= 0) {
      throw new Error("Sum of prior probabilities must be positive.");
    }

    const normalizedPriors = hypotheses.map((h) => h.prior_probability / priorSum);
    const priorEntropy = shannonEntropyBits(normalizedPriors);

    const unnormalizedPosteriors: number[] = [];
    for (let i = 0; i < hypotheses.length; i++) {
      const h = hypotheses[i]!;
      let likelihood = 1.0;
      for (const [evKey, evObserved] of Object.entries(observed_evidence)) {
        const pTrueGivenH = Math.max(1e-6, Math.min(1 - 1e-6, h.likelihood_given_evidence[evKey] ?? 0.5));
        likelihood *= evObserved ? pTrueGivenH : 1 - pTrueGivenH;
      }
      unnormalizedPosteriors.push(normalizedPriors[i]! * likelihood);
    }

    const evidenceMarginal = unnormalizedPosteriors.reduce((a, b) => a + b, 0) || 1e-12;
    const posteriorsMap: Record<string, number> = {};
    const posteriorProbs: number[] = [];
    let bestId = hypotheses[0]!.hypothesis_id;
    let bestProb = -1;

    for (let i = 0; i < hypotheses.length; i++) {
      const id = hypotheses[i]!.hypothesis_id;
      const post = Number((unnormalizedPosteriors[i]! / evidenceMarginal).toFixed(6));
      posteriorsMap[id] = post;
      posteriorProbs.push(post);
      if (post > bestProb) {
        bestProb = post;
        bestId = id;
      }
    }

    const postEntropy = shannonEntropyBits(posteriorProbs);
    return {
      posteriors: posteriorsMap,
      map_hypothesis_id: bestId,
      map_probability: bestProb,
      prior_entropy_bits: priorEntropy,
      posterior_entropy_bits: postEntropy,
      information_gain_bits: Number(Math.max(0, priorEntropy - postEntropy).toFixed(6))
    };
  }

  // ==========================================================================
  // F345-F352: Beta-Bernoulli Conjugate Thompson Sampling Bandit
  // ==========================================================================

  public sampleThompsonBetaPosterior(params: {
    arms: ThompsonArmSpec[];
    deterministic_seed: string;
  }): ThompsonSamplingDecision {
    if (params.arms.length === 0) {
      throw new Error("Thompson sampling requires at least 1 arm.");
    }

    const sampledScores: Record<string, number> = {};
    const means: Record<string, number> = {};
    const intervals: Record<string, [number, number]> = {};
    let bestArm = params.arms[0]!.arm_id;
    let bestSample = -1;

    for (const arm of params.arms) {
      const a = Math.max(1, arm.alpha_successes);
      const b = Math.max(1, arm.beta_failures);
      const mean = a / (a + b);
      const variance = (a * b) / (Math.pow(a + b, 2) * (a + b + 1));
      const stdDev = Math.sqrt(variance);

      // Deterministic Box-Muller normal approximation to Beta(a, b) seeded by arm_id + seed
      const h1 = parseInt(sha256Hex(`${params.deterministic_seed}:${arm.arm_id}:u1`).slice(0, 8), 16) / 0xffffffff;
      const h2 = parseInt(sha256Hex(`${params.deterministic_seed}:${arm.arm_id}:u2`).slice(0, 8), 16) / 0xffffffff;
      const u1 = Math.max(1e-7, Math.min(1 - 1e-7, h1));
      const u2 = Math.max(1e-7, Math.min(1 - 1e-7, h2));
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      const sample = Math.max(0.0001, Math.min(0.9999, mean + z * stdDev));
      sampledScores[arm.arm_id] = Number(sample.toFixed(6));
      means[arm.arm_id] = Number(mean.toFixed(6));
      intervals[arm.arm_id] = [
        Number(Math.max(0, mean - 1.96 * stdDev).toFixed(4)),
        Number(Math.min(1, mean + 1.96 * stdDev).toFixed(4))
      ];

      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arm.arm_id;
      }
    }

    return {
      selected_arm_id: bestArm,
      sampled_theta_scores: sampledScores,
      posterior_means: means,
      credible_intervals_95: intervals
    };
  }

  private topologicalSort(variables: string[], edges: CausalEdgeSpec[]): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const v of variables) {
      inDegree.set(v, 0);
      adj.set(v, []);
    }
    for (const e of edges) {
      adj.get(e.from)?.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
    const queue = variables.filter((v) => (inDegree.get(v) ?? 0) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const nxt of adj.get(cur) ?? []) {
        const deg = (inDegree.get(nxt) ?? 1) - 1;
        inDegree.set(nxt, deg);
        if (deg === 0) queue.push(nxt);
      }
    }
    if (order.length !== variables.length) {
      throw new Error("Structural Causal Model contains a cycle.");
    }
    return order;
  }

  private forwardPropagateScm(
    topoOrder: string[],
    edges: CausalEdgeSpec[],
    exogenous: Record<string, number>,
    interventions: Record<string, number> = {}
  ): Record<string, number> {
    const values: Record<string, number> = {};
    for (const v of topoOrder) {
      if (interventions[v] !== undefined) {
        values[v] = interventions[v]!;
      } else {
        const parentSum = edges
          .filter((e) => e.to === v)
          .reduce((acc, e) => acc + e.weight * (values[e.from] ?? 0), 0);
        values[v] = (exogenous[v] ?? 0) + parentSum;
      }
    }
    return values;
  }

  private findAncestors(target: string, edges: CausalEdgeSpec[]): Set<string> {
    const visited = new Set<string>();
    const stack = [target];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const e of edges) {
        if (e.to === cur && !visited.has(e.from)) {
          visited.add(e.from);
          stack.push(e.from);
        }
      }
    }
    return visited;
  }
}
