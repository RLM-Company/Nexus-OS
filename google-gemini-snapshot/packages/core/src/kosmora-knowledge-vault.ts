/**
 * @cosmora/core — Kosmora Knowledge Vault & Context Connectors Service
 * Project-scoped knowledge collections, document ingestion with secret redaction &
 * prompt-injection quarantine, deterministic section-aware chunking with SHA-256
 * provenance, hybrid BM25 + heading/tag retrieval, Mission Control grounding,
 * and artifact citation verification.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  BUILT_IN_KOSMORA_KNOWLEDGE_COLLECTIONS,
  KNOWLEDGE_CHUNKING_STRATEGIES,
  KNOWLEDGE_COLLECTION_VISIBILITIES,
  KNOWLEDGE_DOCUMENT_SOURCE_TYPES,
  type BindCollectionToMissionInput,
  type CitationVerificationReport,
  type CreateKnowledgeCollectionInput,
  type IngestKnowledgeDocumentInput,
  type KnowledgeChunk,
  type KnowledgeChunkingStrategy,
  type KnowledgeCitationRecord,
  type KnowledgeCollection,
  type KnowledgeCollectionStatus,
  type KnowledgeCollectionVisibility,
  type KnowledgeDocument,
  type KnowledgeDocumentSourceType,
  type KnowledgeDocumentStatus,
  type KnowledgeQueryResult,
  type KnowledgeSearchHit,
  type KnowledgeVaultAuditEvent,
  type KnowledgeVaultAuditEventType,
  type MissionKnowledgeBinding,
  type QueryKnowledgeInput,
  type UpdateKnowledgeCollectionInput
} from "../../contracts/src/kosmora-knowledge-vault.js";
import type {
  KosmoraEnterpriseSecurityService,
  TenantPrincipal
} from "./kosmora-enterprise-security.js";
import type { KosmoraMissionControlService } from "./kosmora-mission-control.js";
import type {
  KosmoraRuntimeStore,
  StoredKnowledgeChunkRow,
  StoredKnowledgeCitationRow,
  StoredKnowledgeCollectionRow,
  StoredKnowledgeDocumentRow,
  StoredKnowledgeVaultAuditEventRow,
  StoredMissionKnowledgeBindingRow
} from "./kosmora-runtime-store.js";

export class KosmoraKnowledgeVaultError extends Error {
  public readonly statusCode: 400 | 403 | 404 | 409 | 422;
  public readonly code: string;

  constructor(
    message: string,
    statusCode: 400 | 403 | 404 | 409 | 422 = 400,
    code = "KNOWLEDGE_VAULT_ERROR"
  ) {
    super(message);
    this.name = "KosmoraKnowledgeVaultError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*/g,
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{12,}["']?/gi
];

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    reason: "Обнаружена попытка переопределения системных инструкций (ignore previous instructions)"
  },
  {
    pattern: /disregard\s+(all\s+)?system\s+(prompt|instructions)/i,
    reason: "Обнаружена попытка обхода системного промпта (disregard system prompt)"
  },
  {
    pattern: /игнорируй\s+(все\s+)?(предыдущие|системные)\s+инструкции/i,
    reason: "Обнаружена русскоязычная prompt-injection директива (игнорируй предыдущие инструкции)"
  },
  {
    pattern: /<\|im_start\|>system|\[SYSTEM\s*OVERRIDE\]/i,
    reason: "Обнаружена инъекция управляющих токенов системной роли"
  }
];

const STOP_WORDS = new Set([
  "и",
  "в",
  "во",
  "на",
  "с",
  "со",
  "по",
  "для",
  "от",
  "до",
  "из",
  "за",
  "или",
  "не",
  "что",
  "как",
  "это",
  "при",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was"
]);

export function tokenizeSearchText(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function sanitizeAndInspectDocumentContent(
  rawContent: string,
  redactSecrets: boolean
): {
  sanitized_content: string;
  redacted_secrets_count: number;
  quarantine_reason: string | null;
} {
  let sanitized = rawContent;
  let redactedCount = 0;

  if (redactSecrets) {
    for (const regex of SECRET_PATTERNS) {
      const matches = sanitized.match(regex);
      if (matches && matches.length > 0) {
        redactedCount += matches.length;
        sanitized = sanitized.replace(regex, "[REDACTED_SECRET]");
      }
    }
  }

  let quarantineReason: string | null = null;
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    if (rule.pattern.test(sanitized)) {
      quarantineReason = rule.reason;
      break;
    }
  }

  return {
    sanitized_content: sanitized,
    redacted_secrets_count: redactedCount,
    quarantine_reason: quarantineReason
  };
}

export function chunkDocumentContent(params: {
  documentId: string;
  collectionId: string;
  tenantId: string;
  projectId: string;
  content: string;
  strategy: KnowledgeChunkingStrategy;
  chunkSizeChars: number;
  chunkOverlapChars: number;
  createdAt: string;
}): StoredKnowledgeChunkRow[] {
  const maxChars = Math.max(120, Math.min(4000, params.chunkSizeChars || 600));
  const overlapChars = Math.max(
    0,
    Math.min(Math.floor(maxChars / 2), params.chunkOverlapChars ?? 80)
  );
  const rawSegments: Array<{ heading: string; body: string }> = [];

  if (params.strategy === "markdown_sections") {
    const lines = params.content.split(/\r?\n/);
    let currentHeading = "Введение";
    let currentLines: string[] = [];

    const flushSection = () => {
      const text = currentLines.join("\n").trim();
      if (text.length > 0) {
        rawSegments.push({ heading: currentHeading, body: text });
      }
      currentLines = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        flushSection();
        currentHeading = headingMatch[2].trim();
      } else {
        currentLines.push(line);
      }
    }
    flushSection();
  } else if (params.strategy === "paragraph") {
    const paragraphs = params.content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    let buffer = "";
    let idx = 1;
    for (const p of paragraphs) {
      if (buffer.length > 0 && buffer.length + p.length + 2 > maxChars) {
        rawSegments.push({ heading: `Параграф ${idx++}`, body: buffer });
        buffer = p;
      } else {
        buffer = buffer.length > 0 ? `${buffer}\n\n${p}` : p;
      }
    }
    if (buffer.length > 0) {
      rawSegments.push({ heading: `Параграф ${idx}`, body: buffer });
    }
  } else {
    const clean = params.content.trim();
    if (clean.length > 0) {
      rawSegments.push({ heading: "Фрагмент документа", body: clean });
    }
  }

  const finalChunks: Array<{ heading: string; content: string }> = [];
  for (const seg of rawSegments) {
    if (seg.body.length <= maxChars) {
      finalChunks.push({ heading: seg.heading, content: seg.body });
    } else {
      const step = Math.max(40, maxChars - overlapChars);
      for (let offset = 0; offset < seg.body.length; offset += step) {
        const slice = seg.body.slice(offset, offset + maxChars).trim();
        if (slice.length > 0) {
          finalChunks.push({ heading: seg.heading, content: slice });
        }
        if (offset + maxChars >= seg.body.length) break;
      }
    }
  }

  return finalChunks.map((item, chunkIndex) => {
    const tokens = tokenizeSearchText(`${item.heading} ${item.content}`);
    const uniqueKeywords = Array.from(new Set(tokens)).slice(0, 24);
    const chunkSha256 = createHash("sha256")
      .update(`${params.documentId}:${chunkIndex}:${item.heading}:${item.content}`)
      .digest("hex");

    return {
      id: `kchk_${params.documentId}_${chunkIndex}`,
      document_id: params.documentId,
      collection_id: params.collectionId,
      tenant_id: params.tenantId,
      project_id: params.projectId,
      chunk_index: chunkIndex,
      section_heading: item.heading,
      content: item.content,
      token_estimate: Math.max(1, Math.ceil(item.content.length / 4)),
      keywords_json: JSON.stringify(uniqueKeywords),
      chunk_sha256: chunkSha256,
      created_at: params.createdAt
    };
  });
}

