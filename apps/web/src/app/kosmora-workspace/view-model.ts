/**
 * Self-contained View-Model for the Kosmora Sovereign Workspace Page (`apps/web`).
 * Avoids cross-package relative traversal outside `apps/web/src` and enforces a strict
 * monochrome palette (`#0a0a0a`, `#141414`, `#262626`, `#e5e5e5`, `#a3a3a3`, `#ffffff`).
 */

export interface WorkspacePaletteTheme {
  background_primary: "#0a0a0a";
  background_elevated: "#141414";
  border_subtle: "#262626";
  text_primary: "#ffffff";
  text_secondary: "#e5e5e5";
  text_muted: "#a3a3a3";
  accent_monochrome: "#ffffff";
}

export interface KosmoraWorkspaceViewModel {
  title: string;
  subtitle: string;
  theme: WorkspacePaletteTheme;
  dag_summary: {
    plan_id: string;
    goal: string;
    total_nodes: number;
    completed_nodes: number;
    awaiting_hitl_nodes: number;
    budget_limit_usd: number;
    consumed_cost_usd: number;
    nodes: Array<{
      node_id: string;
      title: string;
      role: string;
      status: "succeeded" | "ready" | "awaiting_hitl" | "blocked";
      dependencies: string[];
    }>;
  };
  canvas_summary: {
    artifact_id: string;
    title: string;
    version: number;
    content_sha256: string;
    blocks_count: number;
    exports_available: Array<"XLSX" | "PDF" | "MD" | "ZIP">;
  };
  knowledge_summary: {
    project_id: string;
    retrieval_mode: "vector_embedding_adapter" | "keyword_bm25_fallback";
    active_nodes: number;
    stale_alerts: number;
    top_hit_title: string;
  };
  governance_summary: {
    tenant_id: string;
    rls_enforced: boolean;
    vault_cipher: "AES-256-GCM";
    audit_chain_verified: boolean;
    audit_entries_count: number;
  };
  sovereign_cluster_summary: {
    leader_peer_id: string;
    quorum_term: number;
    fencing_token: number;
    crdt_converged: boolean;
    ed25519_slsa_attested: boolean;
    distilled_skills_promoted: number;
  };
  formal_and_finops_summary: {
    fsm_invariants_verified: boolean;
    csp_anti_affinity_satisfied: boolean;
    w3c_trace_critical_path_ms: number;
    taint_analysis_clean: boolean;
    ucb1_selected_provider: string;
    dp_remaining_epsilon: number;
    merkle_selective_disclosure_verified: boolean;
    rtbf_zero_residue_confirmed: boolean;
  };
  quantum_and_gametheory_summary: {
    hkdf_sha512_active: boolean;
    shamir_threshold_scheme: string;
    fiat_shamir_nizkp_verified: boolean;
    lamport_pqc_signatures_verified: boolean;
    shapley_efficiency_verified: boolean;
    vcg_strategy_proof_verified: boolean;
    schulze_condorcet_winner: string;
    gale_shapley_blocking_pairs: number;
  };
  causal_and_homomorphic_summary: {
    pearl_do_calculus_ace: number;
    counterfactual_ite_verified: boolean;
    bayesian_map_hypothesis: string;
    thompson_selected_strategy: string;
    paillier_homomorphic_verified: boolean;
    wesolowski_vdf_verified: boolean;
    macaroon_caveats_enforced: boolean;
    byzantine_quorum_intersection_verified: boolean;
  };
}

export const KOSMORA_MONOCHROME_THEME: WorkspacePaletteTheme = Object.freeze({
  background_primary: "#0a0a0a",
  background_elevated: "#141414",
  border_subtle: "#262626",
  text_primary: "#ffffff",
  text_secondary: "#e5e5e5",
  text_muted: "#a3a3a3",
  accent_monochrome: "#ffffff"
});

