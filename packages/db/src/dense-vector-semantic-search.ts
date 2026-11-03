import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  extractMemoryEntities,
  normalizeStem,
  type ExtractedEntity,
  type MemoryEntryKind,
  type MemoryScope
} from "./context-memory-hybrid-search.ts";

export const VECTOR_DIMENSION = 64;

/**
 * Deterministic pseudo-random number generator (Mulberry32) seeded by an integer.
 * Produces reproducible pseudo-random projections across Node/OS environments.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a deterministic projection basis of size [4096, VECTOR_DIMENSION]

const BILINGUAL_SYNONYM_GROUPS: string[][] = [
  ["бюджет", "лимит", "стоимость", "расход", "затрат", "деньги", "цена", "потолок", "budget", "limit", "cost", "price", "spend"],
  ["срок", "дедлайн", "дата", "расписание", "график", "deadline", "due", "schedule", "date", "timeline"],
  ["сервер", "хост", "впс", "деплой", "выкладка", "vps", "server", "host", "deploy", "release"],
  ["память", "воспоминание", "заметка", "контекст", "профиль", "memory", "note", "context", "profile", "recall"],
  ["папка", "хранилище", "сейф", "файл", "диск", "архив", "бэкап", "folder", "vault", "workspace", "drive", "backup", "archive"],
  ["ключ", "токен", "пароль", "секрет", "доступ", "авторизация", "key", "token", "password", "secret", "auth", "oauth"],
  ["ошибка", "сбой", "падение", "тест", "проверка", "error", "failure", "bug", "test", "check", "ci"],
  ["модель", "провайдер", "окно", "контекстное", "токен", "model", "provider", "window", "token", "context"]
];

const HASH_BUCKETS = 2048;
const PROJECTION_MATRIX = new Float32Array(HASH_BUCKETS * VECTOR_DIMENSION);
{
  const rng = mulberry32(0xdeadbeef);
  for (let i = 0; i < PROJECTION_MATRIX.length; i++) {
    // Standard normal distribution via Box-Muller transform
    const u1 = Math.max(1e-7, rng());
    const u2 = rng();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    PROJECTION_MATRIX[i] = z;
  }
}

function stringToHashBucket(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h % HASH_BUCKETS;
}

/**
 * Computes a deterministic 64-dimensional dense semantic vector embedding (L2-normalized)
 * for arbitrary multilingual (Cyrillic + Latin + code/numbers) text using subword n-gram
 * random orthogonal projection (Johnson-Lindenstrauss lemma).
 * Zero external network, zero binary deps, 100% offline.
 */
export function generateDenseSemanticVector(text: string): Float32Array {
  const vec = new Float32Array(VECTOR_DIMENSION);
  const clean = String(text ?? "").normalize("NFKC").toLowerCase().trim();
  if (!clean) return vec;

  const words = clean.match(/[\p{L}\p{N}_#-]+/gu) ?? [];
  const tokenCounts = new Map<number, number>();

  const addTokenWeight = (tokenStr: string, weight: number) => {
    const bucket = stringToHashBucket(tokenStr);
    tokenCounts.set(bucket, (tokenCounts.get(bucket) ?? 0) + weight);
  };

  // 1. Whole words and morphological stems
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    addTokenWeight(w, 2.0);
    const stem = normalizeStem(w);
    if (stem !== w) {
      addTokenWeight(stem, 1.5);
    }
    // Word bigrams for local semantic context
    if (i < words.length - 1) {
      addTokenWeight(`${w}_${words[i + 1]}`, 1.2);
    }
  }

  // 2. Bilingual semantic synonym group anchoring
  for (let g = 0; g < BILINGUAL_SYNONYM_GROUPS.length; g++) {
    const group = BILINGUAL_SYNONYM_GROUPS[g];
    let matchedInGroup = 0;
    for (const w of words) {
      const stem = normalizeStem(w);
      if (group.some((syn) => syn === w || normalizeStem(syn) === stem)) {
        matchedInGroup++;
      }
    }
    if (matchedInGroup > 0) {
      addTokenWeight(`syn:group_${g}`, 4.0 * Math.min(matchedInGroup, 3));
    }
  }

  // 3. Character 3-grams for typo and inflection tolerance
  const compact = clean.replace(/\s+/g, " ");
  for (let i = 0; i <= compact.length - 3; i++) {
    addTokenWeight(`3g:${compact.slice(i, i + 3)}`, 0.6);
  }

  // 3. Project token frequency distribution through the orthogonal basis
  for (const [bucket, weight] of tokenCounts.entries()) {
    const matrixRowOffset = bucket * VECTOR_DIMENSION;
    for (let d = 0; d < VECTOR_DIMENSION; d++) {
      vec[d] += weight * PROJECTION_MATRIX[matrixRowOffset + d];
    }
  }

  // 4. L2 Normalization (unit vector)
  let sumSq = 0;
  for (let d = 0; d < VECTOR_DIMENSION; d++) {
    sumSq += vec[d] * vec[d];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-6) {
    for (let d = 0; d < VECTOR_DIMENSION; d++) {
      vec[d] /= norm;
    }
  }

  return vec;
}

export function computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-6) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

