import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type MemoryEntryKind = "fact" | "preference" | "decision" | "constraint" | "hypothesis";
export type MemoryScope = "personal" | "chat" | "project";

export interface ExtractedEntity {
  kind: "date" | "money_or_number" | "identifier" | "person_or_project";
  raw: string;
  normalized: string;
}

export interface HybridQueryPlan {
  originalQuery: string;
  normalizedQuery: string;
  lexicalTokens: string[];
  expandedStems: string[];
  ftsMatchExpression: string;
  entities: ExtractedEntity[];
}

export interface HybridMemoryHit {
  id: string;
  ownerId: string;
  scope: MemoryScope;
  chatId: string | null;
  projectId: string | null;
  kind: MemoryEntryKind;
  title: string;
  content: string;
  pinned: boolean;
  version: number;
  source: Record<string, unknown>;
  updatedAt: string;
  scores: {
    lexicalScore: number;
    semanticScore: number;
    entityBoost: number;
    pinnedBoost: number;
    rrfScore: number;
  };
  matchedEntities: ExtractedEntity[];
}

export interface HybridRecallBundle {
  queryPlan: HybridQueryPlan;
  items: HybridMemoryHit[];
  totalCandidates: number;
  omittedCount: number;
  priorityOmitted: boolean;
  payloadBytes: number;
  budgetMaxItems: number;
  budgetMaxBytes: number;
}

const STOP_WORDS = new Set([
  "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то", "все", "она",
  "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за", "бы", "по", "только", "ее",
  "мне", "было", "вот", "от", "меня", "еще", "нет", "о", "из", "ему", "теперь", "когда",
  "the", "and", "for", "with", "that", "this", "from", "into", "what", "when", "where",
  "which", "who", "how", "are", "was", "were", "will", "would", "should", "could", "have", "has"
]);

const BILINGUAL_SYNONYM_GROUPS: string[][] = [
  ["бюджет", "лимит", "стоимость", "расход", "деньги", "цена", "budget", "limit", "cost", "price", "spend"],
  ["срок", "дедлайн", "дата", "расписание", "график", "deadline", "due", "schedule", "date", "timeline"],
  ["сервер", "хост", "впс", "деплой", "выкладка", "vps", "server", "host", "deploy", "release"],
  ["память", "воспоминание", "заметка", "контекст", "профиль", "memory", "note", "context", "profile", "recall"],
  ["папка", "хранилище", "сейф", "файл", "диск", "архив", "бэкап", "folder", "vault", "workspace", "drive", "backup", "archive"],
  ["ключ", "токен", "пароль", "секрет", "доступ", "авторизация", "key", "token", "password", "secret", "auth", "oauth"],
  ["ошибка", "сбой", "падение", "тест", "проверка", "error", "failure", "bug", "test", "check", "ci"],
  ["модель", "провайдер", "окно", "контекстное", "токен", "model", "provider", "window", "token", "context"]
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?KEY-----/,
  /\b(?:password|passwd|пароль|secret_key|api_key|access_token)\s*[:=]\s*\S+/i
];