export function buildKosmoraWorkspaceViewModel(overrides?: {
  project_id?: string;
  tenant_id?: string;
}): KosmoraWorkspaceViewModel {
  const projectId = overrides?.project_id ?? "proj_sovereign_q4";
  const tenantId = overrides?.tenant_id ?? "tenant_enterprise_01";

  return {
    title: "Суверенная ИИ-ОС Kosmora — Центр управления (384 модуля, Stage 1–12)",
    subtitle:
      "Детерминированное исполнение DAG, версионируемый холст CRDT/CAS, граф знаний, Raft-кворум, формальная верификация (Stage 7) и FinOps/ZK-комплаенс (Stage 8)",
    theme: KOSMORA_MONOCHROME_THEME,
    dag_summary: {
      plan_id: `plan_${projectId}_01`,
      goal: "Синтез квартального финансового отчёта и аудит безопасности",
      total_nodes: 4,
      completed_nodes: 3,
      awaiting_hitl_nodes: 1,
      budget_limit_usd: 25.0,
      consumed_cost_usd: 0.42,
      nodes: [
        {
          node_id: "n1_ingest",
          title: "Сбор первичных документов и проверка источников",
          role: "researcher",
          status: "succeeded",
          dependencies: []
        },
        {
          node_id: "n2_model",
          title: "Расчёт финансовой модели и сверка баланса",
          role: "analyst",
          status: "succeeded",
          dependencies: ["n1_ingest"]
        },
        {
          node_id: "n3_critic",
          title: "Проверка ограничений политики и цитирований",
          role: "verifier",
          status: "succeeded",
          dependencies: ["n2_model"]
        },
        {
          node_id: "n4_publish",
          title: "Публикация пакета и отправка в коннектор GitHub",
          role: "synthesizer",
          status: "awaiting_hitl",
          dependencies: ["n3_critic"]
        }
      ]
    },
    canvas_summary: {
      artifact_id: "art_q4_board_brief",
      title: "Финансовый меморандум Совета директоров (Q4)",
      version: 2,
      content_sha256:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      blocks_count: 3,
      exports_available: ["XLSX", "PDF", "MD", "ZIP"]
    },
    knowledge_summary: {
      project_id: projectId,
      retrieval_mode: "keyword_bm25_fallback",
      active_nodes: 12,
      stale_alerts: 1,
      top_hit_title: "Утверждённый прогноз выручки и лимитов FinOps"
    },
    governance_summary: {
      tenant_id: tenantId,
      rls_enforced: true,
      vault_cipher: "AES-256-GCM",
      audit_chain_verified: true,
      audit_entries_count: 18
    },
    sovereign_cluster_summary: {
      leader_peer_id: "node-alpha",
      quorum_term: 1,
      fencing_token: 1001,
      crdt_converged: true,
      ed25519_slsa_attested: true,
      distilled_skills_promoted: 4
    },
    formal_and_finops_summary: {
      fsm_invariants_verified: true,
      csp_anti_affinity_satisfied: true,
      w3c_trace_critical_path_ms: 180,
      taint_analysis_clean: true,
      ucb1_selected_provider: "gemini_primary (gemini-2.5-pro)",
      dp_remaining_epsilon: 1.5,
      merkle_selective_disclosure_verified: true,
      rtbf_zero_residue_confirmed: true
    },
    quantum_and_gametheory_summary: {
      hkdf_sha512_active: true,
      shamir_threshold_scheme: "GF(65537) k=3 of n=5",
      fiat_shamir_nizkp_verified: true,
      lamport_pqc_signatures_verified: true,
      shapley_efficiency_verified: true,
      vcg_strategy_proof_verified: true,
      schulze_condorcet_winner: "arch_plan_a",
      gale_shapley_blocking_pairs: 0
    },
    causal_and_homomorphic_summary: {
      pearl_do_calculus_ace: 2.2,
      counterfactual_ite_verified: true,
      bayesian_map_hypothesis: "hyp_token_quota_throttled",
      thompson_selected_strategy: "strategy_flagship_cot",
      paillier_homomorphic_verified: true,
      wesolowski_vdf_verified: true,
      macaroon_caveats_enforced: true,
      byzantine_quorum_intersection_verified: true
    }
  };
}
