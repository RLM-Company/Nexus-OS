/**
 * @cosmora/contracts — Kosmora Knowledge Vault & Context Connectors Contracts
 * Project-scoped knowledge collections, document ingestion with secret redaction &
 * prompt-injection quarantine, section-aware chunking with SHA-256 provenance,
 * hybrid BM25 + semantic keyword retrieval, Mission Control grounding bindings,
 * and artifact citation verification.
 */

export const KNOWLEDGE_COLLECTION_VISIBILITIES = [
  "private",
  "project",
  "organization",
  "built_in"
] as const;

export type KnowledgeCollectionVisibility =
  (typeof KNOWLEDGE_COLLECTION_VISIBILITIES)[number];

export const KNOWLEDGE_COLLECTION_STATUSES = [
  "active",
  "indexing",
  "archived"
] as const;

export type KnowledgeCollectionStatus =
  (typeof KNOWLEDGE_COLLECTION_STATUSES)[number];

export const KNOWLEDGE_CHUNKING_STRATEGIES = [
  "markdown_sections",
  "paragraph",
  "fixed_window"
] as const;

export type KnowledgeChunkingStrategy =
  (typeof KNOWLEDGE_CHUNKING_STRATEGIES)[number];

export const KNOWLEDGE_DOCUMENT_SOURCE_TYPES = [
  "markdown",
  "text",
  "url",
  "code",
  "json_spec",
  "mission_artifact"
] as const;

export type KnowledgeDocumentSourceType =
  (typeof KNOWLEDGE_DOCUMENT_SOURCE_TYPES)[number];

export const KNOWLEDGE_DOCUMENT_STATUSES = [
  "indexed",
  "quarantined",
  "archived"
] as const;

export type KnowledgeDocumentStatus =
  (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];

export const KNOWLEDGE_VAULT_AUDIT_EVENT_TYPES = [
  "collection_created",
  "collection_updated",
  "collection_archived",
  "document_ingested",
  "document_updated",
  "document_quarantined",
  "mission_bound",
  "context_retrieved",
  "citations_verified"
] as const;

export type KnowledgeVaultAuditEventType =
  (typeof KNOWLEDGE_VAULT_AUDIT_EVENT_TYPES)[number];