export interface KosmoraKnowledgeVaultServiceOptions {
  store: KosmoraRuntimeStore;
  security: KosmoraEnterpriseSecurityService;
  missionControl: KosmoraMissionControlService;
}

export class KosmoraKnowledgeVaultService {
  private readonly store: KosmoraRuntimeStore;
  private readonly security: KosmoraEnterpriseSecurityService;
  private readonly missionControl: KosmoraMissionControlService;

  constructor(options: KosmoraKnowledgeVaultServiceOptions) {
    this.store = options.store;
    this.security = options.security;
    this.missionControl = options.missionControl;
    this.store.ensureKnowledgeVaultSchema();
    this.seedBuiltInCollections();
  }

  private seedBuiltInCollections(): void {
    const now = "2026-01-01T00:00:00.000Z";
    for (const builtin of BUILT_IN_KOSMORA_KNOWLEDGE_COLLECTIONS) {
      const existing = this.store.getKnowledgeCollectionRowById(builtin.id);
      if (existing) continue;

      let totalChunks = 0;
      for (const doc of builtin.documents) {
        const sanitized = sanitizeAndInspectDocumentContent(doc.content, true);
        const contentSha256 = createHash("sha256")
          .update(sanitized.sanitized_content)
          .digest("hex");
        const chunks = chunkDocumentContent({
          documentId: doc.id,
          collectionId: builtin.id,
          tenantId: "tenant_system",
          projectId: "__builtin__",
          content: sanitized.sanitized_content,
          strategy: builtin.chunking_strategy,
          chunkSizeChars: builtin.chunk_size_chars,
          chunkOverlapChars: builtin.chunk_overlap_chars,
          createdAt: now
        });
        totalChunks += chunks.length;

        this.store.upsertKnowledgeDocumentRow({
          id: doc.id,
          collection_id: builtin.id,
          tenant_id: "tenant_system",
          project_id: "__builtin__",
          title: doc.title,
          source_type: doc.source_type,
          source_uri: doc.source_uri,
          raw_content_preview: doc.content.slice(0, 240),
          sanitized_content: sanitized.sanitized_content,
          content_sha256: contentSha256,
          byte_size: Buffer.byteLength(sanitized.sanitized_content, "utf8"),
          tags_json: JSON.stringify(doc.tags),
          redacted_secrets_count: sanitized.redacted_secrets_count,
          quarantine_reason: null,
          chunk_count: chunks.length,
          status: "indexed",
          version: 1,
          created_by: "system",
          created_at: now,
          updated_at: now
        });

        this.store.replaceKnowledgeChunksForDocument(doc.id, chunks);
      }

      this.store.upsertKnowledgeCollectionRow({
        id: builtin.id,
        tenant_id: "tenant_system",
        project_id: null,
        owner_id: "system",
        slug: builtin.slug,
        title: builtin.title,
        description: builtin.description,
        category: builtin.category,
        visibility: "built_in",
        status: "active",
        chunking_strategy: builtin.chunking_strategy,
        chunk_size_chars: builtin.chunk_size_chars,
        chunk_overlap_chars: builtin.chunk_overlap_chars,
        redact_secrets_on_ingest: 1,
        document_count: builtin.documents.length,
        chunk_count: totalChunks,
        version: 1,
        created_at: now,
        updated_at: now,
        archived_at: null
      });
    }
  }

