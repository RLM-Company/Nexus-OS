import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface ResearchBudgetLimits {
  maxDepth: number;
  maxSources: number;
  maxRuntimeMs: number;
}

export interface ResearchOwnerBudget {
  resolveLimits(
    ownerId: string,
    projectId: string | null,
    requested?: Partial<ResearchBudgetLimits>
  ): ResearchBudgetLimits;
  checkCanStartRun(ownerId: string, projectId: string | null): void;
}

export const DEFAULT_RESEARCH_BUDGET: ResearchBudgetLimits = {
  maxDepth: 2,
  maxSources: 6,
  maxRuntimeMs: 15_000
};

export const HARD_MAX_RESEARCH_BUDGET: ResearchBudgetLimits = {
  maxDepth: 4,
  maxSources: 12,
  maxRuntimeMs: 60_000
};

/**
 * Canonical owner & project budget enforcer imported by `apps/api/src/server.ts`:
 * `new ProjectResearchOwnerBudget(database.sqlite, projectStore, accountStore)`
 */
export class ProjectResearchOwnerBudget implements ResearchOwnerBudget {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly projectStore?: { getProject?(id: string, ownerId?: string): unknown } | null,
    private readonly accountStore?: { checkQuota?(ownerId: string): boolean } | null,
    private readonly defaults: ResearchBudgetLimits = DEFAULT_RESEARCH_BUDGET
  ) {}

  resolveLimits(
    _ownerId: string,
    _projectId: string | null,
    requested?: Partial<ResearchBudgetLimits>
  ): ResearchBudgetLimits {
    const rawDepth = requested?.maxDepth ?? this.defaults.maxDepth;
    const rawSources = requested?.maxSources ?? this.defaults.maxSources;
    const rawRuntime = requested?.maxRuntimeMs ?? this.defaults.maxRuntimeMs;

    return {
      maxDepth: Math.max(1, Math.min(Number(rawDepth) || 1, HARD_MAX_RESEARCH_BUDGET.maxDepth)),
      maxSources: Math.max(1, Math.min(Number(rawSources) || 1, HARD_MAX_RESEARCH_BUDGET.maxSources)),
      maxRuntimeMs: Math.max(
        500,
        Math.min(Number(rawRuntime) || this.defaults.maxRuntimeMs, HARD_MAX_RESEARCH_BUDGET.maxRuntimeMs)
      )
    };
  }

  checkCanStartRun(ownerId: string, projectId: string | null): void {
    const row = this.sqlite
      .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id = ?")
      .get(ownerId) as { state: string } | undefined;
    if (row && row.state !== "active") {
      throw new Error("OWNER_DATA_FENCED");
    }

    if (projectId) {
      if (this.projectStore && typeof this.projectStore.getProject === "function") {
        const proj = this.projectStore.getProject(projectId, ownerId);
        if (!proj) {
          throw new Error("RESEARCH_PROJECT_FORBIDDEN");
        }
      } else {
        const tableRow = this.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'"
          )
          .get() as { name: string } | undefined;
        if (tableRow) {
          const projRow = this.sqlite
            .prepare("SELECT owner_id FROM projects WHERE id = ?")
            .get(projectId) as { owner_id: string } | undefined;
          if (!projRow) {
            throw new Error("RESEARCH_PROJECT_NOT_FOUND");
          }
          if (projRow.owner_id !== ownerId) {
            throw new Error("RESEARCH_PROJECT_FORBIDDEN");
          }
        }
      }
    }

    if (this.accountStore && typeof this.accountStore.checkQuota === "function") {
      const ok = this.accountStore.checkQuota(ownerId);
      if (!ok) {
        throw new Error("RESEARCH_QUOTA_EXCEEDED");
      }
    }
  }
}

export interface EvidenceCitation {
  sourceId: string;
  sourceTitle: string;
  originalUrl: string;
  canonicalUrl: string;
  fetchedAt: string;
  publishedAt: string | null;
  pageVersion: string;
  previousPageVersion: string | null;
  pageChanged: boolean;
  verbatimQuote: string;
  startUtf16: number;
  endUtf16: number;
  quoteSha256: string;
  claimedValue: string;
}