export interface DenseSearchCandidate {
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
  denseVector: Float32Array;
}

export interface DenseHybridSearchResult {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  kind: MemoryEntryKind;
  scores: {
    denseCosineScore: number;
    sparseLexicalScore: number;
    entityBoost: number;
    fusedRrfScore: number;
  };
  matchedEntities: ExtractedEntity[];
}

/**
 * Storage and Search Coordinator for Dense Vector Embeddings in SQLite.
 * Pairs with Sparse FTS5 and entity matching via Reciprocal Rank Fusion (RRF, k=60).
 */
export class DenseVectorSemanticSearch {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS context_memory_dense_vectors (
        entry_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        vector_blob TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS context_memory_dense_vectors_owner_idx
        ON context_memory_dense_vectors(owner_id, updated_at DESC);
    `);
  }

  indexMemoryEntryVector(entry: {
    id: string;
    ownerId: string;
    title: string;
    content: string;
  }): Float32Array {
    const fullText = `${entry.title}\n${entry.content}`;
    const vec = generateDenseSemanticVector(fullText);
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const blob = buf.toString("base64");
    const sha = createHash("sha256").update(buf).digest("hex");
    const now = new Date().toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO context_memory_dense_vectors (entry_id, owner_id, vector_blob, dimension, sha256, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           owner_id = excluded.owner_id,
           vector_blob = excluded.vector_blob,
           sha256 = excluded.sha256,
           updated_at = excluded.updated_at`
      )
      .run(entry.id, entry.ownerId, blob, VECTOR_DIMENSION, sha, now);

