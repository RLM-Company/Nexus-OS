import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";

type Claim = IntelligenceGraphEvidenceAudit["claims"][number];
export type EvidenceComparison = {
  format: "kosmora.graph-evidence-comparison.v1";
  usage: string;
  before: { graph: IntelligenceGraphEvidenceAudit["graph"]; audit_sha256: string };
  after: { graph: IntelligenceGraphEvidenceAudit["graph"]; audit_sha256: string };
  counts: { added: number; removed: number; changed: number; unchanged: number };
  changes: {
    id: string;
    kind: "added" | "removed" | "changed";
    before: Claim | null;
    after: Claim | null;
  }[];
};
const ordered = (claim: Claim): Claim => ({
  ref: { id: claim.ref.id, version: claim.ref.version },
  label: claim.label,
  status: claim.status,
  coverage: claim.coverage,
  supports: claim.supports
    .map((s) => ({
      ref: { id: s.ref.id, version: s.ref.version },
      from: { id: s.from.id, version: s.from.version },
      from_label: s.from_label,
      status: s.status,
      citation: s.citation
        ? {
            source: { id: s.citation.source.id, version: s.citation.source.version },
            label: s.citation.label,
            status: s.citation.status,
            location: s.citation.location,
            quote: s.citation.quote,
            historical: s.citation.historical
          }
        : null
    }))
    .sort((a, b) =>
      a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : a.ref.version - b.ref.version
    )
});
const index = (report: IntelligenceGraphEvidenceAudit) => {
  const claims = new Map<string, Claim>();
  for (const claim of report.claims) {
    if (claims.has(claim.ref.id)) throw new Error("Версии утверждения неоднозначны.");
    claims.set(claim.ref.id, ordered(claim));
  }
  return claims;
};

/** Compares literal audit entries by stable claim identity, never treating coverage as truth. */
export function compareEvidenceAudits(
  before: IntelligenceGraphEvidenceAudit,
  beforeSha256: string,
  after: IntelligenceGraphEvidenceAudit,
  afterSha256: string
): EvidenceComparison {
  if (
    before.format !== "kosmora.graph-evidence-audit.v1" ||
    after.format !== before.format ||
    before.graph.id !== after.graph.id ||
    before.graph.revision >= after.graph.revision ||
    ![beforeSha256, afterSha256].every((v) => /^[a-f0-9]{64}$/.test(v))
  )
    throw new Error(
      "Для сравнения нужны две проверенные ревизии одного графа в порядке от прежней к новой."
    );
  const left = index(before),
    right = index(after);
  const changes: EvidenceComparison["changes"] = [];
  let unchanged = 0;
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(id) ?? null,
      b = right.get(id) ?? null;
    if (a && b && JSON.stringify(a) === JSON.stringify(b)) {
      unchanged++;
      continue;
    }
    changes.push({ id, kind: !a ? "added" : !b ? "removed" : "changed", before: a, after: b });
  }
  return {
    format: "kosmora.graph-evidence-comparison.v1",
    usage:
      "Сравнение буквальных записей двух полных проверок источников: утверждения, статусы, поддерживающие связи и цитаты. Изменение покрытия или наличие цитаты не оценивает достоверность. Удалено означает отсутствие действующего утверждения в новом отчёте; история сохраняется. SHA-256 относятся к полным исходным аудитам.",
    before: { graph: { ...before.graph }, audit_sha256: beforeSha256 },
    after: { graph: { ...after.graph }, audit_sha256: afterSha256 },
    counts: {
      added: changes.filter((c) => c.kind === "added").length,
      removed: changes.filter((c) => c.kind === "removed").length,
      changed: changes.filter((c) => c.kind === "changed").length,
      unchanged
    },
    changes
  };
}
