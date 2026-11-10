import { DatabaseSync } from "node:sqlite";

export interface ColumnarRleRun {
  valueId: number;
  runLength: number;
}

export interface ColumnarStripeMetadata {
  stripeId: string;
  tableName: string;
  columnName: string;
  rowCount: number;
  minNumeric: number | null;
  maxNumeric: number | null;
  minLexical: string | null;
  maxLexical: string | null;
  bitWidth: number;
  dictionarySize: number;
  rleRunCount: number;
}

/**
 * Apache Parquet / DuckDB-Inspired Columnar Analytical Storage Engine with
 * Dictionary Encoding, Run-Length Encoding (RLE), Bit-Packing Width Calculation,
 * and Zone-Map (Min/Max) Predicate Pushdown.
 */
export class ColumnarRleBitPackingStore {
  private readonly sqlite: DatabaseSync;
  private stripeSeq = 0;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_columnar_stripes (
        stripe_id TEXT PRIMARY KEY NOT NULL,
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        min_numeric REAL,
        max_numeric REAL,
        min_lexical TEXT,
        max_lexical TEXT,
        bit_width INTEGER NOT NULL,
        dictionary_json TEXT NOT NULL,
        rle_runs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  public appendColumnStripe(
    tableName: string,
    columnName: string,
    values: Array<string | number>
  ): ColumnarStripeMetadata {
    if (values.length === 0) {
      throw new Error("EMPTY_COLUMNAR_STRIPE");
    }

    const dictionary: Array<string | number> = [];
    const dictMap = new Map<string, number>();

    let minNumeric: number | null = null;
    let maxNumeric: number | null = null;
    let minLexical: string | null = null;
    let maxLexical: string | null = null;

    const valueIds: number[] = [];

    for (const v of values) {
      const key = `${typeof v}:${String(v)}`;
      let id = dictMap.get(key);
      if (id === undefined) {
        id = dictionary.length;
        dictionary.push(v);
        dictMap.set(key, id);
      }
      valueIds.push(id);

      if (typeof v === "number" && Number.isFinite(v)) {
        minNumeric = minNumeric === null ? v : Math.min(minNumeric, v);
        maxNumeric = maxNumeric === null ? v : Math.max(maxNumeric, v);
      } else {
        const s = String(v);
        minLexical = minLexical === null || s < minLexical ? s : minLexical;
        maxLexical = maxLexical === null || s > maxLexical ? s : maxLexical;
      }
    }

    // Run-Length Encode (RLE) dictionary value IDs
    const rleRuns: ColumnarRleRun[] = [];
    let curId = valueIds[0]!;
    let curLen = 1;
    for (let i = 1; i < valueIds.length; i++) {
      if (valueIds[i] === curId) {
        curLen++;
      } else {
        rleRuns.push({ valueId: curId, runLength: curLen });
        curId = valueIds[i]!;
        curLen = 1;
      }
    }
    rleRuns.push({ valueId: curId, runLength: curLen });

    const bitWidth =
      dictionary.length <= 1 ? 1 : Math.ceil(Math.log2(dictionary.length));
    const stripeId = `col_${tableName}_${columnName}_${++this.stripeSeq}`;

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_columnar_stripes
          (stripe_id, table_name, column_name, row_count, min_numeric, max_numeric, min_lexical, max_lexical, bit_width, dictionary_json, rle_runs_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stripeId,
        tableName,
        columnName,
        values.length,
        minNumeric,
        maxNumeric,
        minLexical,
        maxLexical,
        bitWidth,
        JSON.stringify(dictionary),
        JSON.stringify(rleRuns),
        new Date().toISOString()
      );

    return {
      stripeId,
      tableName,
      columnName,
      rowCount: values.length,
      minNumeric,
      maxNumeric,
      minLexical,
      maxLexical,
      bitWidth,
      dictionarySize: dictionary.length,
      rleRunCount: rleRuns.length
    };
  }

  /**
   * Scans numeric values in `[minBound, maxBound]` using Zone-Map Predicate Pushdown:
   * stripes whose `[min_numeric, max_numeric]` do not overlap `[minBound, maxBound]` are skipped without decoding!
   */
  public scanNumericRangeWithPushdown(params: {
    tableName: string;
    columnName: string;
    minBound: number;
    maxBound: number;
  }): {
    matchedValues: number[];
    stripesScanned: number;
    stripesPrunedByZoneMap: number;
  } {
    const rows = this.sqlite
      .prepare(
        `SELECT min_numeric, max_numeric, dictionary_json, rle_runs_json
         FROM kosmora_columnar_stripes
         WHERE table_name = ? AND column_name = ?
         ORDER BY stripe_id ASC`
      )
      .all(params.tableName, params.columnName) as Array<{
      min_numeric: number | null;
      max_numeric: number | null;
      dictionary_json: string;
      rle_runs_json: string;
    }>;

    const matchedValues: number[] = [];
    let stripesScanned = 0;
    let stripesPrunedByZoneMap = 0;

    for (const r of rows) {
      if (
        r.min_numeric === null ||
        r.max_numeric === null ||
        r.max_numeric < params.minBound ||
        r.min_numeric > params.maxBound
      ) {
        stripesPrunedByZoneMap++;
        continue;
      }

      stripesScanned++;
      const dict = JSON.parse(r.dictionary_json) as Array<string | number>;
      const runs = JSON.parse(r.rle_runs_json) as ColumnarRleRun[];

      for (const run of runs) {
        const val = dict[run.valueId];
        if (typeof val === "number" && val >= params.minBound && val <= params.maxBound) {
          for (let k = 0; k < run.runLength; k++) {
            matchedValues.push(val);
          }
        }
      }
    }

    return {
      matchedValues,
      stripesScanned,
      stripesPrunedByZoneMap
    };
  }
}