export function containsSensitiveSecret(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

export function normalizeStem(word: string): string {
  const clean = word.normalize("NFKC").toLowerCase().trim();
  if (clean.length <= 3) return clean;
  // Russian morphological suffix stripping
  const ruStripped = clean.replace(
    /(?:ами|ями|ого|его|ому|ему|ыми|ими|ах|ях|ов|ев|ей|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ем|им|ом|ам|ям|ать|ять|ить|еть|уть|ться|тся|ние|ния|нию|нием|ость|ости|а|я|о|е|ы|и|у|ю)$/u,
    ""
  );
  if (ruStripped.length >= 3) return ruStripped;
  // English suffix stripping
  const enStripped = clean.replace(/(?:ingly|edly|ings|ing|ed|ies|es|s|tion|tions|ment|ments)$/u, "");
  return enStripped.length >= 3 ? enStripped : clean;
}

export function extractMemoryEntities(text: string): ExtractedEntity[] {
  const normalizedText = text.normalize("NFKC");
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const pushUnique = (kind: ExtractedEntity["kind"], raw: string, normalized: string) => {
    const key = `${kind}:${normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ kind, raw, normalized });
    }
  };

  // 1. ISO and dotted dates + Russian month dates
  const dateRegex =
    /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{2}\.\d{4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)\b/giu;
  for (const match of normalizedText.matchAll(dateRegex)) {
    pushUnique("date", match[0], match[0].toLowerCase().replace(/\s+/g, " "));
  }

  // 2. Identifiers (PR numbers, migrations, paths, env vars, ports)
  const idRegex =
    /(?:#\d{2,5}\b|\bPR\s*#?\d{2,5}\b|\b00\d{2}_[a-z0-9_]+(?:\.sql)?\b|\b[A-Z]{2,}_[A-Z0-9_]{2,}\b|\b(?:apps|packages|desktop|docs|scripts)\/[A-Za-z0-9_./-]+|\bport\s+\d{3,5}\b|\bпорт[аеу]?\s+\d{3,5}\b)/giu;
  for (const match of normalizedText.matchAll(idRegex)) {
    const raw = match[0];
    const norm = raw
      .toLowerCase()
      .replace(/^pr\s*#?/i, "#")
      .replace(/^порт[аеу]?\s+/i, "port ")
      .trim();
    pushUnique("identifier", raw, norm);
  }

  // 3. Money, token budgets, byte limits, exact metrics
  const numberRegex =
    /(?:\$\s*\d+(?:[.,]\d+)?|\b\d[\d\s_.,]*\s*(?:токенов|токена|токен|tokens?|байт|bytes?|mib|мб|гб|gb|kb|кб|фрагментов|фрагмента|записей|минут|часов|дней|%|руб|usd|eur)\b|\b\d{3,10}\b)/giu;
  for (const match of normalizedText.matchAll(numberRegex)) {
    const raw = match[0].trim();
    const digits = raw.replace(/[\s_]/g, "").toLowerCase();
    pushUnique("money_or_number", raw, digits);
  }

  // 4. Named project / component entities
  const projectRegex =
    /\b(?:Kosmora|Koswork|CheapVibeCode|Nexus-OS|Google\s+Drive|Local\s+Vault|SQLite|Chromium|OwnerMediaBudget|ContextMemoryStore)\b/giu;
  for (const match of normalizedText.matchAll(projectRegex)) {
    pushUnique("person_or_project", match[0], match[0].toLowerCase().replace(/\s+/g, " "));
  }

  return entities;
}

export function buildHybridQueryPlan(query: string): HybridQueryPlan {
  const originalQuery = String(query ?? "").slice(0, 500);
  const normalizedQuery = originalQuery.normalize("NFKC").toLowerCase().trim();
  const rawWords = normalizedQuery.match(/[\p{L}\p{N}_#-]+/gu) ?? [];

  const lexicalTokens: string[] = [];
  const stemSet = new Set<string>();

  for (const w of rawWords) {
    const clean = w.replace(/^[#-]+|[#-]+$/g, "");
    if (!clean || STOP_WORDS.has(clean)) continue;
    if (!lexicalTokens.includes(clean)) {
      lexicalTokens.push(clean);
    }
    const stem = normalizeStem(clean);
    stemSet.add(stem);

    for (const group of BILINGUAL_SYNONYM_GROUPS) {
      if (group.some((syn) => syn === clean || normalizeStem(syn) === stem)) {
        for (const syn of group) {
          stemSet.add(normalizeStem(syn));
        }
      }
    }
  }

  const ftsWords = lexicalTokens.slice(0, 12).map((w) => `"${w.replace(/"/g, "")}"*`);
  const ftsMatchExpression = ftsWords.join(" OR ");
  const entities = extractMemoryEntities(originalQuery);

  return {
    originalQuery,
    normalizedQuery,
    lexicalTokens,
    expandedStems: Array.from(stemSet),
    ftsMatchExpression,
    entities
  };
}

function buildCharTrigrams(text: string): Map<string, number> {
  const clean = `  ${text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()}  `;
  const counts = new Map<string, number>();
  for (let i = 0; i <= clean.length - 3; i++) {
    const tri = clean.slice(i, i + 3);
    counts.set(tri, (counts.get(tri) ?? 0) + 1);
  }
  return counts;
}

