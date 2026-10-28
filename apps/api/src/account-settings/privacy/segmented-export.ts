import { createHash } from "node:crypto";
import type { PrivacyExport } from "./coordinator.js";

export const SEGMENTED_EXPORT_MAX_BYTES = 160 * 1024 * 1024;
const MAX_SEGMENTS = 4096;
type Section = PrivacyExport["sections"][string];
type Original = Section["originals"][number];
type Unit =
  | { store: string; collection: string | null; row: unknown; empty: boolean }
  | { store: string; original: Original };
type OriginalIndex = {
  store: string;
  id: string;
  path: string;
  sha256: string;
  size_bytes: number;
};
export interface PrivacySegmentPlan {
  format: "kosmora-owner-segmented-export-v1";
  generated_at: string;
  owner_scope: string;
  complete: true;
  plan_digest: string;
  max_segment_bytes: number;
  total_segments: number;
  total_records: number;
  total_originals: number;
  retained: string[];
  segments: {
    index: number;
    record_count: number;
    original_count: number;
    archive_bytes_upper_bound: number;
    href: string;
  }[];
}
export type PrivacySegment = {
  sections: PrivacyExport["sections"];
  originals: OriginalIndex[];
  recordCount: number;
  upperBound: number;
};
export class PrivacySegmentLimitError extends Error {}
export function segmentLimit(requested = 10 * 1024 * 1024): number {
  if (!Number.isSafeInteger(requested) || requested < 4096 || requested > 20 * 1024 * 1024)
    throw new PrivacySegmentLimitError("max_segment_bytes must be 4096..20971520");
  return requested;
}
export function segmentManifest(plan: PrivacySegmentPlan, segment: PrivacySegment, index: number) {
  return {
    format: "kosmora-owner-export-segment-v1",
    generated_at: plan.generated_at,
    owner_scope: plan.owner_scope,
    complete_plan_verified: true,
    plan_digest: plan.plan_digest,
    segment_index: index,
    total_segments: plan.total_segments,
    total_plan_records: plan.total_records,
    total_plan_originals: plan.total_originals,
    segment_record_count: segment.recordCount,
    segment_original_count: segment.originals.length,
    sections: segment.sections,
    archive_originals: segment.originals,
    retained: plan.retained
  };
}
const entryOverhead = (path: string) => 76 + 2 * Buffer.byteLength(path);
const buildSlice = (units: Unit[]): PrivacySegment => {
  const sections = Object.create(null) as PrivacyExport["sections"];
  const originals: OriginalIndex[] = [];
  let recordCount = 0;
  for (const unit of units) {
    const section = (sections[unit.store] ??= {
      records: Object.create(null) as Record<string, unknown[]>,
      count: 0,
      originals: [],
      limitations: []
    });
    if ("original" in unit) {
      const original = unit.original;
      section.originals.push(original);
      originals.push({
        store: unit.store,
        id: original.id,
        path: `originals/${unit.store}/${String(originals.length).padStart(5, "0")}.bin`,
        sha256: original.sha256,
        size_bytes: original.size_bytes
      });
    } else if (unit.collection !== null) {
      const rows = (section.records[unit.collection] ??= []);
      if (!unit.empty) {
        rows.push(unit.row);
        section.count++;
        recordCount++;
      }
    }
  }
  return { sections, originals, recordCount, upperBound: 0 };
};

