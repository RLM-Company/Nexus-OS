import { DatabaseSync } from "node:sqlite";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Jira / Linear-Style Base-62 Lexicographical Fractional Indexing (`LexoRank`) Store.
 * Computes exact lexicographical midpoint strings `between(prevRank, nextRank)` so reordering
 * any item in a list requires updating ONLY that single row (O(1) database writes).
 */
export class LexoRankFractionalOrderStore {
  private readonly sqlite: DatabaseSync;
  private readonly listNamespace: string;

  constructor(sqlite: DatabaseSync, listNamespace = "default_board") {
    this.sqlite = sqlite;
    this.listNamespace = listNamespace;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_lexorank_ordered_items (
        list_namespace TEXT NOT NULL,
        item_id TEXT NOT NULL,
        lexo_rank TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (list_namespace, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_kosmora_lexorank_sort
        ON kosmora_lexorank_ordered_items (list_namespace, lexo_rank ASC);
    `);
  }

  public static computeMidpointRank(prevRank: string | null, nextRank: string | null): string {
    const base = BASE62_ALPHABET.length; // 62
    const a = prevRank ?? "";
    const b = nextRank ?? "";

    let i = 0;
    let prefix = "";

    while (true) {
      const codeA = i < a.length ? BASE62_ALPHABET.indexOf(a[i]!) : 0;
      const codeB = i < b.length && b !== "" ? BASE62_ALPHABET.indexOf(b[i]!) : base;

      if (codeA === codeB) {
        prefix += BASE62_ALPHABET[codeA]!;
        i++;
        continue;
      }

      if (codeB - codeA > 1) {
        const mid = Math.floor((codeA + codeB) / 2);
        return prefix + BASE62_ALPHABET[mid]!;
      }

      // Adjacent characters (codeB - codeA === 1): extend prefix with a[i] and bisect against tail of a
      prefix += BASE62_ALPHABET[codeA]!;
      return LexoRankFractionalOrderStore.computeMidpointRank(
        a.slice(i + 1) || null,
        null
      ).replace(/^/, prefix);
    }
  }

  public upsertItemBetween(params: {
    itemId: string;
    prevRank: string | null;
    nextRank: string | null;
    payload: Record<string, unknown>;
  }): { itemId: string; lexoRank: string } {
    const lexoRank = LexoRankFractionalOrderStore.computeMidpointRank(
      params.prevRank,
      params.nextRank
    );

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_lexorank_ordered_items
          (list_namespace, item_id, lexo_rank, payload_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(list_namespace, item_id) DO UPDATE SET
          lexo_rank = excluded.lexo_rank,
          payload_json = excluded.payload_json`
      )
      .run(this.listNamespace, params.itemId, lexoRank, JSON.stringify(params.payload));

    return { itemId: params.itemId, lexoRank };
  }

  public listOrderedItems(): Array<{
    itemId: string;
    lexoRank: string;
    payload: Record<string, unknown>;
  }> {
    const rows = this.sqlite
      .prepare(
        `SELECT item_id, lexo_rank, payload_json
         FROM kosmora_lexorank_ordered_items
         WHERE list_namespace = ?
         ORDER BY lexo_rank ASC, item_id ASC`
      )
      .all(this.listNamespace) as Array<{
      item_id: string;
      lexo_rank: string;
      payload_json: string;
    }>;

    return rows.map((r) => ({
      itemId: r.item_id,
      lexoRank: r.lexo_rank,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>
    }));
  }
}