function cosineSimilarityMap(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, va] of a.entries()) {
    normA += va * va;
    const vb = b.get(k);
    if (vb !== undefined) {
      dot += va * vb;
    }
  }
  for (const vb of b.values()) {
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function computeSemanticSimilarity(plan: HybridQueryPlan, candidateText: string): number {
  if (!plan.normalizedQuery) return 0;
  const candidateNorm = candidateText.normalize("NFKC").toLowerCase();
  const candidateWords = candidateNorm.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const candidateStems = new Set(candidateWords.map(normalizeStem));

  // Stem & synonym overlap score
  let matchedStems = 0;
  for (const stem of plan.expandedStems) {
    if (candidateStems.has(stem) || candidateNorm.includes(stem)) {
      matchedStems++;
    }
  }
  const stemCoverage =
    plan.expandedStems.length > 0 ? matchedStems / Math.min(plan.expandedStems.length, 8) : 0;

  // Character 3-gram cosine similarity
  const queryTri = buildCharTrigrams(
    [plan.normalizedQuery, ...plan.expandedStems.slice(0, 10)].join(" ")
  );
  const candTri = buildCharTrigrams(candidateNorm);
  const trigramSim = cosineSimilarityMap(queryTri, candTri);

  return Math.min(1, stemCoverage * 0.65 + trigramSim * 0.35);
}

export function computeLexicalScore(plan: HybridQueryPlan, title: string, content: string): number {
  if (plan.lexicalTokens.length === 0) return 0;
  const titleLower = title.normalize("NFKC").toLowerCase();
  const contentLower = content.normalize("NFKC").toLowerCase();
  let score = 0;
  for (const token of plan.lexicalTokens) {
    if (titleLower.includes(token)) score += 2.0;
    if (contentLower.includes(token)) score += 1.0;
  }
  return score / (plan.lexicalTokens.length * 3.0);
}

export interface HybridRecallOptions {
  ownerId: string;
  query: string;
  targetKind?: "chat" | "project" | "personal";
  targetId?: string;
  chatId?: string | null;
  projectId?: string | null;
  includePersonal?: boolean;
  permittedChatIds?: string[];
  permittedProjectIds?: string[];
  temporaryMode?: boolean;
  maxItems?: number;
  maxBytes?: number;
  nowIso?: string;
}

type RawMemoryRow = {
  id: string;
  owner_id: string;
  scope: MemoryScope;
  chat_id: string | null;
  project_id: string | null;
  kind: MemoryEntryKind;
  title: string;
  content: string;
  pinned: number;
  expires_at: string | null;
  source_json: string;
  version: number;
  updated_at: string;
};

export class ContextMemoryHybridSearch {
  constructor(private readonly sqlite: DatabaseSync) {}

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS context_memory_entries (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('personal', 'chat', 'project')),
        chat_id TEXT,
        project_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'decision', 'constraint', 'hypothesis')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        source_chat_message_id TEXT,
        source_project_message_id TEXT,
        source_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        creation_key TEXT,
        creation_sha256 TEXT
      );
      CREATE TABLE IF NOT EXISTS context_memory_settings (
        owner_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        chat_id TEXT,
        project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        use_personal INTEGER NOT NULL DEFAULT 1,
        source_chat_ids_json TEXT NOT NULL DEFAULT '[]',
        project_ids_json TEXT NOT NULL DEFAULT '[]',
        temporary_mode INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (owner_id, target_kind, target_id)
      );
    `);
  }

  recall(options: HybridRecallOptions): HybridRecallBundle {
    this.ensureSchema();
    const budgetMaxItems = Math.min(Math.max(options.maxItems ?? 32, 1), 32);
    const budgetMaxBytes = Math.min(Math.max(options.maxBytes ?? 6000, 1000), 12000);
    const queryPlan = buildHybridQueryPlan(options.query);

    // In temporary/ephemeral mode, recall is strictly disabled unless explicitly permitted
    if (options.temporaryMode) {
      return {
        queryPlan,
        items: [],
        totalCandidates: 0,
        omittedCount: 0,
        priorityOmitted: false,
        payloadBytes: 2,
        budgetMaxItems,
        budgetMaxBytes
      };
    }

    const nowIso = options.nowIso ?? new Date().toISOString();
    const includePersonal = options.includePersonal ?? true;
    const allowedChats = new Set<string>(options.permittedChatIds ?? []);
    if (options.chatId) allowedChats.add(options.chatId);
    const allowedProjects = new Set<string>(options.permittedProjectIds ?? []);
    if (options.projectId) allowedProjects.add(options.projectId);

    const rows = this.sqlite
      .prepare(
        `SELECT id, owner_id, scope, chat_id, project_id, kind, title, content, pinned, expires_at, source_json, version, updated_at
         FROM context_memory_entries
         WHERE owner_id = ?
         ORDER BY pinned DESC, updated_at DESC, id ASC`
      )
      .all(options.ownerId) as RawMemoryRow[];

    // Filter by scope permission, expiration, and sensitive content guard
    const eligibleRows = rows.filter((row) => {
      if (row.expires_at && row.expires_at <= nowIso) return false;
      if (containsSensitiveSecret(row.title) || containsSensitiveSecret(row.content)) return false;
      if (row.scope === "personal") return includePersonal;
      if (row.scope === "chat") return Boolean(row.chat_id && allowedChats.has(row.chat_id));
      if (row.scope === "project") return Boolean(row.project_id && allowedProjects.has(row.project_id));
      return false;
    });

    // Score each candidate across lexical, semantic, entity, and pinned dimensions
    const scoredCandidates: Array<{
      row: RawMemoryRow;
      lexicalScore: number;
      semanticScore: number;
      entityBoost: number;
      pinnedBoost: number;
      matchedEntities: ExtractedEntity[];
    }> = [];

    for (const row of eligibleRows) {
      const fullText = `${row.title}\n${row.content}`;
      const lexicalScore = computeLexicalScore(queryPlan, row.title, row.content);
      const semanticScore = computeSemanticSimilarity(queryPlan, fullText);
      const candEntities = extractMemoryEntities(fullText);

      const matchedEntities: ExtractedEntity[] = [];
      for (const qe of queryPlan.entities) {
        if (candEntities.some((ce) => ce.kind === qe.kind && ce.normalized === qe.normalized)) {
          matchedEntities.push(qe);
        }
      }
      const entityBoost =
        queryPlan.entities.length > 0
          ? matchedEntities.length / queryPlan.entities.length
          : 0;
      const pinnedBoost = row.pinned === 1 || row.kind === "constraint" ? 1.0 : 0.0;

      // Include if pinned/constraint OR has meaningful lexical/semantic/entity signal OR query is empty
      if (
        pinnedBoost > 0 ||
        !queryPlan.normalizedQuery ||
        lexicalScore > 0 ||
        semanticScore >= 0.08 ||
        entityBoost > 0
      ) {
        scoredCandidates.push({
          row,
          lexicalScore,
          semanticScore,
          entityBoost,
          pinnedBoost,
          matchedEntities
        });
      }
    }

    // Compute Reciprocal Rank Fusion (RRF, k = 60) across lexical rank and semantic+entity rank
    const byLexical = [...scoredCandidates].sort(
      (a, b) => b.lexicalScore - a.lexicalScore || b.pinnedBoost - a.pinnedBoost
    );
    const bySemantic = [...scoredCandidates].sort(
      (a, b) =>
        b.semanticScore + b.entityBoost * 0.5 - (a.semanticScore + a.entityBoost * 0.5) ||
        b.pinnedBoost - a.pinnedBoost
    );

    const lexicalRank = new Map<string, number>();
    byLexical.forEach((item, idx) => lexicalRank.set(item.row.id, idx + 1));
    const semanticRank = new Map<string, number>();
    bySemantic.forEach((item, idx) => semanticRank.set(item.row.id, idx + 1));

    const K_RRF = 60;
    const hits: HybridMemoryHit[] = scoredCandidates.map((c) => {
      const lRank = lexicalRank.get(c.row.id) ?? scoredCandidates.length;
      const sRank = semanticRank.get(c.row.id) ?? scoredCandidates.length;
      const rrfBase = 1 / (K_RRF + lRank) + 1 / (K_RRF + sRank);
      const rrfScore = Number(
        (
          rrfBase +
          c.pinnedBoost * 0.05 +
          c.entityBoost * 0.025 +
          c.semanticScore * 0.015 +
          c.lexicalScore * 0.015
        ).toFixed(6)
      );

      let parsedSource: Record<string, unknown> = {};
      try {
        parsedSource = JSON.parse(c.row.source_json || "{}") as Record<string, unknown>;
      } catch {
        parsedSource = {};
      }

      return {
        id: c.row.id,
        ownerId: c.row.owner_id,
        scope: c.row.scope,
        chatId: c.row.chat_id,
        projectId: c.row.project_id,
        kind: c.row.kind,
        title: c.row.title,
        content: c.row.content,
        pinned: c.row.pinned === 1,
        version: c.row.version,
        source: parsedSource,
        updatedAt: c.row.updated_at,
        scores: {
          lexicalScore: Number(c.lexicalScore.toFixed(4)),
          semanticScore: Number(c.semanticScore.toFixed(4)),
          entityBoost: Number(c.entityBoost.toFixed(4)),
          pinnedBoost: c.pinnedBoost,
          rrfScore
        },
        matchedEntities: c.matchedEntities
      };
    });

    hits.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (b.scores.rrfScore !== a.scores.rrfScore) return b.scores.rrfScore - a.scores.rrfScore;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    // Pack into strict UTF-8 byte budget and fragment limit
    const selected: HybridMemoryHit[] = [];
    let currentBytes = 2; // "[]"
    let priorityOmitted = false;

    for (const hit of hits) {
      const serialized = JSON.stringify({
        id: hit.id,
        scope: hit.scope,
        kind: hit.kind,
        title: hit.title,
        content: hit.content,
        pinned: hit.pinned,
        source: hit.source
      });
      const entryBytes = Buffer.byteLength(serialized, "utf8") + (selected.length > 0 ? 1 : 0);

      if (selected.length >= budgetMaxItems || currentBytes + entryBytes > budgetMaxBytes) {
        if (hit.pinned || hit.kind === "constraint") {
          priorityOmitted = true;
        }
        continue;
      }

      selected.push(hit);
      currentBytes += entryBytes;
    }

    return {
      queryPlan,
      items: selected,
      totalCandidates: hits.length,
      omittedCount: hits.length - selected.length,
      priorityOmitted,
      payloadBytes: currentBytes,
      budgetMaxItems,
      budgetMaxBytes
    };
  }
}

export interface ResponseMemoryCitation {
  memoryId: string;
  title: string;
  kind: MemoryEntryKind;
  scope: MemoryScope;
  verbatimQuote: string | null;
  sourceReference: string | null;
  sourceSha256: string;
  previewPath: string;
}

export function buildResponseMemoryCitations(
  usedEntries: HybridMemoryHit[],
  responseText: string
): ResponseMemoryCitation[] {
  const responseNorm = responseText.normalize("NFKC").toLowerCase();
  const citations: ResponseMemoryCitation[] = [];

  for (const entry of usedEntries) {
    const entryEntities = extractMemoryEntities(`${entry.title} ${entry.content}`);
    const titleWords = (entry.title.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
    const contentWords = (entry.content.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);

    const hasEntityMatch = entryEntities.some((e) => responseNorm.includes(e.normalized));
    const matchedWords = [...titleWords, ...contentWords].filter((w) =>
      responseNorm.includes(normalizeStem(w))
    );

    if (entry.pinned || hasEntityMatch || matchedWords.length >= 1) {
      const quote =
        typeof entry.source.quote === "string"
          ? entry.source.quote
          : typeof entry.source.excerpt === "string"
            ? entry.source.excerpt
            : entry.content.slice(0, 240);
      const reference =
        typeof entry.source.reference === "string"
          ? entry.source.reference
          : typeof entry.source.messageId === "string"
            ? entry.source.messageId
            : null;
      const sourceSha256 =
        typeof entry.source.sha256 === "string"
          ? entry.source.sha256
          : createHash("sha256").update(quote, "utf8").digest("hex");

      citations.push({
        memoryId: entry.id,
        title: entry.title,
        kind: entry.kind,
        scope: entry.scope,
        verbatimQuote: quote,
        sourceReference: reference,
        sourceSha256,
        previewPath: `/personal-settings?memoryPreview=${encodeURIComponent(entry.id)}`
      });
    }
  }

  return citations;
}
