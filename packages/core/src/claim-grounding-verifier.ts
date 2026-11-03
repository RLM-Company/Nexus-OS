/**
 * Kosmora / Nexus-OS Zero-Hallucination Citation & Claim Grounding Verifier (Wave 18)
 *
 * Audits generated reports, chat responses, and Word (.docx) deliverables to enforce:
 * 1. Dedicated Source URLs: Rejects bare domain roots (e.g., https://domain.com/), placeholder links,
 *    and bracketed footers ([1], [2]).
 * 2. Claim-Source Fidelity: Verifies that every numeric figure, currency amount, percentage, or date
 *    in the drafted text is explicitly present in the retrieved primary source corpus.
 * 3. Actionable Remediation: Generates exact correction instructions when ungrounded claims or generic URLs
 *    are detected.
 */

export interface GroundingSourceDocument {
  id: string;
  title: string;
  url?: string;
  content: string;
}

export interface GroundingViolation {
  type: "bare_domain_url" | "bracketed_citation" | "ungrounded_metric" | "ungrounded_date" | "fabricated_url";
  severity: "critical" | "warning";
  snippet: string;
  message: string;
  remediation: string;
}

export interface ClaimGroundingAuditReport {
  passed: boolean;
  fidelityScore: number; // 0.0 to 1.0
  totalLinksChecked: number;
  dedicatedLinksCount: number;
  totalClaimsChecked: number;
  groundedClaimsCount: number;
  violations: GroundingViolation[];
  remediationSummary: string[];
}

const BRACKETED_CITATION_REGEX = /\[(\d+|source|источник|ссылка)\]/gi;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const METRIC_CLAIM_REGEX = /(?:\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:%|млн|тыс|руб|USD|EUR|GB|MB|ms|s))/gi;
const DATE_CLAIM_REGEX = /\b(?:\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4})\b/gi;

export function isBareDomainHomepage(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    const hasSearch = parsed.search && parsed.search.length > 1;
    const hasHash = parsed.hash && parsed.hash.length > 1;
    return cleanPath === "" && !hasSearch && !hasHash;
  } catch {
    return true;
  }
}

export class ClaimGroundingVerifier {
  /**
   * Audits a drafted response or report against the verified primary source documents.
   */
  public verifyDraftGrounding(options: {
    draftText: string;
    sources: GroundingSourceDocument[];
    requireSourceUrlInCorpus?: boolean;
  }): ClaimGroundingAuditReport {
    const draft = String(options.draftText ?? "");
    const violations: GroundingViolation[] = [];
    const corpusText = options.sources.map((s) => `${s.title}\n${s.content}`).join("\n\n");
    const corpusLower = corpusText.toLowerCase();
    const knownUrls = new Set(
      options.sources.map((s) => s.url?.trim()).filter((u): u is string => Boolean(u))
    );

    // 1. Check for forbidden bracketed citations like [1], [2]
    let bracketMatch: RegExpExecArray | null;
    BRACKETED_CITATION_REGEX.lastIndex = 0;
    while ((bracketMatch = BRACKETED_CITATION_REGEX.exec(draft)) !== null) {
      violations.push({
        type: "bracketed_citation",
        severity: "critical",
        snippet: bracketMatch[0],
        message: `Forbidden bracketed citation '${bracketMatch[0]}' detected instead of inline entity hyperlink.`,
        remediation: `Replace '${bracketMatch[0]}' with an inline markdown link [Entity Name](Dedicated_URL).`
      });
    }

    // 2. Check all markdown hyperlinks for bare domain homepages or unverified URLs
    let totalLinksChecked = 0;
    let dedicatedLinksCount = 0;
    let linkMatch: RegExpExecArray | null;
    MARKDOWN_LINK_REGEX.lastIndex = 0;

    while ((linkMatch = MARKDOWN_LINK_REGEX.exec(draft)) !== null) {
      totalLinksChecked++;
      const anchor = linkMatch[1];
      const url = linkMatch[2];

      if (isBareDomainHomepage(url)) {
        violations.push({
          type: "bare_domain_url",
          severity: "critical",
          snippet: linkMatch[0],
          message: `Link '${anchor}' points to a bare homepage (${url}) instead of a specific entity page.`,
          remediation: `Update link for '${anchor}' to point to the exact deep path or document viewUrl.`
        });
        continue;
      }

      if (options.requireSourceUrlInCorpus && knownUrls.size > 0 && !knownUrls.has(url)) {
        violations.push({
          type: "fabricated_url",
          severity: "critical",
          snippet: linkMatch[0],
          message: `URL '${url}' was not found in the retrieved tool source corpus.`,
          remediation: `Use only verified URLs from tool outputs: ${Array.from(knownUrls).slice(0, 3).join(", ")}`
        });
        continue;
      }

      dedicatedLinksCount++;
    }

    // 3. Verify numeric metrics and currency claims against primary source corpus
    let totalClaimsChecked = 0;
    let groundedClaimsCount = 0;

    const metrics = draft.match(METRIC_CLAIM_REGEX) ?? [];
    for (const rawMetric of metrics) {
      totalClaimsChecked++;
      const cleanMetric = rawMetric.trim().toLowerCase();
      // Normalize commas in numbers for matching (e.g. $250,000 vs 250000)
      const strippedDigits = cleanMetric.replace(/,/g, "");
      const corpusStripped = corpusLower.replace(/,/g, "");

      if (corpusLower.includes(cleanMetric) || corpusStripped.includes(strippedDigits)) {
        groundedClaimsCount++;
      } else {
        violations.push({
          type: "ungrounded_metric",
          severity: "critical",
          snippet: rawMetric,
          message: `Numeric claim '${rawMetric}' is not supported by any retrieved source document.`,
          remediation: `Remove unverified figure '${rawMetric}' or replace with exact figure from primary source.`
        });
      }
    }

    // 4. Verify dates against primary source corpus
    const dates = draft.match(DATE_CLAIM_REGEX) ?? [];
    for (const rawDate of dates) {
      totalClaimsChecked++;
      const cleanDate = rawDate.trim().toLowerCase();
      if (corpusLower.includes(cleanDate)) {
        groundedClaimsCount++;
      } else {
        violations.push({
          type: "ungrounded_date",
          severity: "warning",
          snippet: rawDate,
          message: `Date claim '${rawDate}' does not appear verbatim in the retrieved source text.`,
          remediation: `Verify date '${rawDate}' against primary source or omit unverified date.`
        });
      }
    }

    const totalChecks = Math.max(1, totalLinksChecked + totalClaimsChecked + violations.length);
    const criticalCount = violations.filter((v) => v.severity === "critical").length;
    const fidelityScore = Number(
      Math.max(0, (totalChecks - violations.length) / totalChecks).toFixed(4)
    );

    return {
      passed: criticalCount === 0,
      fidelityScore,
      totalLinksChecked,
      dedicatedLinksCount,
      totalClaimsChecked,
      groundedClaimsCount,
      violations,
      remediationSummary: violations.map((v) => v.remediation)
    };
  }
}