export interface ClaimResolutionAudit {
  resolvedBy: string;
  resolvedAt: string;
  previousCategory: "confirmed" | "conflicting" | "unconfirmed";
  winningSourceId: string;
  winningCanonicalUrl: string;
  winningPageVersion: string;
  winningClaimedValue: string;
  resolutionNote: string;
}

export interface SynthesizedResearchClaim {
  claimId: string;
  subject: string;
  criterion: string;
  category: "confirmed" | "conflicting" | "unconfirmed";
  resolvedValue: string;
  conflictSummary: string | null;
  unconfirmedReason: string | null;
  citations: EvidenceCitation[];
  resolutionAudit?: ClaimResolutionAudit | null;
}

export interface CandidateClaimExtraction {
  subject: string;
  criterion: string;
  claimedValue: string;
  verbatimQuote: string;
  startUtf16?: number;
  endUtf16?: number;
}

export interface SourceRecordForSynthesis {
  sourceId: string;
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  fetchedAt: string;
  publishedAt: string | null;
  pageVersion: string;
  previousPageVersion: string | null;
  pageChanged: boolean;
  contentText: string;
  extractedClaims: CandidateClaimExtraction[];
}

const NEGATION_MARKERS = [
  "устарел",
  "отменён",
  "отменен",
  "не поддерживает",
  "опроверг",
  "deprecated",
  "discontinued",
  "not supported"
];

export function sha256Hex(input: string): string {
  return createHash("sha256").update(String(input ?? ""), "utf8").digest("hex");
}

export function normalizeClaimComparableValue(value: string): string {
  const clean = String(value ?? "").trim().toLowerCase().replace(/,/g, ".");
  const usdMatch = clean.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (usdMatch) {
    return `usd:${Number(usdMatch[1]).toFixed(2)}`;
  }
  const numUnit = clean.match(/(\d+(?:\.\d+)?)\s*(%|мс|ms|гб|gb|дней|days)/i);
  if (numUnit) {
    return `${Number(numUnit[1]).toFixed(2)}_${numUnit[2].toLowerCase()}`;
  }
  return clean.replace(/\s+/g, " ");
}

/**
 * Verifies that `verbatimQuote` is an exact slice of `source.contentText` at `[startUtf16..endUtf16]`,
 * matches `claimedValue`, and does not contain negation/deprecation markers contradicting the claim.
 */
export function verifyCandidateClaimAgainstSource(
  source: SourceRecordForSynthesis,
  candidate: CandidateClaimExtraction
): EvidenceCitation | null {
  const quote = String(candidate.verbatimQuote ?? "").trim();
  if (!quote) return null;

  const startUtf16 =
    typeof candidate.startUtf16 === "number" && candidate.startUtf16 >= 0
      ? candidate.startUtf16
      : source.contentText.indexOf(quote);
  if (startUtf16 < 0) return null;

  const endUtf16 =
    typeof candidate.endUtf16 === "number" && candidate.endUtf16 > startUtf16
      ? candidate.endUtf16
      : startUtf16 + quote.length;

  if (source.contentText.slice(startUtf16, endUtf16) !== quote) {
    return null;
  }

  const quoteLower = quote.toLowerCase().replace(/,/g, ".");
  const valLower = String(candidate.claimedValue ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (!valLower) return null;

  const numbers = valLower.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const num of numbers) {
    if (!quoteLower.includes(num)) {
      return null;
    }
  }
  if (numbers.length === 0 && !quoteLower.includes(valLower)) {
    return null;
  }

  for (const neg of NEGATION_MARKERS) {
    if (quoteLower.includes(neg) && !valLower.includes(neg)) {
      return null;
    }
  }

  return {
    sourceId: source.sourceId,
    sourceTitle: source.title,
    originalUrl: source.originalUrl,
    canonicalUrl: source.canonicalUrl,
    fetchedAt: source.fetchedAt,
    publishedAt: source.publishedAt,
    pageVersion: source.pageVersion,
    previousPageVersion: source.previousPageVersion,
    pageChanged: source.pageChanged,
    verbatimQuote: quote,
    startUtf16,
    endUtf16,
    quoteSha256: sha256Hex(quote),
    claimedValue: candidate.claimedValue
  };
}