    return vec;
  }

  getEntryVector(entryId: string, ownerId: string): Float32Array | null {
    const row = this.sqlite
      .prepare(
        "SELECT vector_blob, dimension FROM context_memory_dense_vectors WHERE entry_id = ? AND owner_id = ?"
      )
      .get(entryId, ownerId) as { vector_blob: Buffer; dimension: number } | undefined;

    if (!row || !row.vector_blob) return null;
    const buf = Buffer.isBuffer(row.vector_blob) ? row.vector_blob : Buffer.from(String(row.vector_blob), "base64");
    return new Float32Array(buf.buffer, buf.byteOffset, row.dimension);
  }

  /**
   * Performs true Dense + Sparse RRF hybrid search across indexed memory entries.
   */
  hybridSearch(options: {
    ownerId: string;
    query: string;
    topK?: number;
    permittedProjectIds?: string[];
    permittedChatIds?: string[];
  }): DenseHybridSearchResult[] {
    const topK = Math.min(Math.max(options.topK ?? 10, 1), 50);
    const query = options.query.trim();
    if (!query) return [];

    const queryVec = generateDenseSemanticVector(query);
    const queryEntities = extractMemoryEntities(query);
    const queryWords = (query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).map(
      normalizeStem
    );

    const rows = this.sqlite
      .prepare(
        `SELECT e.id, e.owner_id, e.scope, e.chat_id, e.project_id, e.kind, e.title, e.content,
                e.pinned, e.version, e.source_json, e.updated_at, v.vector_blob
         FROM context_memory_entries e
         LEFT JOIN context_memory_dense_vectors v ON v.entry_id = e.id AND v.owner_id = e.owner_id
         WHERE e.owner_id = ?
         ORDER BY e.pinned DESC, e.updated_at DESC`
      )
      .all(options.ownerId) as Array<{
      id: string;
      owner_id: string;
      scope: MemoryScope;
      chat_id: string | null;
      project_id: string | null;
      kind: MemoryEntryKind;
      title: string;
      content: string;
      pinned: number;
      version: number;
      source_json: string;
      updated_at: string;
      vector_blob: Buffer | null;
    }>;

    const scored: Array<{
      row: (typeof rows)[0];
      denseCosineScore: number;
      sparseLexicalScore: number;
      entityBoost: number;
      matchedEntities: ExtractedEntity[];
    }> = [];

    for (const r of rows) {
      let denseScore = 0;
      if (r.vector_blob) {
        const buf = Buffer.isBuffer(r.vector_blob) ? r.vector_blob : Buffer.from(String(r.vector_blob), "base64");
        const entryVec = new Float32Array(buf.buffer, buf.byteOffset, VECTOR_DIMENSION);
        denseScore = computeCosineSimilarity(queryVec, entryVec);
      } else {
        // Fallback compute on the fly if not indexed yet
        const entryVec = generateDenseSemanticVector(`${r.title}\n${r.content}`);
        denseScore = computeCosineSimilarity(queryVec, entryVec);
      }

      // Sparse Lexical Score (token stem overlap)
      const candWords = `${r.title} ${r.content}`
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu) ?? [];
      const candStems = new Set(candWords.map(normalizeStem));
      let overlap = 0;
      for (const qw of queryWords) {
        if (candStems.has(qw)) overlap++;
      }
      const sparseScore = queryWords.length > 0 ? overlap / queryWords.length : 0;

      // Entity Match Boost
      const candEntities = extractMemoryEntities(`${r.title} ${r.content}`);
      const matchedEntities: ExtractedEntity[] = [];
      for (const qe of queryEntities) {
        if (candEntities.some((ce) => ce.kind === qe.kind && ce.normalized === qe.normalized)) {
          matchedEntities.push(qe);
        }
      }
      const entityBoost = queryEntities.length > 0 ? matchedEntities.length / queryEntities.length : 0;

      scored.push({
        row: r,
        denseCosineScore: Math.max(0, denseScore),
        sparseLexicalScore: sparseScore,
        entityBoost,
        matchedEntities
      });
    }

    // Rank across dense and sparse ranks for RRF fusion (k = 60)
    const byDense = [...scored].sort((a, b) => b.denseCosineScore - a.denseCosineScore);
    const bySparse = [...scored].sort((a, b) => b.sparseLexicalScore - a.sparseLexicalScore);

    const denseRankMap = new Map<string, number>();
    byDense.forEach((item, idx) => denseRankMap.set(item.row.id, idx + 1));
    const sparseRankMap = new Map<string, number>();
    bySparse.forEach((item, idx) => sparseRankMap.set(item.row.id, idx + 1));

    const K_RRF = 60;
    const results: DenseHybridSearchResult[] = scored.map((item) => {
      const dRank = denseRankMap.get(item.row.id) ?? scored.length;
      const sRank = sparseRankMap.get(item.row.id) ?? scored.length;
      const rrfDense = 1 / (K_RRF + dRank);
      const rrfSparse = 1 / (K_RRF + sRank);
      const pinnedBoost = item.row.pinned === 1 ? 0.05 : 0;
      const fusedRrfScore = Number(
        (rrfDense + rrfSparse + item.entityBoost * 0.02 + pinnedBoost).toFixed(6)
      );

      return {
        id: item.row.id,
        title: item.row.title,
        content: item.row.content,
        pinned: item.row.pinned === 1,
        kind: item.row.kind,
        scores: {
          denseCosineScore: Number(item.denseCosineScore.toFixed(4)),
          sparseLexicalScore: Number(item.sparseLexicalScore.toFixed(4)),
          entityBoost: Number(item.entityBoost.toFixed(4)),
          fusedRrfScore
        },
        matchedEntities: item.matchedEntities
      };
    });

    results.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.scores.fusedRrfScore - a.scores.fusedRrfScore;
    });

    return results.slice(0, topK);
  }
}
