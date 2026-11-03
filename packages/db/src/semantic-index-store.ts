import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { MemoryTarget } from "@cosmora/contracts";
import { ContextMemoryStore } from "./context-memory-store.js";
import type { SemanticSource } from "./semantic-memory-types.js";

export type IndexProgress = {
  phase: number;
  after_id: string;
  generation: number;
  state: "building" | "ready" | "capacity" | "blocked";
};
export type IndexedSource = {
  id: string;
  fingerprint: string;
  next_offset: number;
  chunk_width: number;
  complete: number;
};
export const vectorBytes = (vector: readonly number[]) => {
  if (vector.length !== 384 || vector.some((v) => !Number.isFinite(v)))
    throw new Error("SEMANTIC_VECTOR_INVALID");
  const norm = vector.reduce((n, v) => n + v * v, 0);
  if (Math.abs(norm - 1) > 0.01) throw new Error("SEMANTIC_VECTOR_INVALID");
  const blob = Buffer.alloc(1536);
  vector.forEach((v, i) => blob.writeFloatLE(v, i * 4));
  return blob;
};
export const scoreSemanticVector = (blob: Uint8Array, query: readonly number[]) => {
  if (blob.byteLength !== 1536) throw new Error("SEMANTIC_VECTOR_INVALID");
  if (query.length !== 384) throw new Error("SEMANTIC_VECTOR_INVALID");
  const data = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let norm = 0,
    score = 0;
  for (let i = 0; i < 384; i++) {
    const v = data.getFloat32(i * 4, true);
    if (!Number.isFinite(v)) throw new Error("SEMANTIC_VECTOR_INVALID");
    norm += v * v;
    score += v * query[i]!;
  }
  if (Math.abs(norm - 1) > 0.01 || !Number.isFinite(score))
    throw new Error("SEMANTIC_VECTOR_INVALID");
  return Math.max(-1, Math.min(1, score));
};