/**
 * Synthesizes verified source citations into three strictly separated categories:
 * - `confirmed` (all sources agree)
 * - `conflicting` (sources provide conflicting values; both positions and quotes are preserved)
 * - `unconfirmed` (no verified quote found; marked `"не удалось установить"`)
 */
export function synthesizeResearchClaims(params: {
  runId: string;
  expectedTargets: Array<{ subject: string; criterion: string }>;
  sources: SourceRecordForSynthesis[];
}): {
  allClaims: SynthesizedResearchClaim[];
  confirmedClaims: SynthesizedResearchClaim[];
  conflictingClaims: SynthesizedResearchClaim[];
  unconfirmedClaims: SynthesizedResearchClaim[];
} {
  const citationsByKey = new Map<string, EvidenceCitation[]>();

  for (const source of params.sources) {
    for (const candidate of source.extractedClaims) {
      const verified = verifyCandidateClaimAgainstSource(source, candidate);
      if (!verified) continue;
      const key = `${candidate.subject}:::${candidate.criterion}`;
      const list = citationsByKey.get(key) ?? [];
      // Deduplicate identical (canonicalUrl, quoteSha256)
      if (
        !list.some(
          (item) =>
            item.canonicalUrl === verified.canonicalUrl &&
            item.quoteSha256 === verified.quoteSha256
        )
      ) {
        list.push(verified);
      }
      citationsByKey.set(key, list);
    }
  }

  const targetKeys = new Set<string>();
  const orderedTargets: Array<{ subject: string; criterion: string }> = [];

  for (const t of params.expectedTargets) {
    const k = `${t.subject}:::${t.criterion}`;
    if (!targetKeys.has(k)) {
      targetKeys.add(k);
      orderedTargets.push(t);
    }
  }
  for (const k of citationsByKey.keys()) {
    if (!targetKeys.has(k)) {
      targetKeys.add(k);
      const [subject, criterion] = k.split(":::");
      orderedTargets.push({ subject, criterion });
    }
  }

  const allClaims: SynthesizedResearchClaim[] = [];
  let idx = 1;

  for (const { subject, criterion } of orderedTargets) {
    const key = `${subject}:::${criterion}`;
    const citations = citationsByKey.get(key) ?? [];
    const claimId = `clm-${params.runId}-${idx++}`;

    if (citations.length === 0) {
      allClaims.push({
        claimId,
        subject,
        criterion,
        category: "unconfirmed",
        resolvedValue: "не удалось установить",
        conflictSummary: null,
        unconfirmedReason: "Подтверждающая цитата в проверенных источниках не обнаружена.",
        citations: [],
        resolutionAudit: null
      });
      continue;
    }

    const byNormValue = new Map<string, EvidenceCitation[]>();
    for (const cit of citations) {
      const norm = normalizeClaimComparableValue(cit.claimedValue);
      const bucket = byNormValue.get(norm) ?? [];
      bucket.push(cit);
      byNormValue.set(norm, bucket);
    }

    if (byNormValue.size === 1) {
      allClaims.push({
        claimId,
        subject,
        criterion,
        category: "confirmed",
        resolvedValue: citations[0].claimedValue,
        conflictSummary: null,
        unconfirmedReason: null,
        citations,
        resolutionAudit: null
      });
    } else {
      const sortedCitations = [...citations].sort((a, b) =>
        String(b.publishedAt ?? b.fetchedAt).localeCompare(String(a.publishedAt ?? a.fetchedAt))
      );
      const distinctValues = Array.from(byNormValue.values()).map((b) => b[0].claimedValue);
      allClaims.push({
        claimId,
        subject,
        criterion,
        category: "conflicting",
        resolvedValue: sortedCitations[0].claimedValue,
        conflictSummary: `Конфликт источников по параметру «${criterion}» (${subject}): ${distinctValues.join(" против ")}`,
        unconfirmedReason: null,
        citations: sortedCitations,
        resolutionAudit: null
      });
    }
  }

  return {
    allClaims,
    confirmedClaims: allClaims.filter((c) => c.category === "confirmed"),
    conflictingClaims: allClaims.filter((c) => c.category === "conflicting"),
    unconfirmedClaims: allClaims.filter((c) => c.category === "unconfirmed")
  };
}