/** Complete metadata partition with an upper bound for the actual ZIP, not just binary payload. */
export function buildSegmentedExport(
  manifest: PrivacyExport,
  requested?: number
): { plan: PrivacySegmentPlan; slices: PrivacySegment[] } {
  const limit = segmentLimit(requested);
  const metadata = JSON.stringify(manifest.sections);
  const originalsBytes = Object.values(manifest.sections).reduce(
    (sum, section) => sum + section.originals.reduce((n, original) => n + original.size_bytes, 0),
    0
  );
  if (
    Buffer.byteLength(metadata) + originalsBytes > SEGMENTED_EXPORT_MAX_BYTES ||
    manifest.record_count > 1_000_000 ||
    manifest.original_count > 1_000_000
  )
    throw new PrivacySegmentLimitError("SEGMENTED_EXPORT_TOTAL_LIMIT");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        owner: manifest.owner_scope,
        limit,
        sections: manifest.sections,
        retained: manifest.retained
      })
    )
    .digest("hex");
  const plan: PrivacySegmentPlan = {
    format: "kosmora-owner-segmented-export-v1",
    generated_at: manifest.generated_at,
    owner_scope: manifest.owner_scope,
    complete: true,
    plan_digest: digest,
    max_segment_bytes: limit,
    total_segments: 0,
    total_records: manifest.record_count,
    total_originals: manifest.original_count,
    retained: manifest.retained,
    segments: []
  };
  const slices: PrivacySegment[] = [];
  const append = (units: Unit[]): void => {
    const slice = buildSlice(units);
    // All actual counters/indices fit these placeholders; timestamps and digests have fixed length.
    const worst = {
      ...plan,
      total_segments: MAX_SEGMENTS,
      total_records: 1_000_000,
      total_originals: 1_000_000
    };
    const payload = Buffer.byteLength(JSON.stringify(segmentManifest(worst, slice, MAX_SEGMENTS)));
    slice.upperBound =
      22 +
      entryOverhead("segment-manifest.json") +
      payload +
      slice.originals.reduce(
        (n, original) => n + original.size_bytes + entryOverhead(original.path),
        0
      );
    if (slice.upperBound > limit || slice.originals.length >= 4000) {
      if (units.length <= 1)
        throw new PrivacySegmentLimitError("SINGLE_ITEM_EXCEEDS_SEGMENT_LIMIT");
      const middle = Math.floor(units.length / 2);
      append(units.slice(0, middle));
      append(units.slice(middle));
      return;
    }
    if (slices.length >= MAX_SEGMENTS)
      throw new PrivacySegmentLimitError("SEGMENTED_EXPORT_SEGMENT_LIMIT");
    slices.push(slice);
  };
  let pending: Unit[] = [],
    approximateBytes = 0;
  const enqueue = (unit: Unit, bytes: number) => {
    if (pending.length && approximateBytes + bytes > Math.max(1024, limit - 2048)) {
      append(pending);
      pending = [];
      approximateBytes = 0;
    }
    pending.push(unit);
    approximateBytes += bytes;
  };
  for (const [store, section] of Object.entries(manifest.sections)) {
    for (const [collection, rows] of Object.entries(section.records)) {
      if (!rows.length)
        enqueue(
          { store, collection, row: null, empty: true },
          Buffer.byteLength(store + collection) + 128
        );
      for (const row of rows)
        enqueue(
          { store, collection, row, empty: false },
          Buffer.byteLength(JSON.stringify(row)) + Buffer.byteLength(store + collection) + 128
        );
    }
    for (const original of section.originals)
      enqueue(
        { store, original },
        original.size_bytes + 2 * Buffer.byteLength(JSON.stringify(original)) + 256
      );
    if (!Object.keys(section.records).length && !section.originals.length)
      enqueue({ store, collection: null, row: null, empty: true }, Buffer.byteLength(store) + 128);
  }
  if (pending.length) append(pending);
  if (!slices.length) throw new PrivacySegmentLimitError("EMPTY_PRIVACY_MANIFEST");
  plan.total_segments = slices.length;
  plan.segments = slices.map((slice, index) => ({
    index,
    record_count: slice.recordCount,
    original_count: slice.originals.length,
    archive_bytes_upper_bound: slice.upperBound,
    href: `/api/v1/personal-settings/export/segments/${index}?plan_digest=${digest}&max_segment_bytes=${limit}`
  }));
  return { plan, slices };
}
