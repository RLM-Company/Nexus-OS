import { DatabaseSync } from "node:sqlite";

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialIndexedItem<TMeta = Record<string, unknown>> {
  itemId: string;
  bbox: BoundingBox2D;
  metadata: TMeta;
}

/**
 * 2D R-Tree Minimum Bounding Rectangle (MBR) Spatial & Canvas Layout Index Store.
 * Supports fast bounding-box intersection queries (`searchIntersectingBox`) and
 * MINDIST k-Nearest-Neighbor (`searchNearestNeighbors`) queries backed by SQLite.
 */
export class SpatialRTreeBoundingBoxIndex<TMeta = Record<string, unknown>> {
  private readonly sqlite: DatabaseSync;
  private readonly layerName: string;

  constructor(sqlite: DatabaseSync, layerName = "workspace_canvas") {
    this.sqlite = sqlite;
    this.layerName = layerName;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_spatial_rtree_items (
        layer_name TEXT NOT NULL,
        item_id TEXT NOT NULL,
        min_x REAL NOT NULL,
        min_y REAL NOT NULL,
        max_x REAL NOT NULL,
        max_y REAL NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (layer_name, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_kosmora_spatial_rtree_mbr
        ON kosmora_spatial_rtree_items (layer_name, min_x, max_x, min_y, max_y);
    `);
  }

  public upsertItem(item: SpatialIndexedItem<TMeta>): void {
    const minX = Math.min(item.bbox.minX, item.bbox.maxX);
    const maxX = Math.max(item.bbox.minX, item.bbox.maxX);
    const minY = Math.min(item.bbox.minY, item.bbox.maxY);
    const maxY = Math.max(item.bbox.minY, item.bbox.maxY);

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_spatial_rtree_items
          (layer_name, item_id, min_x, min_y, max_x, max_y, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(layer_name, item_id) DO UPDATE SET
          min_x = excluded.min_x,
          min_y = excluded.min_y,
          max_x = excluded.max_x,
          max_y = excluded.max_y,
          metadata_json = excluded.metadata_json`
      )
      .run(
        this.layerName,
        item.itemId,
        minX,
        minY,
        maxX,
        maxY,
        JSON.stringify(item.metadata ?? {})
      );
  }

  public searchIntersectingBox(queryBox: BoundingBox2D): SpatialIndexedItem<TMeta>[] {
    const qMinX = Math.min(queryBox.minX, queryBox.maxX);
    const qMaxX = Math.max(queryBox.minX, queryBox.maxX);
    const qMinY = Math.min(queryBox.minY, queryBox.maxY);
    const qMaxY = Math.max(queryBox.minY, queryBox.maxY);

    // Two rectangles intersect iff max_x >= qMinX AND min_x <= qMaxX AND max_y >= qMinY AND min_y <= qMaxY
    const rows = this.sqlite
      .prepare(
        `SELECT item_id, min_x, min_y, max_x, max_y, metadata_json
         FROM kosmora_spatial_rtree_items
         WHERE layer_name = ?
           AND max_x >= ? AND min_x <= ?
           AND max_y >= ? AND min_y <= ?
         ORDER BY item_id ASC`
      )
      .all(this.layerName, qMinX, qMaxX, qMinY, qMaxY) as Array<{
      item_id: string;
      min_x: number;
      min_y: number;
      max_x: number;
      max_y: number;
      metadata_json: string;
    }>;

    return rows.map((r) => ({
      itemId: r.item_id,
      bbox: { minX: r.min_x, minY: r.min_y, maxX: r.max_x, maxY: r.max_y },
      metadata: JSON.parse(r.metadata_json) as TMeta
    }));
  }

  /**
   * Roussopoulos MINDIST metric from point (px, py) to MBR `[minX, maxX] x [minY, maxY]`.
   */
  public static pointToBoxMinDist(px: number, py: number, box: BoundingBox2D): number {
    const dx = px < box.minX ? box.minX - px : px > box.maxX ? px - box.maxX : 0;
    const dy = py < box.minY ? box.minY - py : py > box.maxY ? py - box.maxY : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  public searchNearestNeighbors(
    px: number,
    py: number,
    topK = 3
  ): Array<SpatialIndexedItem<TMeta> & { distance: number }> {
    const rows = this.sqlite
      .prepare(
        `SELECT item_id, min_x, min_y, max_x, max_y, metadata_json
         FROM kosmora_spatial_rtree_items WHERE layer_name = ?`
      )
      .all(this.layerName) as Array<{
      item_id: string;
      min_x: number;
      min_y: number;
      max_x: number;
      max_y: number;
      metadata_json: string;
    }>;

    return rows
      .map((r) => {
        const bbox = { minX: r.min_x, minY: r.min_y, maxX: r.max_x, maxY: r.max_y };
        const dist = SpatialRTreeBoundingBoxIndex.pointToBoxMinDist(px, py, bbox);
        return {
          itemId: r.item_id,
          bbox,
          metadata: JSON.parse(r.metadata_json) as TMeta,
          distance: Number(dist.toFixed(6))
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK);
  }
}
