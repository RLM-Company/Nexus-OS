import { DatabaseSync } from "node:sqlite";

/**
 * 16-bit container types for Roaring Bitmap:
 * - "array": sorted list of 16-bit integers when cardinality <= 64 (compact threshold for fast JS operations)
 * - "runs": pairs of [start, length] for contiguous runs of integers
 */
export type RoaringContainerSerialized =
  | { type: "array"; values: number[] }
  | { type: "runs"; runs: Array<[number, number]> };

export interface SerializedRoaringBitmap {
  containers: Record<string, RoaringContainerSerialized>;
}

const RUN_OPTIMIZATION_THRESHOLD = 4;

/**
 * Compressed 32-bit Roaring Bitmap partitioning integers by high 16 bits
 * and choosing between sorted Array containers and Run-Length (RLE) containers.
 */
export class RoaringBitmap32 {
  // Map of high16 -> sorted Set/array of low16 integers
  private readonly chunks = new Map<number, Uint16Array>();

  constructor(initialValues?: Iterable<number>) {
    if (initialValues) {
      this.addMany(initialValues);
    }
  }

  public add(value: number): void {
    const v = value >>> 0;
    const high = v >>> 16;
    const low = v & 0xffff;
    const existing = this.chunks.get(high);
    if (!existing) {
      this.chunks.set(high, new Uint16Array([low]));
      return;
    }
    const idx = this.binarySearch(existing, low);
    if (idx >= 0) return; // already present
    const insertPos = ~idx;
    const next = new Uint16Array(existing.length + 1);
    next.set(existing.subarray(0, insertPos), 0);
    next[insertPos] = low;
    next.set(existing.subarray(insertPos), insertPos + 1);
    this.chunks.set(high, next);
  }

  public addRange(startInclusive: number, endInclusive: number): void {
    const start = Math.max(0, Math.floor(startInclusive));
    const end = Math.max(start, Math.floor(endInclusive));
    const batch: number[] = [];
    for (let i = start; i <= end; i++) {
      batch.push(i);
    }
    this.addMany(batch);
  }