  private authorizeRead(principal: TenantPrincipal, projectId: string): void {
    const workspaceId = principal.workspace_ids?.[0] ?? projectId;
    const decision = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      workspaceId,
      "workspace:read"
    );
    if (!decision.allowed) {
      throw new KosmoraKnowledgeVaultError(
        `Доступ к базе знаний запрещён: ${decision.reason}`,
        403,
        "FORBIDDEN_READ"
      );
    }
  }

  private authorizeWrite(principal: TenantPrincipal, projectId: string): void {
    const workspaceId = principal.workspace_ids?.[0] ?? projectId;
    const decision = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      workspaceId,
      "workspace:write"
    );
    if (!decision.allowed) {
      throw new KosmoraKnowledgeVaultError(
        `Операция записи в базу знаний запрещена: ${decision.reason}`,
        403,
        "FORBIDDEN_WRITE"
      );
    }
  }

  private rowToCollection(row: StoredKnowledgeCollectionRow): KnowledgeCollection {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      owner_id: row.owner_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      category: row.category,
      visibility: row.visibility as KnowledgeCollectionVisibility,
      status: row.status as KnowledgeCollectionStatus,
      chunking_strategy: row.chunking_strategy as KnowledgeChunkingStrategy,
      chunk_size_chars: Number(row.chunk_size_chars),
      chunk_overlap_chars: Number(row.chunk_overlap_chars),
      redact_secrets_on_ingest: Boolean(row.redact_secrets_on_ingest),
      document_count: Number(row.document_count),
      chunk_count: Number(row.chunk_count),
      version: Number(row.version),
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived_at: row.archived_at
    };
  }

  private rowToDocument(row: StoredKnowledgeDocumentRow): KnowledgeDocument {
    return {
      id: row.id,
      collection_id: row.collection_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      title: row.title,
      source_type: row.source_type as KnowledgeDocumentSourceType,
      source_uri: row.source_uri,
      raw_content_preview: row.raw_content_preview,
      sanitized_content: row.sanitized_content,
      content_sha256: row.content_sha256,
      byte_size: Number(row.byte_size),
      tags: JSON.parse(row.tags_json || "[]") as string[],
      redacted_secrets_count: Number(row.redacted_secrets_count),
      quarantine_reason: row.quarantine_reason,
      chunk_count: Number(row.chunk_count),
      status: row.status as KnowledgeDocumentStatus,
      version: Number(row.version),
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private rowToChunk(row: StoredKnowledgeChunkRow): KnowledgeChunk {
    return {
      id: row.id,
      document_id: row.document_id,
      collection_id: row.collection_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      chunk_index: Number(row.chunk_index),
      section_heading: row.section_heading,
      content: row.content,
      token_estimate: Number(row.token_estimate),
      keywords: JSON.parse(row.keywords_json || "[]") as string[],
      chunk_sha256: row.chunk_sha256,
      created_at: row.created_at
    };
  }

  private rowToBinding(row: StoredMissionKnowledgeBindingRow): MissionKnowledgeBinding {
    return {
      id: row.id,
      mission_id: row.mission_id,
      collection_id: row.collection_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      top_k: Number(row.top_k),
      min_relevance_score: Number(row.min_relevance_score),
      mandatory_citation: Boolean(row.mandatory_citation),
      created_by: row.created_by,
      created_at: row.created_at
    };
  }

  private rowToCitation(row: StoredKnowledgeCitationRow): KnowledgeCitationRecord {
    return {
      id: row.id,
      mission_id: row.mission_id,
      task_id: row.task_id,
      artifact_id: row.artifact_id,
      collection_id: row.collection_id,
      document_id: row.document_id,
      chunk_id: row.chunk_id,
      citation_anchor: row.citation_anchor,
      quote_snippet: row.quote_snippet,
      relevance_score: Number(row.relevance_score),
      verified: Boolean(row.verified),
      created_at: row.created_at
    };
  }

  private recordAuditEvent(params: {
    collection_id: string;
    document_id?: string | null;
    mission_id?: string | null;
    tenant_id: string;
    project_id: string;
    actor_id: string;
    event_type: KnowledgeVaultAuditEventType;
    details: Record<string, unknown>;
  }): void {
    this.store.insertKnowledgeVaultAuditEventRow({
      id: `kvaud_${randomUUID()}`,
      collection_id: params.collection_id,
      document_id: params.document_id ?? null,
      mission_id: params.mission_id ?? null,
      tenant_id: params.tenant_id,
      project_id: params.project_id,
      actor_id: params.actor_id,
      event_type: params.event_type,
      details_json: JSON.stringify(params.details),
      created_at: new Date().toISOString()
    });
  }

  private recalculateCollectionCounts(collectionId: string): void {
    const col = this.store.getKnowledgeCollectionRowById(collectionId);
    if (!col) return;
    const docs = this.store.listKnowledgeDocumentRows({
      collection_id: collectionId,
      status: "indexed"
    });
    const chunks = this.store.listKnowledgeChunkRows({
      collection_ids: [collectionId]
    });
    this.store.upsertKnowledgeCollectionRow({
      ...col,
      document_count: docs.length,
      chunk_count: chunks.length,
      updated_at: new Date().toISOString()
    });
  }

  public createCollection(
    principal: TenantPrincipal,
    input: CreateKnowledgeCollectionInput
  ): KnowledgeCollection {
    if (!input.project_id || input.project_id.trim().length === 0) {
      throw new KosmoraKnowledgeVaultError(
        "Поле project_id обязательно для создания коллекции знаний",
        400,
        "INVALID_PROJECT_ID"
      );
    }
    this.authorizeWrite(principal, input.project_id);

    const slug = (input.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-_]{2,63}$/.test(slug)) {
      throw new KosmoraKnowledgeVaultError(
        "Некорректный slug коллекции: используйте латинские буквы, цифры, дефис или подчёркивание (3–64 символа)",
        400,
        "INVALID_SLUG"
      );
    }
    if (!input.title || input.title.trim().length < 3) {
      throw new KosmoraKnowledgeVaultError(
        "Название коллекции должно содержать минимум 3 символа",
        400,
        "INVALID_TITLE"
      );
    }

    const strategy = input.chunking_strategy ?? "markdown_sections";
    if (!KNOWLEDGE_CHUNKING_STRATEGIES.includes(strategy)) {
      throw new KosmoraKnowledgeVaultError(
        `Неподдерживаемая стратегия чанкинга: ${strategy}`,
        400,
        "INVALID_CHUNKING_STRATEGY"
      );
    }

    const visibility = input.visibility ?? "project";
    if (
      !KNOWLEDGE_COLLECTION_VISIBILITIES.includes(visibility) ||
      visibility === "built_in"
    ) {
      throw new KosmoraKnowledgeVaultError(
        `Недопустимая область видимости коллекции: ${visibility}`,
        400,
        "INVALID_VISIBILITY"
      );
    }

    const existing = this.store.getKnowledgeCollectionRowBySlug(
      principal.tenant_id,
      input.project_id,
      slug
    );
    if (existing) {
      throw new KosmoraKnowledgeVaultError(
        `Коллекция со slug '${slug}' уже существует в проекте '${input.project_id}'`,
        409,
        "DUPLICATE_COLLECTION_SLUG"
      );
    }

    const now = new Date().toISOString();
    const row: StoredKnowledgeCollectionRow = {
      id: `kvc_${randomUUID()}`,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      owner_id: principal.user_id,
      slug,
      title: input.title.trim(),
      description: (input.description ?? "").trim(),
      category: (input.category ?? "general").trim(),
      visibility,
      status: "active",
      chunking_strategy: strategy,
      chunk_size_chars: Math.max(120, Math.min(4000, input.chunk_size_chars ?? 600)),
      chunk_overlap_chars: Math.max(0, Math.min(1000, input.chunk_overlap_chars ?? 80)),
      redact_secrets_on_ingest: input.redact_secrets_on_ingest !== false ? 1 : 0,
      document_count: 0,
      chunk_count: 0,
      version: 1,
      created_at: now,
      updated_at: now,
      archived_at: null
    };

    this.store.upsertKnowledgeCollectionRow(row);
    this.recordAuditEvent({
      collection_id: row.id,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      actor_id: principal.user_id,
      event_type: "collection_created",
      details: {
        slug: row.slug,
        title: row.title,
        chunking_strategy: row.chunking_strategy
      }
    });

    return this.rowToCollection(row);
  }

  public getCollection(
    principal: TenantPrincipal,
    collectionId: string
  ): KnowledgeCollection {
    const row = this.store.getKnowledgeCollectionRowById(collectionId);
    if (!row) {
      throw new KosmoraKnowledgeVaultError(
        `Коллекция знаний '${collectionId}' не найдена`,
        404,
        "COLLECTION_NOT_FOUND"
      );
    }
    if (row.visibility !== "built_in" && row.tenant_id !== principal.tenant_id) {
      throw new KosmoraKnowledgeVaultError(
        "Доступ к коллекции другого тенанта запрещён",
        403,
        "TENANT_ISOLATION_VIOLATION"
      );
    }
    this.authorizeRead(principal, row.project_id ?? "proj_default");
    return this.rowToCollection(row);
  }

  public listCollections(
    principal: TenantPrincipal,
    filters?: {
      project_id?: string;
      category?: string;
      status?: string;
      visibility?: string;
    }
  ): KnowledgeCollection[] {
    this.authorizeRead(principal, filters?.project_id ?? "proj_default");
    const rows = this.store.listKnowledgeCollectionRows({
      tenant_id: principal.tenant_id,
      project_id: filters?.project_id,
      category: filters?.category,
      status: filters?.status,
      visibility: filters?.visibility
    });
    return rows.map((r) => this.rowToCollection(r));
  }

  public updateCollection(
    principal: TenantPrincipal,
    collectionId: string,
    input: UpdateKnowledgeCollectionInput
  ): KnowledgeCollection {
    const row = this.store.getKnowledgeCollectionRowById(collectionId);
    if (!row) {
      throw new KosmoraKnowledgeVaultError(
        `Коллекция знаний '${collectionId}' не найдена`,
        404,
        "COLLECTION_NOT_FOUND"
      );
    }
    if (row.visibility === "built_in") {
      throw new KosmoraKnowledgeVaultError(
        "Встроенные системные коллекции знаний неизменяемы",
        403,
        "BUILTIN_COLLECTION_IMMUTABLE"
      );
    }
    if (row.tenant_id !== principal.tenant_id) {
      throw new KosmoraKnowledgeVaultError(
        "Доступ к коллекции другого тенанта запрещён",
        403,
        "TENANT_ISOLATION_VIOLATION"
      );
    }
    this.authorizeWrite(principal, row.project_id ?? "proj_default");

    if (
      input.expected_version !== undefined &&
      Number(input.expected_version) !== Number(row.version)
    ) {
      throw new KosmoraKnowledgeVaultError(
        `Конфликт версий коллекции '${collectionId}': ожидалась версия ${input.expected_version}, актуальная ${row.version}`,
        409,
        "VERSION_CONFLICT"
      );
    }

    const nextStrategy = input.chunking_strategy ?? (row.chunking_strategy as KnowledgeChunkingStrategy);
    const nextChunkSize =
      input.chunk_size_chars !== undefined
        ? Math.max(120, Math.min(4000, input.chunk_size_chars))
        : row.chunk_size_chars;
    const nextOverlap =
      input.chunk_overlap_chars !== undefined
        ? Math.max(0, Math.min(1000, input.chunk_overlap_chars))
        : row.chunk_overlap_chars;

    const chunkingChanged =
      nextStrategy !== row.chunking_strategy ||
      nextChunkSize !== row.chunk_size_chars ||
      nextOverlap !== row.chunk_overlap_chars;

    const now = new Date().toISOString();
    const updatedRow: StoredKnowledgeCollectionRow = {
      ...row,
      title: input.title !== undefined ? input.title.trim() : row.title,
      description:
        input.description !== undefined ? input.description.trim() : row.description,
      category: input.category !== undefined ? input.category.trim() : row.category,
      chunking_strategy: nextStrategy,
      chunk_size_chars: nextChunkSize,
      chunk_overlap_chars: nextOverlap,
      redact_secrets_on_ingest:
        input.redact_secrets_on_ingest !== undefined
          ? input.redact_secrets_on_ingest
            ? 1
            : 0
          : row.redact_secrets_on_ingest,
      version: Number(row.version) + 1,
      updated_at: now
    };

    this.store.upsertKnowledgeCollectionRow(updatedRow);

    if (chunkingChanged) {
      const docs = this.store.listKnowledgeDocumentRows({
        collection_id: collectionId,
        status: "indexed"
      });
      for (const doc of docs) {
        const rechunked = chunkDocumentContent({
          documentId: doc.id,
          collectionId,
          tenantId: doc.tenant_id,
          projectId: doc.project_id,
          content: doc.sanitized_content,
          strategy: nextStrategy,
          chunkSizeChars: nextChunkSize,
          chunkOverlapChars: nextOverlap,
          createdAt: now
        });
        this.store.replaceKnowledgeChunksForDocument(doc.id, rechunked);
        this.store.upsertKnowledgeDocumentRow({
          ...doc,
          chunk_count: rechunked.length,
          updated_at: now
        });
      }
      this.recalculateCollectionCounts(collectionId);
    }

    this.recordAuditEvent({
      collection_id: collectionId,
      tenant_id: principal.tenant_id,
      project_id: row.project_id ?? "proj_default",
      actor_id: principal.user_id,
      event_type: "collection_updated",
      details: {
        version: updatedRow.version,
        chunking_reindexed: chunkingChanged
      }
    });

    return this.getCollection(principal, collectionId);
  }

  public archiveCollection(
    principal: TenantPrincipal,
    collectionId: string
  ): KnowledgeCollection {
    const row = this.store.getKnowledgeCollectionRowById(collectionId);
    if (!row) {
      throw new KosmoraKnowledgeVaultError(
        `Коллекция знаний '${collectionId}' не найдена`,
        404,
        "COLLECTION_NOT_FOUND"
      );
    }
    if (row.visibility === "built_in") {
      throw new KosmoraKnowledgeVaultError(
        "Встроенные системные коллекции нельзя архивировать",
        403,
        "BUILTIN_COLLECTION_IMMUTABLE"
      );
    }
    if (row.tenant_id !== principal.tenant_id) {
      throw new KosmoraKnowledgeVaultError(
        "Доступ к коллекции другого тенанта запрещён",
        403,
        "TENANT_ISOLATION_VIOLATION"
      );
    }
    this.authorizeWrite(principal, row.project_id ?? "proj_default");

    const now = new Date().toISOString();
    const archived: StoredKnowledgeCollectionRow = {
      ...row,
      status: "archived",
      version: Number(row.version) + 1,
      updated_at: now,
      archived_at: now
    };
    this.store.upsertKnowledgeCollectionRow(archived);

    this.recordAuditEvent({
      collection_id: collectionId,
      tenant_id: principal.tenant_id,
      project_id: row.project_id ?? "proj_default",
      actor_id: principal.user_id,
      event_type: "collection_archived",
      details: { archived_at: now }
    });

    return this.rowToCollection(archived);
  }

  public ingestDocument(
    principal: TenantPrincipal,
    input: IngestKnowledgeDocumentInput
  ): { document: KnowledgeDocument; chunks: KnowledgeChunk[] } {
    if (!input.project_id || input.project_id.trim().length === 0) {
      throw new KosmoraKnowledgeVaultError(
        "Поле project_id обязательно для загрузки документа",
        400,
        "INVALID_PROJECT_ID"
      );
    }
    this.authorizeWrite(principal, input.project_id);

    const collection = this.store.getKnowledgeCollectionRowById(input.collection_id);
    if (!collection) {
      throw new KosmoraKnowledgeVaultError(
        `Коллекция знаний '${input.collection_id}' не найдена`,
        404,
        "COLLECTION_NOT_FOUND"
      );
    }
    if (collection.visibility === "built_in") {
      throw new KosmoraKnowledgeVaultError(
        "Встроенные системные коллекции открыты только для чтения",
        403,
        "BUILTIN_COLLECTION_READONLY"
      );
    }
    if (collection.tenant_id !== principal.tenant_id) {
      throw new KosmoraKnowledgeVaultError(
        "Загрузка документов в коллекцию другого тенанта запрещена",
        403,
        "TENANT_ISOLATION_VIOLATION"
      );
    }
    if (collection.status === "archived") {
      throw new KosmoraKnowledgeVaultError(
        "Нельзя добавлять документы в архивную коллекцию знаний",
        409,
        "COLLECTION_ARCHIVED"
      );
    }

    if (!input.title || input.title.trim().length < 2) {
      throw new KosmoraKnowledgeVaultError(
        "Заголовок документа должен содержать минимум 2 символа",
        400,
        "INVALID_DOCUMENT_TITLE"
      );
    }
    if (!input.content || input.content.trim().length === 0) {
      throw new KosmoraKnowledgeVaultError(
        "Содержимое документа не может быть пустым",
        400,
        "EMPTY_DOCUMENT_CONTENT"
      );
    }

    const sourceType = input.source_type ?? "markdown";
    if (!KNOWLEDGE_DOCUMENT_SOURCE_TYPES.includes(sourceType)) {
      throw new KosmoraKnowledgeVaultError(
        `Неподдерживаемый тип источника документа: ${sourceType}`,
        400,
        "INVALID_SOURCE_TYPE"
      );
    }

    const inspection = sanitizeAndInspectDocumentContent(
      input.content,
      Boolean(collection.redact_secrets_on_ingest)
    );
    const shouldQuarantine =
      input.quarantine_on_injection !== false &&
      inspection.quarantine_reason !== null;

    const now = new Date().toISOString();
    const docId = `kdoc_${randomUUID()}`;
    const contentSha256 = createHash("sha256")
      .update(inspection.sanitized_content)
      .digest("hex");

    const chunkRows = shouldQuarantine
      ? []
      : chunkDocumentContent({
          documentId: docId,
          collectionId: collection.id,
          tenantId: principal.tenant_id,
          projectId: input.project_id,
          content: inspection.sanitized_content,
          strategy: collection.chunking_strategy as KnowledgeChunkingStrategy,
          chunkSizeChars: Number(collection.chunk_size_chars),
          chunkOverlapChars: Number(collection.chunk_overlap_chars),
          createdAt: now
        });

    const normalizedTags = Array.from(
      new Set(
        (input.tags ?? [])
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0)
      )
    );

    const docRow: StoredKnowledgeDocumentRow = {
      id: docId,
      collection_id: collection.id,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      title: input.title.trim(),
      source_type: sourceType,
      source_uri: (input.source_uri ?? `kosmora://vault/${collection.slug}/${docId}`).trim(),
      raw_content_preview: inspection.sanitized_content.slice(0, 240),
      sanitized_content: inspection.sanitized_content,
      content_sha256: contentSha256,
      byte_size: Buffer.byteLength(inspection.sanitized_content, "utf8"),
      tags_json: JSON.stringify(normalizedTags),
      redacted_secrets_count: inspection.redacted_secrets_count,
      quarantine_reason: shouldQuarantine ? inspection.quarantine_reason : null,
      chunk_count: chunkRows.length,
      status: shouldQuarantine ? "quarantined" : "indexed",
      version: 1,
      created_by: principal.user_id,
      created_at: now,
      updated_at: now
    };

    this.store.upsertKnowledgeDocumentRow(docRow);
    this.store.replaceKnowledgeChunksForDocument(docId, chunkRows);
    this.recalculateCollectionCounts(collection.id);

    this.recordAuditEvent({
      collection_id: collection.id,
      document_id: docId,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      actor_id: principal.user_id,
      event_type: shouldQuarantine ? "document_quarantined" : "document_ingested",
      details: {
        title: docRow.title,
        status: docRow.status,
        chunk_count: chunkRows.length,
        redacted_secrets_count: docRow.redacted_secrets_count,
        quarantine_reason: docRow.quarantine_reason
      }
    });

    return {
      document: this.rowToDocument(docRow),
      chunks: chunkRows.map((c) => this.rowToChunk(c))
    };
  }

  public listDocuments(
    principal: TenantPrincipal,
    collectionId: string,
    status?: KnowledgeDocumentStatus
  ): KnowledgeDocument[] {
    const col = this.getCollection(principal, collectionId);
    const rows = this.store.listKnowledgeDocumentRows({
      collection_id: col.id,
      status
    });
    return rows.map((r) => this.rowToDocument(r));
  }

  public getDocumentWithChunks(
    principal: TenantPrincipal,
    documentId: string
  ): { document: KnowledgeDocument; chunks: KnowledgeChunk[] } {
    const docRow = this.store.getKnowledgeDocumentRowById(documentId);
    if (!docRow) {
      throw new KosmoraKnowledgeVaultError(
        `Документ '${documentId}' не найден`,
        404,
        "DOCUMENT_NOT_FOUND"
      );
    }
    this.getCollection(principal, docRow.collection_id);
    const chunkRows = this.store.listKnowledgeChunkRows({
      document_id: documentId
    });
    return {
      document: this.rowToDocument(docRow),
      chunks: chunkRows.map((c) => this.rowToChunk(c))
    };
  }

  public queryKnowledge(
    principal: TenantPrincipal,
    input: QueryKnowledgeInput
  ): KnowledgeQueryResult {
    if (!input.project_id || input.project_id.trim().length === 0) {
      throw new KosmoraKnowledgeVaultError(
        "Поле project_id обязательно для выполнения поискового запроса",
        400,
        "INVALID_PROJECT_ID"
      );
    }
    this.authorizeRead(principal, input.project_id);

    const queryText = (input.query ?? "").trim();
    if (queryText.length === 0) {
      throw new KosmoraKnowledgeVaultError(
        "Поисковый запрос к базе знаний не может быть пустым",
        400,
        "EMPTY_QUERY"
      );
    }

    let targetCollectionIds: string[] = [];
    if (input.collection_ids && input.collection_ids.length > 0) {
      for (const cid of input.collection_ids) {
        const col = this.getCollection(principal, cid);
        if (col.status === "active") {
          targetCollectionIds.push(col.id);
        }
      }
    } else {
      const visible = this.listCollections(principal, {
        project_id: input.project_id,
        status: "active"
      });
      targetCollectionIds = visible.map((c) => c.id);
    }

    if (targetCollectionIds.length === 0) {
      return {
        query: queryText,
        collection_ids: [],
        total_chunks_scanned: 0,
        hits: [],
        grounded_prompt_block: "",
        executed_at: new Date().toISOString()
      };
    }

    // Build map of indexed documents in target collections
    const indexedDocsById = new Map<string, KnowledgeDocument>();
    const requestedTags = (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);

    for (const cid of targetCollectionIds) {
      const docRows = this.store.listKnowledgeDocumentRows({
        collection_id: cid,
        status: "indexed"
      });
      for (const dr of docRows) {
        const doc = this.rowToDocument(dr);
        if (requestedTags.length > 0) {
          const hasTag = requestedTags.some((tag) => doc.tags.includes(tag));
          if (!hasTag) continue;
        }
        indexedDocsById.set(doc.id, doc);
      }
    }

    const allChunkRows = this.store
      .listKnowledgeChunkRows({
        collection_ids: targetCollectionIds
      })
      .filter((cr) => indexedDocsById.has(cr.document_id));

    const queryTerms = tokenizeSearchText(queryText);
    const totalChunks = allChunkRows.length;
    const minScore = input.min_relevance_score ?? 0.08;
    const topK = Math.max(1, Math.min(25, input.top_k ?? 5));

    // Precompute document frequencies for BM25
    const docFreq = new Map<string, number>();
    const chunkTokensList: Array<{
      row: StoredKnowledgeChunkRow;
      tokens: string[];
      headingLower: string;
      contentLower: string;
    }> = [];

    let totalLen = 0;
    for (const row of allChunkRows) {
      const headingLower = row.section_heading.toLowerCase();
      const contentLower = row.content.toLowerCase();
      const tokens = tokenizeSearchText(`${row.section_heading} ${row.content}`);
      totalLen += Math.max(1, tokens.length);
      const seen = new Set<string>();
      for (const tok of tokens) {
        for (const qt of queryTerms) {
          if (tok === qt || (qt.length >= 4 && (tok.startsWith(qt.slice(0, 4)) || qt.startsWith(tok.slice(0, 4))))) {
            seen.add(qt);
          }
        }
      }
      for (const matchedQt of seen) {
        docFreq.set(matchedQt, (docFreq.get(matchedQt) ?? 0) + 1);
      }
      chunkTokensList.push({ row, tokens, headingLower, contentLower });
    }

    const avgLen = totalChunks > 0 ? totalLen / totalChunks : 1;
    const k1 = 1.5;
    const b = 0.75;
    const hits: KnowledgeSearchHit[] = [];

    for (const item of chunkTokensList) {
      const doc = indexedDocsById.get(item.row.document_id);
      if (!doc) continue;

      let bm25Raw = 0;
      const matchedTerms: string[] = [];

      for (const qt of queryTerms) {
        let tf = 0;
        for (const tok of item.tokens) {
          if (tok === qt) {
            tf += 1;
          } else if (
            qt.length >= 4 &&
            tok.length >= 4 &&
            (tok.startsWith(qt.slice(0, 4)) || qt.startsWith(tok.slice(0, 4)))
          ) {
            tf += 0.65;
          }
        }
        if (tf > 0) {
          matchedTerms.push(qt);
          const df = docFreq.get(qt) ?? 1;
          const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
          const denom = tf + k1 * (1 - b + b * (item.tokens.length / avgLen));
          bm25Raw += idf * ((tf * (k1 + 1)) / Math.max(0.001, denom));
        }
      }

      if (matchedTerms.length === 0) continue;

      const coverageRatio = matchedTerms.length / Math.max(1, queryTerms.length);
      const normalizedBm25 = Math.min(0.6, bm25Raw / Math.max(1.5, queryTerms.length * 1.4));

      let headingBoost = 0;
      const docTitleLower = doc.title.toLowerCase();
      for (const mt of matchedTerms) {
        const stem = mt.slice(0, Math.min(mt.length, 4));
        if (item.headingLower.includes(stem) || docTitleLower.includes(stem)) {
          headingBoost = 0.22;
          break;
        }
      }

      let tagBoost = 0;
      for (const mt of matchedTerms) {
        const stem = mt.slice(0, Math.min(mt.length, 4));
        if (doc.tags.some((t) => t.includes(stem) || stem.includes(t))) {
          tagBoost = 0.12;
          break;
        }
      }

      const exactSubstringBoost =
        item.contentLower.includes(queryText.toLowerCase()) ? 0.15 : 0;

      const relevanceScore = Number(
        Math.min(
          0.99,
          normalizedBm25 * 0.55 +
            coverageRatio * 0.35 +
            headingBoost +
            tagBoost +
            exactSubstringBoost
        ).toFixed(4)
      );

      if (relevanceScore < minScore) continue;

      const citationAnchor = `[CIT:${doc.id}#${item.row.chunk_index}]`;
      hits.push({
        chunk_id: item.row.id,
        document_id: doc.id,
        collection_id: item.row.collection_id,
        document_title: doc.title,
        source_uri: doc.source_uri,
        section_heading: item.row.section_heading,
        chunk_index: Number(item.row.chunk_index),
        content: item.row.content,
        chunk_sha256: item.row.chunk_sha256,
        relevance_score: relevanceScore,
        matched_terms: Array.from(new Set(matchedTerms)),
        citation_anchor: citationAnchor
      });
    }

    hits.sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score;
      }
      return a.chunk_id.localeCompare(b.chunk_id);
    });

    const topHits = hits.slice(0, topK);
    const groundedPromptBlock =
      topHits.length === 0
        ? ""
        : [
            "=== КОНТЕКСТ ИЗ KOSMORA KNOWLEDGE VAULT (ОБЯЗАТЕЛЬНО ЦИТИРОВАТЬ ИСТОЧНИКИ) ===",
            ...topHits.map(
              (h, idx) =>
                `${idx + 1}. ${h.citation_anchor} Документ: «${h.document_title}» | Раздел: «${h.section_heading}» | Источник: ${h.source_uri} (релевантность: ${h.relevance_score}, SHA-256: ${h.chunk_sha256.slice(0, 12)})\n${h.content}`
            ),
            "=== КОНЕЦ БЛОКА ДОКАЗАТЕЛЬНЫХ ИСТОЧНИКОВ ==="
          ].join("\n\n");

    const executedAt = new Date().toISOString();
    if (targetCollectionIds.length > 0) {
      this.recordAuditEvent({
        collection_id: targetCollectionIds[0],
        tenant_id: principal.tenant_id,
        project_id: input.project_id,
        actor_id: principal.user_id,
        event_type: "context_retrieved",
        details: {
          query: queryText,
          collection_ids: targetCollectionIds,
          hits_count: topHits.length
        }
      });
    }

    return {
      query: queryText,
      collection_ids: targetCollectionIds,
      total_chunks_scanned: totalChunks,
      hits: topHits,
      grounded_prompt_block: groundedPromptBlock,
      executed_at: executedAt
    };
  }

  public bindCollectionToMission(
    principal: TenantPrincipal,
    input: BindCollectionToMissionInput
  ): MissionKnowledgeBinding {
    if (!input.project_id || input.project_id.trim().length === 0) {
      throw new KosmoraKnowledgeVaultError(
        "Поле project_id обязательно для привязки базы знаний к миссии",
        400,
        "INVALID_PROJECT_ID"
      );
    }
    this.authorizeWrite(principal, input.project_id);

    const collection = this.getCollection(principal, input.collection_id);
    if (collection.status !== "active") {
      throw new KosmoraKnowledgeVaultError(
        `Коллекция '${collection.id}' должна быть в статусе active для привязки к миссии`,
        409,
        "COLLECTION_NOT_ACTIVE"
      );
    }

    // Verify mission exists and belongs to project
    const missionDetails = this.missionControl.getMissionDetails({
      principal,
      mission_id: input.mission_id
    });
    if (missionDetails.mission.project_id !== input.project_id) {
      throw new KosmoraKnowledgeVaultError(
        "Миссия принадлежит другому проекту",
        403,
        "MISSION_PROJECT_MISMATCH"
      );
    }

    const now = new Date().toISOString();
    const row: StoredMissionKnowledgeBindingRow = {
      id: `mkb_${randomUUID()}`,
      mission_id: input.mission_id,
      collection_id: collection.id,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      top_k: Math.max(1, Math.min(20, input.top_k ?? 5)),
      min_relevance_score: Math.max(0, Math.min(1, input.min_relevance_score ?? 0.08)),
      mandatory_citation: input.mandatory_citation !== false ? 1 : 0,
      created_by: principal.user_id,
      created_at: now
    };

    this.store.upsertMissionKnowledgeBindingRow(row);
    this.recordAuditEvent({
      collection_id: collection.id,
      mission_id: input.mission_id,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      actor_id: principal.user_id,
      event_type: "mission_bound",
      details: {
        mission_id: input.mission_id,
        top_k: row.top_k,
        mandatory_citation: Boolean(row.mandatory_citation)
      }
    });

    return this.rowToBinding(row);
  }

  public listMissionBindings(
    principal: TenantPrincipal,
    missionId: string
  ): MissionKnowledgeBinding[] {
    const details = this.missionControl.getMissionDetails({
      principal,
      mission_id: missionId
    });
    this.authorizeRead(principal, details.mission.project_id);
    return this.store
      .listMissionKnowledgeBindingRows(missionId)
      .map((r) => this.rowToBinding(r));
  }

  public groundMissionWithKnowledge(
    principal: TenantPrincipal,
    params: {
      mission_id: string;
      project_id: string;
      custom_query?: string;
    }
  ): {
    bindings: MissionKnowledgeBinding[];
    query_result: KnowledgeQueryResult;
    updated_mission_context: Record<string, unknown>;
  } {
    this.authorizeWrite(principal, params.project_id);
    const details = this.missionControl.getMissionDetails({
      principal,
      mission_id: params.mission_id
    });

    const bindings = this.listMissionBindings(principal, params.mission_id);
    const boundCollectionIds = bindings.map((b) => b.collection_id);
    const maxTopK =
      bindings.length > 0
        ? Math.max(...bindings.map((b) => b.top_k))
        : 5;
    const minScore =
      bindings.length > 0
        ? Math.min(...bindings.map((b) => b.min_relevance_score))
        : 0.08;

    const effectiveQuery =
      params.custom_query && params.custom_query.trim().length > 0
        ? params.custom_query.trim()
        : `${details.mission.title} ${details.mission.goal}`;

    const queryResult = this.queryKnowledge(principal, {
      project_id: params.project_id,
      collection_ids: boundCollectionIds.length > 0 ? boundCollectionIds : undefined,
      query: effectiveQuery,
      top_k: maxTopK,
      min_relevance_score: minScore
    });

    const existingContextStr =
      typeof details.mission.context === "string"
        ? details.mission.context
        : JSON.stringify(details.mission.context ?? "");
    const nextContextStr = queryResult.grounded_prompt_block
      ? [existingContextStr.trim(), queryResult.grounded_prompt_block]
          .filter((s) => s.length > 0)
          .join("\n\n")
      : existingContextStr;

    const groundingPayload = {
      bound_collection_ids: queryResult.collection_ids,
      query: queryResult.query,
      grounded_prompt_block: queryResult.grounded_prompt_block,
      citations: queryResult.hits.map((h) => ({
        citation_anchor: h.citation_anchor,
        document_id: h.document_id,
        document_title: h.document_title,
        chunk_id: h.chunk_id,
        section_heading: h.section_heading,
        source_uri: h.source_uri,
        chunk_sha256: h.chunk_sha256,
        relevance_score: h.relevance_score
      })),
      grounded_at: queryResult.executed_at
    };

    const nextContext: Record<string, unknown> = {
      raw_context: nextContextStr,
      knowledge_grounding: groundingPayload
    };

    if (
      details.mission.status === "draft" ||
      details.mission.status === "ready" ||
      details.mission.status === "paused"
    ) {
      this.missionControl.updateMission({
        principal,
        mission_id: params.mission_id,
        context: nextContextStr
      });
    }

    return {
      bindings,
      query_result: queryResult,
      updated_mission_context: nextContext
    };
  }

  public verifyMissionArtifactCitations(
    principal: TenantPrincipal,
    params: {
      mission_id: string;
      artifact_id?: string;
      project_id: string;
    }
  ): CitationVerificationReport {
    this.authorizeRead(principal, params.project_id);
    const details = this.missionControl.getMissionDetails({
      principal,
      mission_id: params.mission_id
    });

    const artifacts = details.artifacts ?? [];
    const targetArtifact = params.artifact_id
      ? artifacts.find((a) => a.id === params.artifact_id)
      : artifacts.find((a) => a.id === details.mission.final_artifact_id) ??
        artifacts[artifacts.length - 1];

    if (!targetArtifact) {
      throw new KosmoraKnowledgeVaultError(
        `Артефакт для проверки цитирования в миссии '${params.mission_id}' не найден`,
        404,
        "ARTIFACT_NOT_FOUND"
      );
    }

    const bindings = this.listMissionBindings(principal, params.mission_id);
    const boundCollectionIds =
      bindings.length > 0
        ? bindings.map((b) => b.collection_id)
        : this.listCollections(principal, {
            project_id: params.project_id,
            status: "active"
          }).map((c) => c.id);

    const chunkRows = this.store.listKnowledgeChunkRows({
      collection_ids: boundCollectionIds
    });

    const chunkByAnchor = new Map<string, StoredKnowledgeChunkRow>();
    for (const cr of chunkRows) {
      const anchor = `[CIT:${cr.document_id}#${cr.chunk_index}]`;
      chunkByAnchor.set(anchor, cr);
    }

    const artifactText = [targetArtifact.title, targetArtifact.preview ?? "", targetArtifact.content ?? ""].join("\n");
    const anchorMatches = Array.from(
      new Set(artifactText.match(/\[CIT:[A-Za-z0-9_-]+#\d+\]/g) ?? [])
    );

    const verifiedCitations: KnowledgeCitationRecord[] = [];
    const unverifiedAnchors: string[] = [];
    const now = new Date().toISOString();

    for (const anchor of anchorMatches) {
      const matchedChunk = chunkByAnchor.get(anchor);
      if (matchedChunk) {
        const record: StoredKnowledgeCitationRow = {
          id: `kcit_${randomUUID()}`,
          mission_id: params.mission_id,
          task_id: targetArtifact.task_id ?? null,
          artifact_id: targetArtifact.id,
          collection_id: matchedChunk.collection_id,
          document_id: matchedChunk.document_id,
          chunk_id: matchedChunk.id,
          citation_anchor: anchor,
          quote_snippet: matchedChunk.content.slice(0, 180),
          relevance_score: 1.0,
          verified: 1,
          created_at: now
        };
        this.store.insertKnowledgeCitationRow(record);
        verifiedCitations.push(this.rowToCitation(record));
      } else {
        unverifiedAnchors.push(anchor);
      }
    }

    // Also support implicit source URI or keyword grounding if no explicit [CIT:...] anchors were typed
    if (verifiedCitations.length === 0 && unverifiedAnchors.length === 0) {
      const implicitQuery = this.queryKnowledge(principal, {
        project_id: params.project_id,
        collection_ids: boundCollectionIds,
        query: artifactText.slice(0, 400),
        top_k: 3,
        min_relevance_score: 0.25
      });
      for (const hit of implicitQuery.hits) {
        const record: StoredKnowledgeCitationRow = {
          id: `kcit_${randomUUID()}`,
          mission_id: params.mission_id,
          task_id: targetArtifact.task_id ?? null,
          artifact_id: targetArtifact.id,
          collection_id: hit.collection_id,
          document_id: hit.document_id,
          chunk_id: hit.chunk_id,
          citation_anchor: hit.citation_anchor,
          quote_snippet: hit.content.slice(0, 180),
          relevance_score: hit.relevance_score,
          verified: 1,
          created_at: now
        };
        this.store.insertKnowledgeCitationRow(record);
        verifiedCitations.push(this.rowToCitation(record));
      }
    }

    const totalChecked = verifiedCitations.length + unverifiedAnchors.length;
    const coverageScore =
      totalChecked > 0
        ? Number(((verifiedCitations.length / totalChecked) * 100).toFixed(2))
        : 0;
    const mandatoryCitation = bindings.some((b) => b.mandatory_citation);
    const passed =
      unverifiedAnchors.length === 0 &&
      (!mandatoryCitation || verifiedCitations.length > 0);

    if (boundCollectionIds.length > 0) {
      this.recordAuditEvent({
        collection_id: boundCollectionIds[0],
        mission_id: params.mission_id,
        tenant_id: principal.tenant_id,
        project_id: params.project_id,
        actor_id: principal.user_id,
        event_type: "citations_verified",
        details: {
          artifact_id: targetArtifact.id,
          verified_count: verifiedCitations.length,
          unverified_count: unverifiedAnchors.length,
          passed
        }
      });
    }

    return {
      mission_id: params.mission_id,
      artifact_id: targetArtifact.id,
      bound_collection_ids: boundCollectionIds,
      verified_citations: verifiedCitations,
      unverified_anchors: unverifiedAnchors,
      citation_coverage_score: coverageScore,
      passed,
      checked_at: now
    };
  }

  public listAuditEvents(
    principal: TenantPrincipal,
    collectionId: string
  ): KnowledgeVaultAuditEvent[] {
    this.getCollection(principal, collectionId);
    const rows = this.store.listKnowledgeVaultAuditEventRows(collectionId);
    return rows.map((r: StoredKnowledgeVaultAuditEventRow) => ({
      id: r.id,
      collection_id: r.collection_id,
      document_id: r.document_id,
      mission_id: r.mission_id,
      tenant_id: r.tenant_id,
      project_id: r.project_id,
      actor_id: r.actor_id,
      event_type: r.event_type as KnowledgeVaultAuditEventType,
      details: JSON.parse(r.details_json || "{}") as Record<string, unknown>,
      created_at: r.created_at
    }));
  }
}
