import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";

type Claim = IntelligenceGraphEvidenceAudit["claims"][number];
type Support = Claim["supports"][number];
type CitedSupport = Omit<Support, "citation"> & { citation: NonNullable<Support["citation"]> };
export type SourceUsage = {
  id: string;
  label: string;
  versions: {
    ref: { id: string; version: number };
    label: string;
    status: string;
    historical: boolean;
    citations: number;
  }[];
  claims: (Omit<Claim, "supports" | "coverage"> & { supports: CitedSupport[] })[];
  counts: {
    claims: number;
    citations: number;
    current_citations: number;
    historical_citations: number;
  };
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareRef = (
  a: { ref: { id: string; version: number } },
  b: { ref: { id: string; version: number } }
) => compareText(a.ref.id, b.ref.id) || a.ref.version - b.ref.version;
const claimKey = (claim: Claim) => JSON.stringify([claim.ref.id, claim.ref.version]);
const counts = (claims: SourceUsage["claims"]): SourceUsage["counts"] => {
  const citations = claims.flatMap((c) => c.supports);
  const historical = citations.filter((s) => s.citation.historical).length;
  return {
    claims: claims.length,
    citations: citations.length,
    current_citations: citations.length - historical,
    historical_citations: historical
  };
};

/** Inverts only the checked audit's quoted incoming SUPPORTS; titles never establish identity. */
export function buildSourceUsages(report: IntelligenceGraphEvidenceAudit): SourceUsage[] {
  const groups = new Map<
    string,
    {
      versions: Map<number, SourceUsage["versions"][number]>;
      claims: Map<string, SourceUsage["claims"][number]>;
    }
  >();
  for (const claim of report.claims) {
    for (const support of claim.supports) {
      const citation = support.citation;
      if (!citation) continue;
      let group = groups.get(citation.source.id);
      if (!group) {
        group = { versions: new Map(), claims: new Map() };
        groups.set(citation.source.id, group);
      }
      const version = group.versions.get(citation.source.version);
      if (version) version.citations++;
      else
        group.versions.set(citation.source.version, {
          ref: { ...citation.source },
          label: citation.label,
          status: citation.status,
          historical: citation.historical,
          citations: 1
        });
      const key = claimKey(claim);
      let entry = group.claims.get(key);
      if (!entry) {
        entry = { ref: { ...claim.ref }, label: claim.label, status: claim.status, supports: [] };
        group.claims.set(key, entry);
      }
      entry.supports.push({ ...support, citation });
    }
  }
  return [...groups]
    .map(([id, group]) => {
      const versions = [...group.versions.values()].sort(compareRef);
      const claims = [...group.claims.values()]
        .sort(compareRef)
        .map((c) => ({ ...c, supports: [...c.supports].sort(compareRef) }));
      return { id, label: versions.at(-1)!.label, versions, claims, counts: counts(claims) };
    })
    .sort((a, b) => compareText(a.label, b.label) || compareText(a.id, b.id));
}

export function filterSourceUsage(source: SourceUsage, version: number | null): SourceUsage {
  if (version === null) return source;
  if (!Number.isSafeInteger(version) || !source.versions.some((v) => v.ref.version === version))
    throw new Error("Выберите цитируемую версию источника.");
  const claims = source.claims
    .map((c) => ({
      ...c,
      supports: c.supports.filter((s) => s.citation.source.version === version)
    }))
    .filter((c) => c.supports.length > 0);
  const versions = source.versions.filter((v) => v.ref.version === version);
  return { ...source, label: versions[0]!.label, versions, claims, counts: counts(claims) };
}