/** No copied source text. Shared owner/source vectors with target-scoped cursors. */
export class SemanticIndexStore {
  readonly authority: ContextMemoryStore;
  constructor(
    readonly sqlite: DatabaseSync,
    private readonly now = () => Date.now(),
    readonly maxOwnerChunks = 100000
  ) {
    if (!Number.isSafeInteger(maxOwnerChunks) || maxOwnerChunks < 1)
      throw new Error("SEMANTIC_CAPACITY");
    this.authority = new ContextMemoryStore(sqlite, now);
  }
  nextTarget(
    after: readonly [string, string, string]
  ): { owner: string; target: MemoryTarget } | null {
    const sql =
      "SELECT s.owner_id,s.target_kind,s.target_id FROM context_memory_settings s LEFT JOIN general_chats c ON s.target_kind='chat' AND c.id=s.target_id AND c.owner_id=s.owner_id LEFT JOIN projects p ON s.target_kind='project' AND p.id=s.target_id AND p.owner_id=s.owner_id WHERE s.enabled=1 AND (c.archived=0 OR p.status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=s.owner_id AND f.state<>'active') AND (s.owner_id,s.target_kind,s.target_id)>(?,?,?) ORDER BY s.owner_id,s.target_kind,s.target_id LIMIT 1";
    const row = this.sqlite.prepare(sql).get(...after) as
      { owner_id: string; target_kind: MemoryTarget["kind"]; target_id: string } | undefined;
    return row
      ? { owner: row.owner_id, target: { kind: row.target_kind, id: row.target_id } }
      : null;
  }
  progress(target: MemoryTarget, owner: string, encoder: string): IndexProgress {
    const { settings } = this.authority.semanticScope(target, owner);
    if (!settings.enabled) throw new Error("MEMORY_DISABLED");
    this.sqlite
      .prepare(
        "INSERT OR IGNORE INTO semantic_index_progress(owner_id,target_kind,target_id,encoder) VALUES(?,?,?,?)"
      )
      .run(owner, target.kind, target.id, encoder);
    return this.sqlite
      .prepare(
        "SELECT phase,after_id,generation,state FROM semantic_index_progress WHERE owner_id=? AND target_kind=? AND target_id=? AND encoder=?"
      )
      .get(owner, target.kind, target.id, encoder) as IndexProgress;
  }
  cached(owner: string, reference: string, encoder: string) {
    return this.sqlite
      .prepare(
        "SELECT id,fingerprint,next_offset,chunk_width,complete FROM semantic_index_sources WHERE owner_id=? AND reference=? AND encoder=?"
      )
      .get(owner, reference, encoder) as IndexedSource | undefined;
  }
  remaining(owner: string) {
    const row = this.sqlite
      .prepare("SELECT count(*) n FROM semantic_index_chunks WHERE owner_id=?")
      .get(owner) as { n: number };
    return Math.max(0, this.maxOwnerChunks - row.n);
  }
  advance(
    target: MemoryTarget,
    owner: string,
    encoder: string,
    progress: IndexProgress,
    after: string,
    phase = progress.phase
  ) {
    this.authority.semanticScope(target, owner);
    this.sqlite
      .prepare(
        "UPDATE semantic_index_progress SET after_id=?,phase=?,state=?,failures=0 WHERE owner_id=? AND target_kind=? AND target_id=? AND encoder=? AND generation=? AND phase=? AND after_id=?"
      )
      .run(
        after,
        phase,
        phase === 3 ? "ready" : "building",
        owner,
        target.kind,
        target.id,
        encoder,
        progress.generation,
        progress.phase,
        progress.after_id
      );
  }
  capacity(
    target: MemoryTarget,
    owner: string,
    encoder: string,
    state: "capacity" | "blocked" | "building" = "capacity"
  ) {
    this.authority.semanticScope(target, owner);
    this.sqlite
      .prepare(
        "UPDATE semantic_index_progress SET state=? WHERE owner_id=? AND target_kind=? AND target_id=? AND encoder=?"
      )
      .run(state, owner, target.kind, target.id, encoder);
  }
  outcome(
    target: MemoryTarget,
    owner: string,
    encoder: string,
    progress: IndexProgress,
    success: boolean
  ) {
    this.authority.semanticScope(target, owner);
    this.sqlite
      .prepare(
        success
          ? "UPDATE semantic_index_progress SET failures=0 WHERE owner_id=? AND target_kind=? AND target_id=? AND encoder=? AND generation=?"
          : "UPDATE semantic_index_progress SET failures=min(3,failures+1),state=CASE WHEN failures+1>=3 THEN 'blocked' ELSE state END WHERE owner_id=? AND target_kind=? AND target_id=? AND encoder=? AND generation=?"
      )
      .run(owner, target.kind, target.id, encoder, progress.generation);
  }
  commit(
    target: MemoryTarget,
    owner: string,
    encoder: string,
    settingsVersion: number,
    snapshot: SemanticSource,
    expectedOffset: number,
    chunks: { start: number; end: number; vector: number[] }[],
    nextOffset: number,
    width: number,
    complete: boolean
  ): boolean {
    const blobs = chunks.map((c) => vectorBytes(c.vector));
    this.sqlite.exec("SAVEPOINT semantic_index_commit");
    try {
      const { settings } = this.authority.semanticScope(target, owner);
      const current = this.authority.semanticSource(target, owner, snapshot.evidence.reference);
      if (
        !settings.enabled ||
        settings.version !== settingsVersion ||
        !current ||
        current.fingerprint !== snapshot.fingerprint
      ) {
        this.sqlite.exec("RELEASE semantic_index_commit");
        return false;
      }
      const old = this.cached(owner, snapshot.evidence.reference, encoder);
      if (
        old &&
        (old.fingerprint !== snapshot.fingerprint ||
          old.next_offset !== expectedOffset ||
          old.complete)
      ) {
        this.sqlite.exec("RELEASE semantic_index_commit");
        return false;
      }
      if (!old && expectedOffset !== 0) {
        this.sqlite.exec("RELEASE semantic_index_commit");
        return false;
      }
      const count = this.sqlite
        .prepare("SELECT count(*) n FROM semantic_index_chunks WHERE owner_id=?")
        .get(owner) as { n: number };
      if (count.n + chunks.length > this.maxOwnerChunks) throw new Error("SEMANTIC_CAPACITY");
      const id = old?.id ?? randomUUID(),
        e = snapshot.evidence,
        s = e.source;
      if (!old)
        this.sqlite
          .prepare(
            "INSERT INTO semantic_index_sources(id,owner_id,reference,encoder,fingerprint,memory_entry_id,general_message_id,project_message_id) VALUES(?,?,?,?,?,?,?,?)"
          )
          .run(
            id,
            owner,
            e.reference,
            encoder,
            snapshot.fingerprint,
            e.kind === "memory" ? e.reference.slice(2) : null,
            s?.kind === "chat_message" ? s.message_id : null,
            s?.kind === "project_message" ? s.message_id : null
          );
      chunks.forEach((c, i) => {
        if (
          !Number.isInteger(c.start) ||
          !Number.isInteger(c.end) ||
          c.start < 0 ||
          c.end <= c.start ||
          c.end > current.text.length
        )
          throw new Error("SEMANTIC_RANGE_INVALID");
        this.sqlite
          .prepare(
            "INSERT INTO semantic_index_chunks(owner_id,source_id,start_utf16,end_utf16,vector) VALUES(?,?,?,?,?)"
          )
          .run(owner, id, c.start, c.end, blobs[i]!);
      });
      if (
        !Number.isInteger(nextOffset) ||
        nextOffset < expectedOffset ||
        nextOffset > current.text.length ||
        !Number.isInteger(width) ||
        width < 1 ||
        width > 600 ||
        (complete && nextOffset !== current.text.length)
      )
        throw new Error("SEMANTIC_RANGE_INVALID");
      this.sqlite
        .prepare(
          "UPDATE semantic_index_sources SET next_offset=?,chunk_width=?,complete=? WHERE id=? AND owner_id=?"
        )
        .run(nextOffset, width, Number(complete), id, owner);
      this.sqlite.exec("RELEASE semantic_index_commit");
      return true;
    } catch (error) {
      this.sqlite.exec("ROLLBACK TO semantic_index_commit; RELEASE semantic_index_commit");
      throw error;
    }
  }
  private scopeSql(target: MemoryTarget, owner: string) {
    const { settings, grants } = this.authority.semanticScope(target, owner);
    const clause =
      " FROM semantic_index_chunks v JOIN semantic_index_sources s ON s.id=v.source_id AND s.owner_id=v.owner_id LEFT JOIN context_memory_entries e ON e.id=s.memory_entry_id LEFT JOIN general_chat_messages g ON g.id=s.general_message_id LEFT JOIN messages p ON p.id=s.project_message_id WHERE v.owner_id=? AND s.encoder=? AND ((s.memory_entry_id IS NOT NULL AND (e.expires_at IS NULL OR julianday(e.expires_at)>julianday(?)) AND ((e.scope='personal' AND ?=1) OR e.chat_id IN (SELECT value FROM json_each(?)) OR e.project_id IN (SELECT value FROM json_each(?)))) OR (s.memory_entry_id IS NULL AND (g.chat_id IN (SELECT value FROM json_each(?)) OR p.project_id IN (SELECT value FROM json_each(?)))))";
    return {
      clause,
      settings,
      args: [
        new Date(this.now()).toISOString(),
        Number(settings.use_personal),
        JSON.stringify(grants.chats),
        JSON.stringify(grants.projects),
        JSON.stringify(grants.chats),
        JSON.stringify(grants.projects)
      ] as const
    };
  }
  rows(target: MemoryTarget, owner: string, encoder: string, after: number, upper: number) {
    const { clause, args, settings } = this.scopeSql(target, owner);
    if (!settings.enabled) return [];
    return this.sqlite
      .prepare(
        "SELECT v.id,s.reference,s.fingerprint,v.start_utf16,v.end_utf16,v.vector" +
          clause +
          " AND v.id>? AND v.id<=? ORDER BY v.id LIMIT 256"
      )
      .all(owner, encoder, ...args, after, upper) as {
      id: number;
      reference: string;
      fingerprint: string;
      start_utf16: number;
      end_utf16: number;
      vector: Uint8Array;
    }[];
  }
  summary(target: MemoryTarget, owner: string, encoder: string) {
    const { clause, args, settings } = this.scopeSql(target, owner);
    if (!settings.enabled) return { indexed_chunks: 0, indexed_sources: 0, upper: 0 };
    return this.sqlite
      .prepare(
        "SELECT count(*) indexed_chunks,count(DISTINCT s.id) indexed_sources,coalesce(max(v.id),0) upper" +
          clause
      )
      .get(owner, encoder, ...args) as {
      indexed_chunks: number;
      indexed_sources: number;
      upper: number;
    };
  }
  sweep(encoder: string) {
    this.sqlite
      .prepare(
        "DELETE FROM semantic_index_sources WHERE encoder<>? OR memory_entry_id IN (SELECT id FROM context_memory_entries WHERE expires_at IS NOT NULL AND julianday(expires_at)<=julianday(?))"
      )
      .run(encoder, new Date(this.now()).toISOString());
    this.sqlite.prepare("DELETE FROM semantic_index_progress WHERE encoder<>?").run(encoder);
  }
  purge(owner: string) {
    this.sqlite.prepare("DELETE FROM semantic_index_sources WHERE owner_id=?").run(owner);
    this.sqlite.prepare("DELETE FROM semantic_index_progress WHERE owner_id=?").run(owner);
  }
}