  public addMany(values: Iterable<number>): void {
    const byHigh = new Map<number, number[]>();
    for (const raw of values) {
      const v = raw >>> 0;
      const high = v >>> 16;
      const low = v & 0xffff;
      let arr = byHigh.get(high);
      if (!arr) {
        arr = [];
        byHigh.set(high, arr);
      }
      arr.push(low);
    }
    for (const [high, additions] of byHigh.entries()) {
      const existing = this.chunks.get(high);
      if (existing) {
        for (let i = 0; i < existing.length; i++) {
          additions.push(existing[i]!);
        }
      }
      additions.sort((a, b) => a - b);
      // Deduplicate in-place
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < additions.length; readIdx++) {
        if (writeIdx === 0 || additions[readIdx] !== additions[writeIdx - 1]) {
          additions[writeIdx++] = additions[readIdx]!;
        }
      }
      const deduped = new Uint16Array(writeIdx);
      for (let i = 0; i < writeIdx; i++) {
        deduped[i] = additions[i]!;
      }
      if (deduped.length > 0) {
        this.chunks.set(high, deduped);
      }
    }
  }

  public has(value: number): boolean {
    const v = value >>> 0;
    const high = v >>> 16;
    const low = v & 0xffff;
    const container = this.chunks.get(high);
    if (!container) return false;
    return this.binarySearch(container, low) >= 0;
  }

  public get cardinality(): number {
    let total = 0;
    for (const container of this.chunks.values()) {
      total += container.length;
    }
    return total;
  }

  public toArray(): number[] {
    const result: number[] = [];
    const sortedHighs = Array.from(this.chunks.keys()).sort((a, b) => a - b);
    for (const high of sortedHighs) {
      const container = this.chunks.get(high)!;
      const prefix = (high << 16) >>> 0;
      for (let i = 0; i < container.length; i++) {
        result.push((prefix | container[i]!) >>> 0);
      }
    }
    return result;
  }

  public static intersect(a: RoaringBitmap32, b: RoaringBitmap32): RoaringBitmap32 {
    const out = new RoaringBitmap32();
    const [smaller, larger] = a.chunks.size <= b.chunks.size ? [a, b] : [b, a];
    for (const [high, arrA] of smaller.chunks.entries()) {
      const arrB = larger.chunks.get(high);
      if (!arrB) continue;
      const intersected = RoaringBitmap32.intersectSortedUint16(arrA, arrB);
      if (intersected.length > 0) {
        out.chunks.set(high, intersected);
      }
    }
    return out;
  }

  public static union(a: RoaringBitmap32, b: RoaringBitmap32): RoaringBitmap32 {
    const out = new RoaringBitmap32();
    const allHighs = new Set<number>([...a.chunks.keys(), ...b.chunks.keys()]);
    for (const high of allHighs) {
      const arrA = a.chunks.get(high);
      const arrB = b.chunks.get(high);
      if (arrA && arrB) {
        out.chunks.set(high, RoaringBitmap32.unionSortedUint16(arrA, arrB));
      } else if (arrA) {
        out.chunks.set(high, new Uint16Array(arrA));
      } else if (arrB) {
        out.chunks.set(high, new Uint16Array(arrB));
      }
    }
    return out;
  }

  public static difference(a: RoaringBitmap32, b: RoaringBitmap32): RoaringBitmap32 {
    const out = new RoaringBitmap32();
    for (const [high, arrA] of a.chunks.entries()) {
      const arrB = b.chunks.get(high);
      if (!arrB) {
        out.chunks.set(high, new Uint16Array(arrA));
        continue;
      }
      const diff = RoaringBitmap32.differenceSortedUint16(arrA, arrB);
      if (diff.length > 0) {
        out.chunks.set(high, diff);
      }
    }
    return out;
  }

  /**
   * Serializes each 16-bit chunk using whichever representation (Run-Length vs Array) is smaller.
   */
  public serialize(): SerializedRoaringBitmap {
    const containers: Record<string, RoaringContainerSerialized> = {};
    for (const [high, arr] of this.chunks.entries()) {
      if (arr.length === 0) continue;
      const runs = RoaringBitmap32.encodeRuns(arr);
      if (arr.length >= RUN_OPTIMIZATION_THRESHOLD && runs.length * 2 < arr.length) {
        containers[String(high)] = { type: "runs", runs };
      } else {
        containers[String(high)] = { type: "array", values: Array.from(arr) };
      }
    }
    return { containers };
  }

  public static deserialize(data: SerializedRoaringBitmap): RoaringBitmap32 {
    const bitmap = new RoaringBitmap32();
    for (const [highStr, container] of Object.entries(data.containers)) {
      const high = Number(highStr);
      if (container.type === "array") {
        bitmap.chunks.set(high, new Uint16Array(container.values));
      } else if (container.type === "runs") {
        const expanded: number[] = [];
        for (const [start, length] of container.runs) {
          for (let offset = 0; offset <= length; offset++) {
            expanded.push(start + offset);
          }
        }
        bitmap.chunks.set(high, new Uint16Array(expanded));
      }
    }
    return bitmap;
  }

  private static encodeRuns(arr: Uint16Array): Array<[number, number]> {
    if (arr.length === 0) return [];
    const runs: Array<[number, number]> = [];
    let runStart = arr[0]!;
    let runLen = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === runStart + runLen + 1) {
        runLen++;
      } else {
        runs.push([runStart, runLen]);
        runStart = arr[i]!;
        runLen = 0;
      }
    }
    runs.push([runStart, runLen]);
    return runs;
  }

  private binarySearch(arr: Uint16Array, target: number): number {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const midVal = arr[mid]!;
      if (midVal < target) {
        low = mid + 1;
      } else if (midVal > target) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return ~low;
  }

  private static intersectSortedUint16(a: Uint16Array, b: Uint16Array): Uint16Array {
    const temp: number[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const va = a[i]!;
      const vb = b[j]!;
      if (va === vb) {
        temp.push(va);
        i++;
        j++;
      } else if (va < vb) {
        i++;
      } else {
        j++;
      }
    }
    return new Uint16Array(temp);
  }

  private static unionSortedUint16(a: Uint16Array, b: Uint16Array): Uint16Array {
    const temp: number[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const va = a[i]!;
      const vb = b[j]!;
      if (va === vb) {
        temp.push(va);
        i++;
        j++;
      } else if (va < vb) {
        temp.push(va);
        i++;
      } else {
        temp.push(vb);
        j++;
      }
    }
    while (i < a.length) temp.push(a[i++]!);
    while (j < b.length) temp.push(b[j++]!);
    return new Uint16Array(temp);
  }

  private static differenceSortedUint16(a: Uint16Array, b: Uint16Array): Uint16Array {
    const temp: number[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const va = a[i]!;
      const vb = b[j]!;
      if (va === vb) {
        i++;
        j++;
      } else if (va < vb) {
        temp.push(va);
        i++;
      } else {
        j++;
      }
    }
    while (i < a.length) temp.push(a[i++]!);
    return new Uint16Array(temp);
  }
}

