/**
 * Migration 008: Kosmora Knowledge Vault & Context Connectors Tables
 * Creates `knowledge_collections`, `knowledge_documents`, `knowledge_chunks`,
 * `mission_knowledge_bindings`, `knowledge_citations`, and `knowledge_vault_audit_events`.
 */

import {
  KNOWLEDGE_VAULT_DDL_DOWN_SQL,
  KNOWLEDGE_VAULT_DDL_UP_SQL,
  KosmoraRuntimeStore,
  type SchemaMigrationRecord
} from "../kosmora-runtime-store.js";

export const MIGRATION_008_VERSION = 8;
export const MIGRATION_008_NAME = "008_kosmora_knowledge_vault_tables";

export { KNOWLEDGE_VAULT_DDL_UP_SQL, KNOWLEDGE_VAULT_DDL_DOWN_SQL };

export function applyKosmoraKnowledgeVaultMigration(
  store: KosmoraRuntimeStore
): SchemaMigrationRecord {
  return store.ensureKnowledgeVaultSchema();
}
