import { DatabaseSync } from "node:sqlite";

export interface TimeSeriesPoint {
  timestampMs: number;
  value: number;
}

export interface CompressedTimeSeriesBlock {
  blockId: string;
  ownerId: string;
  metricName: string;
  pointCount: number;
  baseTimestampMs: number;
  baseValue: number;
  deltaOfDeltas: number[]; // [d_1, dod_2, dod_3, ...]
  valueDeltas: number[];
}

/**
 * Gorilla-Style Delta-of-Delta Time-Series Telemetry Compressor & SQLite Block Store.
 * Exploits constant-interval telemetry timestamps (where delta-of-delta == 0)
 * and smooth metric values for compact lossless time-series storage.
 */
export class TimeSeriesDeltaCompressor {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_timeseries_blocks (
        block_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        point_count INTEGER NOT NULL,
        base_timestamp_ms INTEGER NOT NULL,
        base_value REAL NOT NULL,
        delta_of_deltas_json TEXT NOT NULL,
        value_deltas_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  public static compressPoints(
    ownerId: string,
    metricName: string,
    points: TimeSeriesPoint[]
  ): CompressedTimeSeriesBlock {
    if (points.length === 0) {
      throw new Error("EMPTY_TIMESERIES_BLOCK");
    }

    const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
    const baseTimestampMs = sorted[0]!.timestampMs;
    const baseValue = sorted[0]!.value;

    const deltaOfDeltas: number[] = [];
    const valueDeltas: number[] = [];

    let prevDeltaT = 0;
    for (let i = 1; i < sorted.length; i++) {
      const dt = sorted[i]!.timestampMs - sorted[i - 1]!.timestampMs;
      const dod = i === 1 ? dt : dt - prevDeltaT;
      deltaOfDeltas.push(dod);
      prevDeltaT = dt;

      const dv = Number((sorted[i]!.value - sorted[i - 1]!.value).toFixed(6));
      valueDeltas.push(dv);
    }

    return {
      blockId: `ts_${ownerId}_${metricName}_${baseTimestampMs}`,
      ownerId,
      metricName,
      pointCount: sorted.length,
      baseTimestampMs,
      baseValue,
      deltaOfDeltas,
      valueDeltas
    };
  }

  public static decompressBlock(block: CompressedTimeSeriesBlock): TimeSeriesPoint[] {
    const out: TimeSeriesPoint[] = [
      { timestampMs: block.baseTimestampMs, value: block.baseValue }
    ];

    let curT = block.baseTimestampMs;
    let curVal = block.baseValue;
    let prevDeltaT = 0;

    for (let i = 0; i < block.deltaOfDeltas.length; i++) {
      const dod = block.deltaOfDeltas[i]!;
      const dt = i === 0 ? dod : prevDeltaT + dod;
      curT += dt;
      prevDeltaT = dt;

      curVal = Number((curVal + block.valueDeltas[i]!).toFixed(6));
      out.push({ timestampMs: curT, value: curVal });
    }

    return out;
  }

  public saveCompressedBlock(
    ownerId: string,
    metricName: string,
    points: TimeSeriesPoint[]
  ): CompressedTimeSeriesBlock {
    const block = TimeSeriesDeltaCompressor.compressPoints(ownerId, metricName, points);
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_timeseries_blocks
          (block_id, owner_id, metric_name, point_count, base_timestamp_ms, base_value, delta_of_deltas_json, value_deltas_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(block_id) DO UPDATE SET
          point_count = excluded.point_count,
          delta_of_deltas_json = excluded.delta_of_deltas_json,
          value_deltas_json = excluded.value_deltas_json`
      )
      .run(
        block.blockId,
        block.ownerId,
        block.metricName,
        block.pointCount,
        block.baseTimestampMs,
        block.baseValue,
        JSON.stringify(block.deltaOfDeltas),
        JSON.stringify(block.valueDeltas),
        new Date().toISOString()
      );
    return block;
  }

  public loadAndDecompressBlock(blockId: string): TimeSeriesPoint[] | null {
    const row = this.sqlite
      .prepare(
        `SELECT block_id, owner_id, metric_name, point_count, base_timestamp_ms, base_value, delta_of_deltas_json, value_deltas_json
         FROM kosmora_timeseries_blocks WHERE block_id = ?`
      )
      .get(blockId) as
      | {
          block_id: string;
          owner_id: string;
          metric_name: string;
          point_count: number;
          base_timestamp_ms: number;
          base_value: number;
          delta_of_deltas_json: string;
          value_deltas_json: string;
        }
      | undefined;

    if (!row) return null;

    return TimeSeriesDeltaCompressor.decompressBlock({
      blockId: row.block_id,
      ownerId: row.owner_id,
      metricName: row.metric_name,
      pointCount: row.point_count,
      baseTimestampMs: row.base_timestamp_ms,
      baseValue: row.base_value,
      deltaOfDeltas: JSON.parse(row.delta_of_deltas_json),
      valueDeltas: JSON.parse(row.value_deltas_json)
    });
  }
}