export interface IndexedDocumentRecord {
  internalId: number;
  externalDocId: string;
  ownerId: string;
  title: string;
  tags: string[];
  tokenCount: number;
}

export interface PhraseMatchResult {
  externalDocId: string;
  title: string;
  matchCount: number;
  positions: number[];
  score: number;
}

interface TermPostingEntry {
  bitmap: RoaringBitmap32;
  positionsByDoc: Map<number, number[]>;
}

/**
 * Roaring Bitmap + Positional Inverted Index supporting sub-millisecond
 * boolean intersections, tag filter bitmaps, exact phrase queries, and proximity (slop) matching.
 */
export class RoaringPositionalInvertedIndex {
  private readonly ownerId: string;
  private readonly namespace: string;
  private nextInternalId = 1;
  private readonly docsByInternalId = new Map<number, IndexedDocumentRecord>();
  private readonly internalIdByExternal = new Map<string, number>();
  private readonly postings = new Map<string, TermPostingEntry>();
  private readonly tagBitmaps = new Map<string, RoaringBitmap32>();

  constructor(ownerId: string, namespace = "default") {
    this.ownerId = ownerId;
    this.namespace = namespace;
  }

  public static tokenizeWithPositions(text: string): Array<{ term: string; position: number }> {
    const matches = text.toLowerCase().match(/[a-z0-9\u0400-\u04ff_]+/g) ?? [];
    return matches.map((term, idx) => ({ term, position: idx }));
  }

  public indexDocument(params: {
    externalDocId: string;
    title: string;
    content: string;
    tags?: string[];
  }): IndexedDocumentRecord {
    const existingId = this.internalIdByExternal.get(params.externalDocId);
    if (existingId !== undefined) {
      this.removeDocument(params.externalDocId);
    }

    const internalId = this.nextInternalId++;
    const tokens = RoaringPositionalInvertedIndex.tokenizeWithPositions(
      `${params.title} ${params.content}`
    );
    const normalizedTags = (params.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);

    const record: IndexedDocumentRecord = {
      internalId,
      externalDocId: params.externalDocId,
      ownerId: this.ownerId,
      title: params.title,
      tags: normalizedTags,
      tokenCount: tokens.length
    };

    this.docsByInternalId.set(internalId, record);
    this.internalIdByExternal.set(params.externalDocId, internalId);

    for (const { term, position } of tokens) {
      let entry = this.postings.get(term);
      if (!entry) {
        entry = {
          bitmap: new RoaringBitmap32(),
          positionsByDoc: new Map<number, number[]>()
        };
        this.postings.set(term, entry);
      }
      entry.bitmap.add(internalId);
      let posList = entry.positionsByDoc.get(internalId);
      if (!posList) {
        posList = [];
        entry.positionsByDoc.set(internalId, posList);
      }
      posList.push(position);
    }

    for (const tag of normalizedTags) {
      let tagBm = this.tagBitmaps.get(tag);
      if (!tagBm) {
        tagBm = new RoaringBitmap32();
        this.tagBitmaps.set(tag, tagBm);
      }
      tagBm.add(internalId);
    }

    return record;
  }

  public removeDocument(externalDocId: string): boolean {
    const internalId = this.internalIdByExternal.get(externalDocId);
    if (internalId === undefined) return false;

    const toRemove = new RoaringBitmap32([internalId]);
    for (const [term, entry] of this.postings.entries()) {
      if (entry.bitmap.has(internalId)) {
        entry.bitmap = RoaringBitmap32.difference(entry.bitmap, toRemove);
        entry.positionsByDoc.delete(internalId);
        if (entry.bitmap.cardinality === 0) {
          this.postings.delete(term);
        }
      }
    }
    for (const [tag, bm] of this.tagBitmaps.entries()) {
      if (bm.has(internalId)) {
        const nextBm = RoaringBitmap32.difference(bm, toRemove);
        if (nextBm.cardinality === 0) {
          this.tagBitmaps.delete(tag);
        } else {
          this.tagBitmaps.set(tag, nextBm);
        }
      }
    }
    this.docsByInternalId.delete(internalId);
    this.internalIdByExternal.delete(externalDocId);
    return true;
  }

