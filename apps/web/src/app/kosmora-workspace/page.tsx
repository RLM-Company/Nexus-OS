import React from "react";
import {
  buildKosmoraWorkspaceViewModel,
  KOSMORA_MONOCHROME_THEME,
  type KosmoraWorkspaceViewModel
} from "./view-model.js";

export { buildKosmoraWorkspaceViewModel, KOSMORA_MONOCHROME_THEME };
export type { KosmoraWorkspaceViewModel };

/**
 * Kosmora Sovereign Workspace Page (Next.js App Router Default Component)
 * Strictly monochrome (#0a0a0a, #141414, #262626, #e5e5e5, #a3a3a3, #ffffff),
 * Russian interface, safe declarative JSX rendering across all 8 stages (F001-F256).
 */
export default function KosmoraWorkspacePage(): React.ReactElement {
  const vm = buildKosmoraWorkspaceViewModel();

  return (
    <main
      style={{
        backgroundColor: vm.theme.background_primary,
        color: vm.theme.text_primary,
        minHeight: "100vh",
        padding: "32px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}
    >
      <header
        style={{
          borderBottom: `1px solid ${vm.theme.border_subtle}`,
          paddingBottom: "20px",
          marginBottom: "28px"
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 600, margin: 0 }}>
          {vm.title}
        </h1>
        <p
          style={{
            color: vm.theme.text_muted,
            fontSize: "14px",
            marginTop: "8px",
            marginBottom: 0
          }}
        >
          {vm.subtitle}
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "20px"
        }}
      >
        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Граф выполнения задач (DAG)
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            План: {vm.dag_summary.plan_id} — Выполнено{" "}
            {vm.dag_summary.completed_nodes} из {vm.dag_summary.total_nodes}{" "}
            узлов (Ожидает HITL: {vm.dag_summary.awaiting_hitl_nodes})
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {vm.dag_summary.nodes.map((node) => (
              <li
                key={node.node_id}
                style={{
                  borderTop: `1px solid ${vm.theme.border_subtle}`,
                  padding: "10px 0",
                  fontSize: "13px",
                  color: vm.theme.text_secondary
                }}
              >
                <strong>{node.node_id}</strong> ({node.role}): {node.title} — [
                {node.status}]
              </li>
            ))}
          </ul>
        </article>

        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Холст артефактов и ревизий (Canvas)
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Артефакт: {vm.canvas_summary.title} (v{vm.canvas_summary.version})
          </p>
          <p style={{ color: vm.theme.text_muted, fontSize: "12px" }}>
            SHA-256: {vm.canvas_summary.content_sha256.slice(0, 24)}...
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Доступные форматы экспорта:{" "}
            {vm.canvas_summary.exports_available.join(", ")}
          </p>
        </article>

        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Граф знаний и память проекта
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Проект: {vm.knowledge_summary.project_id} | Режим поиска:{" "}
            {vm.knowledge_summary.retrieval_mode}
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Активных узлов: {vm.knowledge_summary.active_nodes} | Предупреждений
            об устаревании: {vm.knowledge_summary.stale_alerts}
          </p>
          <p style={{ color: vm.theme.text_muted, fontSize: "12px" }}>
            Релевантный источник: {vm.knowledge_summary.top_hit_title}
          </p>
        </article>

        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Безопасность, Vault и аудит
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Тенант: {vm.governance_summary.tenant_id} | RLS:{" "}
            {vm.governance_summary.rls_enforced ? "Включён" : "Отключён"}
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Шифрование Vault: {vm.governance_summary.vault_cipher}
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Цепочка аудита проверена:{" "}
            {vm.governance_summary.audit_chain_verified ? "Да" : "Нет"} (
            {vm.governance_summary.audit_entries_count} записей)
          </p>
        </article>

        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Суверенный кластер и аттестация (Stage 6)
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Лидер Raft: {vm.sovereign_cluster_summary.leader_peer_id} (Term{" "}
            {vm.sovereign_cluster_summary.quorum_term}, Fencing #
            {vm.sovereign_cluster_summary.fencing_token})
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Сходимость CRDT:{" "}
            {vm.sovereign_cluster_summary.crdt_converged
              ? "Подтверждена"
              : "Ожидание"}{" "}
            | Аттестация Ed25519 SLSA:{" "}
            {vm.sovereign_cluster_summary.ed25519_slsa_attested
              ? "Подписана"
              : "Нет"}
          </p>
          <p style={{ color: vm.theme.text_muted, fontSize: "12px" }}>
            Прошедших канареечный контроль дистиллированных скиллов:{" "}
            {vm.sovereign_cluster_summary.distilled_skills_promoted}
          </p>
        </article>

        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Формальная верификация и FinOps / ZK-Комплаенс (Stage 7–8)
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Инварианты FSM:{" "}
            {vm.formal_and_finops_summary.fsm_invariants_verified
              ? "Доказаны"
              : "Нарушены"}{" "}
            | CSP Anti-Affinity:{" "}
            {vm.formal_and_finops_summary.csp_anti_affinity_satisfied
              ? "Соблюдена"
              : "Конфликт"}
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Критический путь W3C Trace:{" "}
            {vm.formal_and_finops_summary.w3c_trace_critical_path_ms} мс |
            Маршрут UCB1: {vm.formal_and_finops_summary.ucb1_selected_provider}
          </p>
          <p style={{ color: vm.theme.text_muted, fontSize: "12px" }}>
            Остаток бюджета (ε)-DP:{" "}
            {vm.formal_and_finops_summary.dp_remaining_epsilon} | Селективное
            раскрытие Merkle:{" "}
            {vm.formal_and_finops_summary.merkle_selective_disclosure_verified
              ? "Подтверждено"
              : "Ошибка"}
          </p>
        </article>
        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Постквантовая защита (Stage 9) и Теория игр (Stage 10)
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Разделение Шамира: {vm.quantum_and_gametheory_summary.shamir_threshold_scheme} | NIZKP Фиата-Шамира:{" "}
            {vm.quantum_and_gametheory_summary.fiat_shamir_nizkp_verified ? "Доказано" : "Ошибка"}
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Подписи Lamport PQC:{" "}
            {vm.quantum_and_gametheory_summary.lamport_pqc_signatures_verified ? "Подтверждены" : "Нет"} | Вектор Шепли:{" "}
            {vm.quantum_and_gametheory_summary.shapley_efficiency_verified ? "Сбалансирован" : "Расхождение"}
          </p>
          <p style={{ color: vm.theme.text_muted, fontSize: "12px" }}>
            Аукцион VCG:{" "}
            {vm.quantum_and_gametheory_summary.vcg_strategy_proof_verified ? "Strategy-Proof" : "Нарушен"} | Победитель Шульце:{" "}
            {vm.quantum_and_gametheory_summary.schulze_condorcet_winner} | Блокирующих пар Гейла-Шепли:{" "}
            {vm.quantum_and_gametheory_summary.gale_shapley_blocking_pairs}
          </p>
        </article>
        <article
          style={{
            backgroundColor: vm.theme.background_elevated,
            border: `1px solid ${vm.theme.border_subtle}`,
            borderRadius: "8px",
            padding: "20px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: 0 }}>
            Причинный вывод (Stage 11) и Гомоморфная защита / VDF / BFT (Stage 12)
          </h2>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            do-Calculus ACE: +{vm.causal_and_homomorphic_summary.pearl_do_calculus_ace} | Контрфакты ITE:{" "}
            {vm.causal_and_homomorphic_summary.counterfactual_ite_verified ? "Доказаны" : "Ошибка"}
          </p>
          <p style={{ color: vm.theme.text_secondary, fontSize: "13px" }}>
            Байесовский MAP: {vm.causal_and_homomorphic_summary.bayesian_map_hypothesis} | Томпсон:{" "}
            {vm.causal_and_homomorphic_summary.thompson_selected_strategy}
          </p>
          <p style={{ color: vm.theme.text_muted, fontSize: "12px" }}>
            Гомоморфное сложение Пэйе:{" "}
            {vm.causal_and_homomorphic_summary.paillier_homomorphic_verified ? "Точно" : "Сбой"} | VDF Весоловского:{" "}
            {vm.causal_and_homomorphic_summary.wesolowski_vdf_verified ? "Проверено" : "Нет"} | Пересечение BFT 3f+1:{" "}
            {vm.causal_and_homomorphic_summary.byzantine_quorum_intersection_verified ? "Гарантировано" : "Угроза"}
          </p>
        </article>
      </section>
    </main>
  );
}