/**
 * Renders deterministic Markdown report with verifiable links, exact quotes, pageVersion,
 * fetchedAt, and three distinct sections (confirmed, conflicting, unconfirmed).
 * Used identically by both the backend store/export and the UI report export.
 */
export function renderDeterministicResearchReportMarkdown(params: {
  runId: string;
  query: string;
  status: string;
  sources: Array<{
    sourceId: string;
    title: string;
    originalUrl: string;
    canonicalUrl: string;
    fetchedAt: string;
    pageVersion: string;
    previousPageVersion: string | null;
    pageChanged: boolean;
  }>;
  confirmedClaims: SynthesizedResearchClaim[];
  conflictingClaims: SynthesizedResearchClaim[];
  unconfirmedClaims: SynthesizedResearchClaim[];
}): string {
  const lines: string[] = [];
  lines.push(`# Исследовательский отчёт: ${params.query}`);
  lines.push(`- **ID задачи:** \`${params.runId}\``);
  lines.push(`- **Статус:** \`${params.status}\``);
  lines.push("");

  lines.push("## 1. Подтверждённые утверждения");
  if (params.confirmedClaims.length === 0) {
    lines.push("- Нет однозначно подтверждённых утверждений.");
  } else {
    for (const claim of params.confirmedClaims) {
      const auditBadge = claim.resolutionAudit
        ? ` [конфликт разрешён: источник \`${claim.resolutionAudit.winningPageVersion}\` (${claim.resolutionAudit.winningCanonicalUrl}), примечание: ${claim.resolutionAudit.resolutionNote}]`
        : "";
      lines.push(`- **${claim.subject} — ${claim.criterion}:** ${claim.resolvedValue}${auditBadge}`);
      for (const cit of claim.citations) {
        const changedBadge = cit.pageChanged
          ? ` [страница обновилась: ${cit.previousPageVersion} -> ${cit.pageVersion}]`
          : "";
        lines.push(
          `  - Цитата: «${cit.verbatimQuote}» — [${cit.sourceTitle}](${cit.originalUrl}) (версия: \`${cit.pageVersion}\`${changedBadge}, получено: \`${cit.fetchedAt}\`, UTF-16: \`[${cit.startUtf16}..${cit.endUtf16}]\`)`
        );
      }
    }
  }
  lines.push("");

  lines.push("## 2. Противоречащие утверждения (конфликт источников)");
  if (params.conflictingClaims.length === 0) {
    lines.push("- Противоречий между источниками не зафиксировано.");
  } else {
    for (const claim of params.conflictingClaims) {
      lines.push(
        `- **${claim.subject} — ${claim.criterion}:** ${claim.conflictSummary ?? claim.resolvedValue} (приоритетное значение: ${claim.resolvedValue})`
      );
      for (const cit of claim.citations) {
        lines.push(
          `  - Позиция \`${cit.claimedValue}\`: «${cit.verbatimQuote}» — [${cit.sourceTitle}](${cit.originalUrl}) (версия: \`${cit.pageVersion}\`, получено: \`${cit.fetchedAt}\`, UTF-16: \`[${cit.startUtf16}..${cit.endUtf16}]\`)`
        );
      }
    }
  }
  lines.push("");

  lines.push("## 3. Неподтверждённые утверждения");
  if (params.unconfirmedClaims.length === 0) {
    lines.push("- Все целевые параметры получили подтверждение.");
  } else {
    for (const claim of params.unconfirmedClaims) {
      lines.push(
        `- **${claim.subject} — ${claim.criterion}:** ${claim.resolvedValue} (${claim.unconfirmedReason ?? "нет данных"})`
      );
    }
  }
  lines.push("");

  lines.push("## 4. Проверенные источники");
  for (const src of params.sources) {
    const changeNote = src.pageChanged
      ? ` (обновлена с ${src.previousPageVersion} до ${src.pageVersion})`
      : "";
    lines.push(
      `- [${src.title}](${src.originalUrl}) — канонический URL: \`${src.canonicalUrl}\`, версия: \`${src.pageVersion}\`${changeNote}, получено: \`${src.fetchedAt}\``
    );
  }

  return lines.join("\n") + "\n";
}
