import type { DatabaseSync } from "node:sqlite";

/** Read-only projection over the existing general chat and project stores. */
export type ChatHistoryScope = "all" | "general" | "project";
export type ChatHistoryArchive = "active" | "archived" | "all";
export interface ChatHistorySearchFilters {
  query: string;
  ownerId: string;
  scope?: ChatHistoryScope;
  projectId?: string;
  after?: string;
  before?: string;
  archive?: ChatHistoryArchive;
  limit?: number;
  offset?: number;
}
export interface ChatHistorySearchHit {
  scope: "general" | "project";
  chat_id: string;
  project_id: string | null;
  message_id: string | null;
  title: string;
  snippet: string;
  created_at: string;
  archived: boolean;
}
export interface ChatHistorySearchPage {
  items: ChatHistorySearchHit[];
  next_offset: number | null;
}

const safePositive = (value: number | undefined, max: number, fallback: number): number =>
  Number.isInteger(value) && value !== undefined && value >= 0 && value <= max ? value : fallback;

/** FTS5 unicode61: quote each word as a literal, never execute caller-provided MATCH grammar. */
export const ftsLiteralQuery = (input: string): string => {
  const words = input.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((word) => `"${word}"*`).join(" AND ");
};

const SEARCH_SQL = `
 SELECT
  CASE WHEN chat_history_fts.kind IN ('general_title','general_message') THEN 'general' ELSE 'project' END AS scope,
  COALESCE(gc.id, gcmc.id, pc.id, pmc.id) AS chat_id,
  COALESCE(p.id, pp.id) AS project_id,
  CASE WHEN chat_history_fts.kind IN ('general_message','project_message') THEN chat_history_fts.source_id ELSE NULL END AS message_id,
  COALESCE(gc.title, gcmc.title, p.title, pp.title) AS title,
  CASE WHEN chat_history_fts.kind IN ('general_title','project_title')
       THEN snippet(chat_history_fts, 2, '', '', '…', 24)
       ELSE snippet(chat_history_fts, 3, '', '', '…', 24) END AS snippet,
  COALESCE(gm.created_at, pm.created_at, gc.updated_at, p.updated_at) AS created_at,
  CASE WHEN COALESCE(gc.archived, gcmc.archived, 0) = 1
         OR COALESCE(p.status, pp.status, '') = 'ARCHIVED' THEN 1 ELSE 0 END AS archived
 FROM chat_history_fts
 LEFT JOIN general_chats gc ON chat_history_fts.kind='general_title' AND gc.id=chat_history_fts.source_id
 LEFT JOIN general_chat_messages gm ON chat_history_fts.kind='general_message' AND gm.id=chat_history_fts.source_id
 LEFT JOIN general_chats gcmc ON gcmc.id=gm.chat_id AND gcmc.owner_id=gm.owner_id
 LEFT JOIN projects p ON chat_history_fts.kind='project_title' AND p.id=chat_history_fts.source_id
 LEFT JOIN chats pc ON pc.project_id=p.id AND pc.kind='main'
 LEFT JOIN messages pm ON chat_history_fts.kind='project_message' AND pm.id=chat_history_fts.source_id
 LEFT JOIN projects pp ON pp.id=pm.project_id
 LEFT JOIN chats pmc ON pmc.id=pm.chat_id AND pmc.project_id=pm.project_id
 WHERE chat_history_fts MATCH ?
   AND COALESCE(gc.owner_id, gcmc.owner_id, p.owner_id, pp.owner_id) = ?
   AND ( ?='all' OR (CASE WHEN chat_history_fts.kind IN ('general_title','general_message') THEN 'general' ELSE 'project' END)=? )
   AND ( ?='' OR COALESCE(p.id,pp.id,'')=? )
   AND ( ?='all' OR (CASE WHEN COALESCE(gc.archived,gcmc.archived,0)=1
          OR COALESCE(p.status,pp.status,'')='ARCHIVED' THEN 'archived' ELSE 'active' END)=? )
   AND ( ?='' OR COALESCE(gm.created_at,pm.created_at,gc.updated_at,p.updated_at)>=? )
   AND ( ?='' OR COALESCE(gm.created_at,pm.created_at,gc.updated_at,p.updated_at)<=? )
   AND COALESCE(gc.id, gcmc.id, pc.id, pmc.id) IS NOT NULL
 ORDER BY bm25(chat_history_fts, 0.0, 0.0, 4.0, 1.0), created_at DESC, chat_history_fts.rowid DESC
 LIMIT ? OFFSET ?`;

export class ChatHistorySearchStore {
  private readonly sqlite: DatabaseSync;
  constructor(sqlite: DatabaseSync) { this.sqlite = sqlite; }

  search(filters: ChatHistorySearchFilters): ChatHistorySearchPage {
    const raw = filters.query.trim();
    if (!raw || raw.length > 160) return { items: [], next_offset: null };
    const match = ftsLiteralQuery(raw);
    if (!match) return { items: [], next_offset: null };
    const scope = filters.scope ?? "all";
    const archive = filters.archive ?? "active";
    const project = filters.projectId ?? "";
    const after = filters.after ? `${filters.after}T00:00:00.000Z` : "";
    const before = filters.before ? `${filters.before}T23:59:59.999Z` : "";
    const limit = safePositive(filters.limit, 30, 20) || 20;
    const offset = safePositive(filters.offset, 1000, 0);
    const rows = this.sqlite.prepare(SEARCH_SQL).all(
      match, filters.ownerId, scope, scope, project, project,
      archive, archive, after, after, before, before, limit + 1, offset
    ) as unknown as Array<Omit<ChatHistorySearchHit, "archived"> & { archived: number }>;
    return {
      items: rows.slice(0, limit).map((row) => ({
        ...row,
        snippet: row.snippet.slice(0, 350),
        archived: row.archived === 1
      })),
      next_offset: rows.length > limit && offset + limit <= 1000 ? offset + limit : null
    };
  }
}