  /**
   * Intersects Roaring Bitmaps for all required terms and optional required/excluded tags.
   */
  public queryBooleanFilter(params: {
    mustTerms?: string[];
    shouldTerms?: string[];
    mustNotTerms?: string[];
    requiredTags?: string[];
  }): IndexedDocumentRecord[] {
    let candidateBitmap: RoaringBitmap32 | null = null;

    if (params.mustTerms && params.mustTerms.length > 0) {
      for (const rawTerm of params.mustTerms) {
        const term = rawTerm.toLowerCase().trim();
        const entry = this.postings.get(term);
        if (!entry) return [];
        candidateBitmap = candidateBitmap
          ? RoaringBitmap32.intersect(candidateBitmap, entry.bitmap)
          : new RoaringBitmap32(entry.bitmap.toArray());
        if (candidateBitmap.cardinality === 0) return [];
      }
    }

    if (params.shouldTerms && params.shouldTerms.length > 0) {
      let unionBm = new RoaringBitmap32();
      for (const rawTerm of params.shouldTerms) {
        const term = rawTerm.toLowerCase().trim();
        const entry = this.postings.get(term);
        if (entry) {
          unionBm = RoaringBitmap32.union(unionBm, entry.bitmap);
        }
      }
      candidateBitmap = candidateBitmap
        ? RoaringBitmap32.intersect(candidateBitmap, unionBm)
        : unionBm;
    }

    if (params.requiredTags && params.requiredTags.length > 0) {
      for (const rawTag of params.requiredTags) {
        const tag = rawTag.toLowerCase().trim();
        const tagBm = this.tagBitmaps.get(tag);
        if (!tagBm) return [];
        candidateBitmap = candidateBitmap
          ? RoaringBitmap32.intersect(candidateBitmap, tagBm)
          : new RoaringBitmap32(tagBm.toArray());
      }
    }

    if (!candidateBitmap) {
      candidateBitmap = new RoaringBitmap32(this.docsByInternalId.keys());
    }

    if (params.mustNotTerms && params.mustNotTerms.length > 0) {
      for (const rawTerm of params.mustNotTerms) {
        const term = rawTerm.toLowerCase().trim();
        const entry = this.postings.get(term);
        if (entry) {
          candidateBitmap = RoaringBitmap32.difference(candidateBitmap, entry.bitmap);
        }
      }
    }

    return candidateBitmap
      .toArray()
      .map((id) => this.docsByInternalId.get(id))
      .filter((d): d is IndexedDocumentRecord => d !== undefined);
  }

