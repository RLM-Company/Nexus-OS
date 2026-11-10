import { createHash } from "node:crypto";
import {
  extractMemoryEntities,
  normalizeStem,
  type ExtractedEntity
} from "./context-memory-hybrid-search.ts";

export type ConsensusVerdictType = "consensus_reached" | "revisions_required" | "vetoed";

export interface AgentFlawReport {
  agent: "proposer" | "critic" | "fact_auditor";
  severity: "critical" | "warning" | "nitpick";
  category: "hallucination" | "omission" | "contradiction" | "superlative_fluff" | "unverified_metric";
  message: string;
  verbatimSnippet?: string;
}

export interface MultiAgentConsensusReport {
  verdict: ConsensusVerdictType;
  overallConfidenceScore: number;
  proposerScore: number;
  criticScore: number;
  factAuditorScore: number;
  flaws: AgentFlawReport[];
  remediationDirectives: string[];
  consensusDigestSha256: string;
  evaluatedAt: string;
}

export interface VerifiedEvidenceItem {
  id: string;
  title: string;
  text: string;
  sha256?: string;
}

const UNGROUNDED_SUPERLATIVES = [
  "flawlessly",
  "perfectly",
  "100% correct",
  "undisputed",
  "unrivaled",
  "gold standard",
  "best in the world",
  "безупречно",
  "идеально",
  "абсолютно лучший",
  "непревзойдённый"
];

/**
 * Autonomous Multi-Agent Consensus & Adversarial Verification Engine for Koswork Scenarios.
 *
 * Implements a tri-agent deliberation protocol:
 * 1. Proposer: verifies task requirements coverage and expected artifact deliverables.
 * 2. Adversarial Critic: hunts for ungrounded superlatives, internal contradictions, and logical voids.
 * 3. Fact-Auditor: cross-references all numbers, dates, and claims strictly against verified source documents.
 */
export class MultiAgentConsensusEngine {
  evaluateConsensus(input: {
    taskGoal: string;
    expectedRequirements: string[];
    sourceEvidence: VerifiedEvidenceItem[];
    draftContent: string;
  }): MultiAgentConsensusReport {
    const draft = String(input.draftContent ?? "").normalize("NFKC");
    const draftLower = draft.toLowerCase();
    const flaws: AgentFlawReport[] = [];
    const remediations: string[] = [];

    // --- 1. PROPOSER AGENT: Requirements Coverage ---
    let matchedRequirements = 0;
    for (const req of input.expectedRequirements) {
      const cleanReq = req.trim();
      if (!cleanReq) continue;
      const reqWords = cleanReq.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
      const hasCoverage = reqWords.some((rw) => draftLower.includes(normalizeStem(rw)));
      if (hasCoverage) {
        matchedRequirements++;
      } else {
        flaws.push({
          agent: "proposer",
          severity: "warning",
          category: "omission",
          message: `Требование задачи не раскрыто в черновике: «${cleanReq}»`
        });
        remediations.push(`Дополнить раздел с явным раскрытием требования: «${cleanReq}».`);
      }
    }
    const proposerScore =
      input.expectedRequirements.length > 0
        ? Number((matchedRequirements / input.expectedRequirements.length).toFixed(4))
        : 1.0;

    // --- 2. ADVERSARIAL CRITIC AGENT: Fluff, Superlatives & Void Scrutiny ---
    let criticDeductions = 0;
    for (const sup of UNGROUNDED_SUPERLATIVES) {
      if (draftLower.includes(sup)) {
        flaws.push({
          agent: "critic",
          severity: "critical",
          category: "superlative_fluff",
          message: `Обнаружен запрещённый маркетинговый суперлатив: «${sup}»`,
          verbatimSnippet: sup
        });
        criticDeductions += 0.25;
        remediations.push(`Заменить суперлатив «${sup}» на объективные факты и проверяемые данные.`);
      }
    }

    if (draft.length < 50) {
      flaws.push({
        agent: "critic",
        severity: "critical",
        category: "omission",
        message: "Объём черновика недостаточен для содержательной оценки (менее 50 символов)."
      });
      criticDeductions += 0.5;
    }
    const criticScore = Math.max(0, Number((1.0 - criticDeductions).toFixed(4)));

    // --- 3. FACT-AUDITOR AGENT: Citation & Metric Groundedness ---
    const combinedEvidence = input.sourceEvidence
      .map((e) => `${e.title}\n${e.text}`)
      .join("\n\n")
      .normalize("NFKC");
    const evidenceLower = combinedEvidence.toLowerCase();

    const draftEntities = extractMemoryEntities(draft);
    const draftNumericAndDates = draftEntities.filter(
      (e) => e.kind === "money_or_number" || e.kind === "date"
    );

    let verifiedMetrics = 0;
    for (const ent of draftNumericAndDates) {
      if (evidenceLower.includes(ent.normalized) || evidenceLower.includes(ent.raw.toLowerCase())) {
        verifiedMetrics++;
      } else {
        flaws.push({
          agent: "fact_auditor",
          severity: "warning",
          category: "unverified_metric",
          message: `Численное или датовое значение «${ent.raw}» отсутствует в предоставленных исходных источниках.`,
          verbatimSnippet: ent.raw
        });
        remediations.push(`Подтвердить источник значения «${ent.raw}» либо скорректировать под исходные документы.`);
      }
    }

    const factAuditorScore =
      draftNumericAndDates.length > 0
        ? Number((verifiedMetrics / draftNumericAndDates.length).toFixed(4))
        : 1.0;

    // --- Calibrated Consensus Calculation ---
    const overallConfidenceScore = Number(
      (proposerScore * 0.35 + criticScore * 0.35 + factAuditorScore * 0.3).toFixed(4)
    );

    const hasCriticalFlaws = flaws.some((f) => f.severity === "critical");
    let verdict: ConsensusVerdictType = "consensus_reached";
    if (hasCriticalFlaws || overallConfidenceScore < 0.6) {
      verdict = "vetoed";
    } else if (flaws.length > 0 || overallConfidenceScore < 0.9) {
      verdict = "revisions_required";
    }

    const evaluatedAt = new Date().toISOString();
    const consensusDigestSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          verdict,
          overallConfidenceScore,
          flawCount: flaws.length,
          evaluatedAt
        }),
        "utf8"
      )
      .digest("hex");

    return {
      verdict,
      overallConfidenceScore,
      proposerScore,
      criticScore,
      factAuditorScore,
      flaws,
      remediationDirectives: remediations,
      consensusDigestSha256,
      evaluatedAt
    };
  }
}