export interface KnowledgeCollection {
  id: string;
  tenant_id: string;
  project_id: string | null;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  visibility: KnowledgeCollectionVisibility;
  status: KnowledgeCollectionStatus;
  chunking_strategy: KnowledgeChunkingStrategy;
  chunk_size_chars: number;
  chunk_overlap_chars: number;
  redact_secrets_on_ingest: boolean;
  document_count: number;
  chunk_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface KnowledgeDocument {
  id: string;
  collection_id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  source_type: KnowledgeDocumentSourceType;
  source_uri: string;
  raw_content_preview: string;
  sanitized_content: string;
  content_sha256: string;
  byte_size: number;
  tags: string[];
  redacted_secrets_count: number;
  quarantine_reason: string | null;
  chunk_count: number;
  status: KnowledgeDocumentStatus;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  collection_id: string;
  tenant_id: string;
  project_id: string;
  chunk_index: number;
  section_heading: string;
  content: string;
  token_estimate: number;
  keywords: string[];
  chunk_sha256: string;
  created_at: string;
}

export interface MissionKnowledgeBinding {
  id: string;
  mission_id: string;
  collection_id: string;
  tenant_id: string;
  project_id: string;
  top_k: number;
  min_relevance_score: number;
  mandatory_citation: boolean;
  created_by: string;
  created_at: string;
}

export interface KnowledgeSearchHit {
  chunk_id: string;
  document_id: string;
  collection_id: string;
  document_title: string;
  source_uri: string;
  section_heading: string;
  chunk_index: number;
  content: string;
  chunk_sha256: string;
  relevance_score: number;
  matched_terms: string[];
  citation_anchor: string;
}

export interface KnowledgeQueryResult {
  query: string;
  collection_ids: string[];
  total_chunks_scanned: number;
  hits: KnowledgeSearchHit[];
  grounded_prompt_block: string;
  executed_at: string;
}

export interface KnowledgeCitationRecord {
  id: string;
  mission_id: string;
  task_id: string | null;
  artifact_id: string;
  collection_id: string;
  document_id: string;
  chunk_id: string;
  citation_anchor: string;
  quote_snippet: string;
  relevance_score: number;
  verified: boolean;
  created_at: string;
}

export interface CitationVerificationReport {
  mission_id: string;
  artifact_id: string;
  bound_collection_ids: string[];
  verified_citations: KnowledgeCitationRecord[];
  unverified_anchors: string[];
  citation_coverage_score: number;
  passed: boolean;
  checked_at: string;
}

export interface KnowledgeVaultAuditEvent {
  id: string;
  collection_id: string;
  document_id: string | null;
  mission_id: string | null;
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_type: KnowledgeVaultAuditEventType;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CreateKnowledgeCollectionInput {
  project_id: string;
  slug: string;
  title: string;
  description?: string;
  category?: string;
  visibility?: Exclude<KnowledgeCollectionVisibility, "built_in">;
  chunking_strategy?: KnowledgeChunkingStrategy;
  chunk_size_chars?: number;
  chunk_overlap_chars?: number;
  redact_secrets_on_ingest?: boolean;
}

export interface UpdateKnowledgeCollectionInput {
  expected_version?: number;
  title?: string;
  description?: string;
  category?: string;
  chunking_strategy?: KnowledgeChunkingStrategy;
  chunk_size_chars?: number;
  chunk_overlap_chars?: number;
  redact_secrets_on_ingest?: boolean;
}

export interface IngestKnowledgeDocumentInput {
  collection_id: string;
  project_id: string;
  title: string;
  source_type?: KnowledgeDocumentSourceType;
  source_uri?: string;
  content: string;
  tags?: string[];
  quarantine_on_injection?: boolean;
}

export interface QueryKnowledgeInput {
  project_id: string;
  collection_ids?: string[];
  query: string;
  tags?: string[];
  top_k?: number;
  min_relevance_score?: number;
}

export interface BindCollectionToMissionInput {
  mission_id: string;
  collection_id: string;
  project_id: string;
  top_k?: number;
  min_relevance_score?: number;
  mandatory_citation?: boolean;
}

export const BUILT_IN_KOSMORA_KNOWLEDGE_COLLECTIONS: ReadonlyArray<{
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  chunking_strategy: KnowledgeChunkingStrategy;
  chunk_size_chars: number;
  chunk_overlap_chars: number;
  documents: ReadonlyArray<{
    id: string;
    title: string;
    source_type: KnowledgeDocumentSourceType;
    source_uri: string;
    tags: string[];
    content: string;
  }>;
}> = [
  {
    id: "kvc_builtin_edtech_market_data",
    slug: "edtech-market-intelligence-2026",
    title: "Отраслевая база знаний: Рынок EdTech и ИИ-платформ 2025–2026",
    description:
      "Верифицированные аналитические обзоры, метрики CAC/LTV, динамика сегментов B2B/B2C EdTech и корпоративного обучения в СНГ и мире.",
    category: "market_research",
    chunking_strategy: "markdown_sections",
    chunk_size_chars: 600,
    chunk_overlap_chars: 80,
    documents: [
      {
        id: "kdoc_builtin_edtech_cis_overview",
        title: "Аналитический обзор рынка EdTech СНГ 2025–2026",
        source_type: "markdown",
        source_uri: "https://research.kosmora.ai/edtech-cis-2026",
        tags: ["edtech", "cis", "market", "b2b"],
        content: [
          "# Методология и объём рынка EdTech",
          "Совокупный объём рынка онлайн-образования (EdTech) в регионе Россия и СНГ по итогам 2025 года составил 148 млрд руб., показав рост на 24% год к году. Наиболее быстрорастущим сегментом стало корпоративное B2B-обучение с использованием ИИ-тьюторов (+38% YoY).",
          "",
          "# Конкуренты и структура игроков",
          "Лидерами корпоративного и профессионального сегмента являются платформы с адаптивными траекториями обучения и встроенными тренажёрами кода. Средний показатель удержания (Retention Rate) у платформ с ИИ-ассистентами достигает 72% против 44% у классических видеокурсов.",
          "",
          "# Риски и юнит-экономика",
          "Ключевые риски рынка включают рост стоимости привлечения клиента (CAC вырос на 31% за год), дефицит квалифицированных методистов и требования по локализации персональных данных учащихся (152-ФЗ)."
        ].join("\n")
      }
    ]
  },
  {
    id: "kvc_builtin_security_owasp_standards",
    slug: "security-owasp-asvs-audit-guide",
    title: "Стандарты ИБ, OWASP ASVS и регламенты аудита кода",
    description:
      "Требования к безопасной разработке, проверке подписи вебхуков, изоляции тенантов (RLS), защите секретов и анализу уязвимостей.",
    category: "security_compliance",
    chunking_strategy: "markdown_sections",
    chunk_size_chars: 600,
    chunk_overlap_chars: 80,
    documents: [
      {
        id: "kdoc_builtin_owasp_asvs_v5",
        title: "Регламент проверки безопасности приложения (OWASP ASVS 5.0)",
        source_type: "markdown",
        source_uri: "https://security.kosmora.ai/standards/owasp-asvs-5",
        tags: ["security", "owasp", "rls", "hmac", "audit"],
        content: [
          "# Уязвимости аутентификации и управления сессиями",
          "Все межсервисные и пользовательские запросы обязаны проверяться криптографически подписанными токенами сессии (HMAC-SHA256 или Ed25519). Входящие вебхуки внешних систем должны проходить проверку подписи с постоянным временем сравнения (timingSafeEqual).",
          "",
          "# Архитектура мультитенантной изоляции (RLS)",
          "Каждая таблица хранения артефактов, миссий, плейбуков и базы знаний обязана содержать поле tenant_id и project_id. Доступ к записям другого тенанта блокируется на уровне ядра со статусом HTTP 403 Forbidden.",
          "",
          "# Рекомендации по исправлению и ротации секретов",
          "При обнаружении открытых токенов, приватных ключей RSA/Ed25519 или паролей в логах и промптах необходимо немедленно выполнить автоматическую редакцию ([REDACTED_SECRET]) и принудительную ротацию скомпрометированного ключа."
        ].join("\n")
      }
    ]
  },
  {
    id: "kvc_builtin_enterprise_architecture",
    slug: "enterprise-multiagent-reference-architecture",
    title: "Референсная архитектура и SLA корпоративных мультиагентных систем",
    description:
      "Спецификации оркестрации DAG, бюджетирования токенов, контрольных точек человека (HITL) и релизных Quality Gates.",
    category: "architecture",
    chunking_strategy: "markdown_sections",
    chunk_size_chars: 600,
    chunk_overlap_chars: 80,
    documents: [
      {
        id: "kdoc_builtin_multiagent_sla",
        title: "Стандарт проектирования мультиагентных пайплайнов Kosmora",
        source_type: "markdown",
        source_uri: "https://standards.kosmora.ai/architecture/multiagent-sla",
        tags: ["architecture", "sla", "hitl", "dag"],
        content: [
          "# Оркестрация графа задач и детерминизм",
          "Любой мультиагентный сценарий представляется в виде ациклического ориентированного графа (DAG) с явными зависимостями, лимитом попыток (max_attempts) и строгим потолком бюджета (budget_limit).",
          "",
          "# Контрольные точки и ревью человека (HITL)",
          "Критические задачи (финальная приёмка, публикация релиза, отправка отчёта клиенту) переводятся в режим waiting_for_review и требуют явного решения владельца миссии (Approve / Request Changes / Reject)."
        ].join("\n")
      }
    ]
  }
];
