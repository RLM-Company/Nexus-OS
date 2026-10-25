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
 * Russian interface, safe declarative JSX rendering.
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
      </section>
    </main>
  );
}