  /**
   * Executes an exact phrase or proximity phrase search (with configurable maxSlop word distance).
   * maxSlop = 0 enforces strictly consecutive token positions (p_k = p_0 + k).
   */
  public queryPhrase(
    phrase: string,
    options?: { maxSlop?: number; requiredTags?: string[] }
  ): PhraseMatchResult[] {
    const tokens = RoaringPositionalInvertedIndex.tokenizeWithPositions(phrase).map((t) => t.term);
    if (tokens.length === 0) return [];

    const maxSlop = Math.max(0, options?.maxSlop ?? 0);

    // Step 1: Roaring Bitmap intersection across all phrase tokens
    let candidateBm: RoaringBitmap32 | null = null;
    for (const token of tokens) {
      const entry = this.postings.get(token);
      if (!entry) return [];
      candidateBm = candidateBm
        ? RoaringBitmap32.intersect(candidateBm, entry.bitmap)
        : new RoaringBitmap32(entry.bitmap.toArray());
      if (candidateBm.cardinality === 0) return [];
    }

    if (options?.requiredTags && options.requiredTags.length > 0) {
      for (const tag of options.requiredTags) {
        const tagBm = this.tagBitmaps.get(tag.toLowerCase().trim());
        if (!tagBm) return [];
        candidateBm = RoaringBitmap32.intersect(candidateBm!, tagBm);
      }
    }

    const candidateDocIds = candidateBm!.toArray();
    const results: PhraseMatchResult[] = [];

    // Step 2: Verify positional alignment per surviving candidate document
    for (const docId of candidateDocIds) {
      const docRecord = this.docsByInternalId.get(docId);
      if (!docRecord) continue;

      if (tokens.length === 1) {
        const pos = this.postings.get(tokens[0]!)?.positionsByDoc.get(docId) ?? [];
        if (pos.length > 0) {
          results.push({
            externalDocId: docRecord.externalDocId,
            title: docRecord.title,
            matchCount: pos.length,
            positions: [...pos],
            score: pos.length / Math.max(1, Math.sqrt(docRecord.tokenCount))
          });
        }
        continue;
      }

      const firstPositions = this.postings.get(tokens[0]!)?.positionsByDoc.get(docId) ?? [];
      const matchedStartPositions: number[] = [];

      for (const startPos of firstPositions) {
        let currentPos = startPos;
        let remainingSlop = maxSlop;
        let chainValid = true;

        for (let k = 1; k < tokens.length; k++) {
          const nextPositions = this.postings.get(tokens[k]!)?.positionsByDoc.get(docId) ?? [];
          // Find a position p > currentPos such that (p - currentPos - 1) <= remainingSlop
          let matchedNext: number | null = null;
          for (const p of nextPositions) {
            if (p <= currentPos) continue;
            const gap = p - currentPos - 1;
            if (gap <= remainingSlop) {
              matchedNext = p;
              remainingSlop -= gap;
              break;
            }
            if (gap > remainingSlop) break; // sorted ascending
          }
          if (matchedNext === null) {
            chainValid = false;
            break;
          }
          currentPos = matchedNext;
        }

        if (chainValid) {
          matchedStartPositions.push(startPos);
        }
      }

      if (matchedStartPositions.length > 0) {
        results.push({
          externalDocId: docRecord.externalDocId,
          title: docRecord.title,
          matchCount: matchedStartPositions.length,
          positions: matchedStartPositions,
          score:
            (matchedStartPositions.length * tokens.length) /
            Math.max(1, Math.sqrt(docRecord.tokenCount))
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  public saveToSqlite(sqlite: DatabaseSync): string {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_roaring_inverted_snapshots (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        doc_count INTEGER NOT NULL,
        term_count INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, namespace)
      );
    `);

    const snapshotId = `roaring_${this.ownerId}_${this.namespace}`;
    const serializedPostings: Record<
      string,
      { bitmap: SerializedRoaringBitmap; positions: Record<string, number[]> }
    > = {};

    for (const [term, entry] of this.postings.entries()) {
      const posObj: Record<string, number[]> = {};
      for (const [docId, pos] of entry.positionsByDoc.entries()) {
        posObj[String(docId)] = pos;
      }
      serializedPostings[term] = {
        bitmap: entry.bitmap.serialize(),
        positions: posObj
      };
    }

    const serializedTags: Record<string, SerializedRoaringBitmap> = {};
    for (const [tag, bm] of this.tagBitmaps.entries()) {
      serializedTags[tag] = bm.serialize();
    }

    const payload = {
      nextInternalId: this.nextInternalId,
      docs: Array.from(this.docsByInternalId.values()),
      postings: serializedPostings,
      tags: serializedTags
    };

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO kosmora_roaring_inverted_snapshots
          (snapshot_id, owner_id, namespace, doc_count, term_count, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, namespace) DO UPDATE SET
          doc_count = excluded.doc_count,
          term_count = excluded.term_count,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at`
      )
      .run(
        snapshotId,
        this.ownerId,
        this.namespace,
        this.docsByInternalId.size,
        this.postings.size,
        JSON.stringify(payload),
        now
      );

    return snapshotId;
  }

  public static loadFromSqlite(
    sqlite: DatabaseSync,
    ownerId: string,
    namespace = "default"
  ): RoaringPositionalInvertedIndex | null {
    const row = sqlite
      .prepare(
        `SELECT payload_json FROM kosmora_roaring_inverted_snapshots
         WHERE owner_id = ? AND namespace = ?`
      )
      .get(ownerId, namespace) as { payload_json: string } | undefined;

    if (!row) return null;

    const parsed = JSON.parse(row.payload_json) as {
      nextInternalId: number;
      docs: IndexedDocumentRecord[];
      postings: Record<
        string,
        { bitmap: SerializedRoaringBitmap; positions: Record<string, number[]> }
      >;
      tags: Record<string, SerializedRoaringBitmap>;
    };

    const idx = new RoaringPositionalInvertedIndex(ownerId, namespace);
    idx.nextInternalId = parsed.nextInternalId;

    for (const doc of parsed.docs) {
      idx.docsByInternalId.set(doc.internalId, doc);
      idx.internalIdByExternal.set(doc.externalDocId, doc.internalId);
    }

    for (const [term, data] of Object.entries(parsed.postings)) {
      const posMap = new Map<number, number[]>();
      for (const [docIdStr, posArr] of Object.entries(data.positions)) {
        posMap.set(Number(docIdStr), posArr);
      }
      idx.postings.set(term, {
        bitmap: RoaringBitmap32.deserialize(data.bitmap),
        positionsByDoc: posMap
      });
    }

    for (const [tag, bmData] of Object.entries(parsed.tags)) {
      idx.tagBitmaps.set(tag, RoaringBitmap32.deserialize(bmData));
    }

    return idx;
  }
}
