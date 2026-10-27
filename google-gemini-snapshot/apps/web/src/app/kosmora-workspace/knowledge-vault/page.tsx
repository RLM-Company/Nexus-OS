import React from "react";
import {
  buildKnowledgeVaultViewModel,
  KOSMORA_KNOWLEDGE_VAULT_MONOCHROME_PALETTE,
  KosmoraKnowledgeVaultPanel
} from "../knowledge-vault.js";

export default function KosmoraKnowledgeVaultPage(): React.ReactElement {
  const vm = buildKnowledgeVaultViewModel();
  const theme = KOSMORA_KNOWLEDGE_VAULT_MONOCHROME_PALETTE;

  return (
    <main
      style={{
        backgroundColor: theme.background_primary,
        color: theme.text_primary,
        minHeight: "100vh",
        padding: "32px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}
    >
      <header
        style={{
          borderBottom: `1px solid ${theme.border_subtle}`,
          paddingBottom: "18px",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px"
        }}
      >
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>
            Kosmora Knowledge Vault — Проектная база знаний и RAG-коннекторы
          </h1>
          <p
            style={{
              color: theme.text_secondary,
              fontSize: "13px",
              marginTop: "6px",
              marginBottom: 0
            }}
          >
            Управление коллекциями, безопасный инжест документов, гибридный поиск с
            цитированием и привязка доказательного контекста к миссиям.
          </p>
        </div>
        <nav
          aria-label="Навигация Kosmora"
          style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}
        >
          <a
            href="/kosmora-workspace"
            style={{
              backgroundColor: theme.surface_elevated,
              color: theme.text_primary,
              border: `1px solid ${theme.border_subtle}`,
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            ← Обзор Workspace
          </a>
          <a
            href="/kosmora-workspace/missions"
            style={{
              backgroundColor: theme.surface_elevated,
              color: theme.text_primary,
              border: `1px solid ${theme.border_subtle}`,
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            Mission Control
          </a>
          <a
            href="/kosmora-workspace/playbooks"
            style={{
              backgroundColor: theme.surface_elevated,
              color: theme.text_primary,
              border: `1px solid ${theme.border_subtle}`,
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            Плейбуки
          </a>
          <a
            href="/kosmora-workspace/evaluations"
            style={{
              backgroundColor: theme.surface_elevated,
              color: theme.text_primary,
              border: `1px solid ${theme.border_subtle}`,
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            Quality Gates
          </a>
        </nav>
      </header>

      <KosmoraKnowledgeVaultPanel viewModel={vm} />
    </main>
  );
}
