import * as crypto from "node:crypto";
import {
  ResearchContradictionGroup,
  ResearchEvidenceRecord,
  ResearchProjectArtifactHandoff,
  ResearchSessionRecord,
  ResearchSourceSnapshot,
  ResearchSubQuestion,
} from "./contracts";
import { InMemoryResearchStore } from "./store";

const NEGATION_MARKERS = [
  "устар",
  "deprecated",
  "не поддерж",
  "опроверг",
  "неверно",
  "отменён",
  "отменен",
  "false",
];

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function canonicalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"].forEach((p) =>
      parsed.searchParams.delete(p)
    );
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return String(rawUrl || "").trim();
  }
}

function normalizeText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeClaimValue(rawValue: string): string {
  const text = normalizeText(rawValue);
  const priceMatch = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (priceMatch) return `usd:${Number(priceMatch[1]).toFixed(2)}`;
  const numMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(ms|мс|gb|гб|%|days|дней|дня)/i);
  if (numMatch) {
    return `${Number(numMatch[1].replace(",", "."))}_${numMatch[2].toLowerCase()}`;
  }
  return text;
}

function verifyClaimEntailment(params: {
  optionName: string;
  criterion: string;
  claimedValue: string;
  verbatimQuote: string;
}): { ok: boolean; code?: string; message?: string } {
  const quoteNorm = normalizeText(params.verbatimQuote);
  const valueNorm = normalizeText(params.claimedValue);
  if (!valueNorm) {
    return { ok: false, code: "EMPTY_CLAIMED_VALUE", message: "Заявленное значение пусто." };
  }
  const valueDigits = valueNorm.match(/\d+(?:[.,]\d+)?/g) || [];
  if (valueDigits.length > 0) {
    for (const num of valueDigits) {
      if (!quoteNorm.includes(num)) {
        return {
          ok: false,
          code: "CLAIM_VALUE_NOT_IN_QUOTE",
          message: `Цитата не содержит числового значения "${num}" из проверяемого тезиса "${params.claimedValue}".`,
        };
      }
    }
  } else if (!quoteNorm.includes(valueNorm)) {
    return {
      ok: false,
      code: "CLAIM_VALUE_NOT_IN_QUOTE",
      message: `Цитата не подтверждает значение "${params.claimedValue}".`,
    };
  }

  for (const neg of NEGATION_MARKERS) {
    if (quoteNorm.includes(neg) && !valueNorm.includes(neg)) {
      return {
        ok: false,
        code: "QUOTE_CONTAINS_NEGATION_OR_DEPRECATION",
        message: `Цитата содержит маркер отрицания или устаревания ("${neg}") и не может подтверждать тезис "${params.claimedValue}".`,
      };
    }
  }
  return { ok: true };
}

export class ResearchService {
  constructor(private readonly store: InMemoryResearchStore = new InMemoryResearchStore()) {}

  createSession(input: {
    projectId?: string | null;
    title: string;
    goal: string;
    options: string[];
    criteria: string[];
    maxQueriesPerQuestion?: number;
    maxTotalQueries?: number;
  }): ResearchSessionRecord {
    const now = new Date().toISOString();
    const maxQueriesPerQuestion = input.maxQueriesPerQuestion ?? 2;
    const maxTotalQueries = input.maxTotalQueries ?? 10;
    const subQuestions: ResearchSubQuestion[] = [];
    let idx = 1;
    for (const optionName of input.options) {
      for (const criterion of input.criteria) {
        subQuestions.push({
          id: `sq-${idx++}`,
          optionName,
          criterion,
          queryText: `${optionName} ${criterion}`.trim(),
          status: "pending",
          queriesExecuted: 0,
          maxQueries: maxQueriesPerQuestion,
          confirmedValue: null,
        });
      }
    }

    const session: ResearchSessionRecord = {
      sessionId: `res-${crypto.randomUUID().slice(0, 8)}`,
      projectId: input.projectId ?? null,
      title: input.title,
      goal: input.goal,
      options: [...input.options],
      criteria: [...input.criteria],
      status: "running",
      maxQueriesPerQuestion,
      maxTotalQueries,
      queriesExecuted: 0,
      subQuestions,
      sources: [],
      unavailableSources: [],
      evidence: [],
      contradictions: [],
      checkpoint: null,
      projectHandoff: null,
      createdAt: now,
      updatedAt: now,
    };

    return this.store.saveSession(session);
  }

  recordSearchQuery(sessionId: string, questionId: string): ResearchSessionRecord {
    const session = this.requireSession(sessionId);
    const question = session.subQuestions.find((q) => q.id === questionId);
    if (!question) {
      throw new Error(`SUBQUESTION_NOT_FOUND: ${questionId}`);
    }
    if (session.queriesExecuted >= session.maxTotalQueries) {
      throw new Error("RESEARCH_TOTAL_QUERY_BUDGET_EXCEEDED");
    }
    if (question.queriesExecuted >= question.maxQueries) {
      question.status = "exhausted";
      this.store.saveSession(session);
      throw new Error(`RESEARCH_QUESTION_QUERY_BUDGET_EXCEEDED: ${questionId}`);
    }
    question.queriesExecuted += 1;
    session.queriesExecuted += 1;
    session.updatedAt = new Date().toISOString();
    return this.store.saveSession(session);
  }

  registerSourceSnapshot(
    sessionId: string,
    input: {
      url: string;
      title: string;
      textContent: string;
      publishedDate?: string | null;
      fetchedAt?: string;
      readingLimitations?: string[];
    }
  ): { session: ResearchSessionRecord; deduplicated: boolean; source: ResearchSourceSnapshot } {
    const session = this.requireSession(sessionId);
    const canonicalUrl = canonicalizeUrl(input.url);
    const contentFingerprint = sha256Hex(normalizeText(input.textContent)).slice(0, 24);

    const existing = session.sources.find(
      (s) => s.canonicalUrl === canonicalUrl || s.contentFingerprint === contentFingerprint
    );
    if (existing) {
      return { session, deduplicated: true, source: existing };
    }

    const contentHash = sha256Hex(input.textContent);
    const source: ResearchSourceSnapshot = {
      sourceId: `src-${session.sources.length + 1}`,
      url: input.url,
      canonicalUrl,
      title: input.title,
      domain: (() => {
        try {
          return new URL(input.url).hostname.toLowerCase();
        } catch {
          return "unknown";
        }
      })(),
      pageVersion: `pv-${contentHash.slice(0, 12)}`,
      contentHash,
      contentFingerprint,
      fetchedAt: input.fetchedAt || new Date().toISOString(),
      publishedDate: input.publishedDate ?? null,
      textContent: input.textContent,
      readingLimitations: input.readingLimitations ? [...input.readingLimitations] : [],
    };
    session.sources.push(source);
    session.updatedAt = new Date().toISOString();
    return {
      session: this.store.saveSession(session),
      deduplicated: false,
      source,
    };
  }

  recordUnavailableSource(
    sessionId: string,
    input: { url: string; status: number; reason: string }
  ): ResearchSessionRecord {
    const session = this.requireSession(sessionId);
    session.unavailableSources.push({
      url: input.url,
      status: input.status,
      reason: input.reason,
      recordedAt: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    return this.store.saveSession(session);
  }

  attachVerifiableEvidence(
    sessionId: string,
    input: {
      sourceId: string;
      optionName: string;
      criterion: string;
      claimedValue: string;
      verbatimQuote: string;
      startUtf16?: number;
      endUtf16?: number;
    }
  ): ResearchSessionRecord {
    const session = this.requireSession(sessionId);
    const source = session.sources.find((s) => s.sourceId === input.sourceId);
    if (!source) {
      throw new Error(`EVIDENCE_SOURCE_NOT_FOUND: ${input.sourceId}`);
    }
    const quote = String(input.verbatimQuote || "");
    if (!quote.trim()) {
      throw new Error("EVIDENCE_EMPTY_QUOTE");
    }

    const startUtf16 =
      typeof input.startUtf16 === "number" ? input.startUtf16 : source.textContent.indexOf(quote);
    const endUtf16 =
      typeof input.endUtf16 === "number" ? input.endUtf16 : startUtf16 + quote.length;

    if (startUtf16 < 0 || source.textContent.slice(startUtf16, endUtf16) !== quote) {
      throw new Error("EVIDENCE_QUOTE_NOT_FOUND_IN_SNAPSHOT");
    }

    // Rule #4: Non-empty quote and hash do NOT prove a claim without semantic correspondence & negation check
    const entailment = verifyClaimEntailment({
      optionName: input.optionName,
      criterion: input.criterion,
      claimedValue: input.claimedValue,
      verbatimQuote: quote,
    });
    if (!entailment.ok) {
      throw new Error(`${entailment.code}: ${entailment.message}`);
    }

    const evidence: ResearchEvidenceRecord = {
      evidenceId: `ev-${session.evidence.length + 1}`,
      sourceId: source.sourceId,
      sourceUrl: source.url,
      sourceTitle: source.title,
      optionName: input.optionName,
      criterion: input.criterion,
      claimedValue: input.claimedValue,
      verbatimQuote: quote,
      startUtf16,
      endUtf16,
      quoteSha256: sha256Hex(quote),
      pageVersion: source.pageVersion,
      fetchedAt: source.fetchedAt,
      publishedDate: source.publishedDate,
      readingLimitations: [...source.readingLimitations],
      claimEntailed: true,
      verified: true,
    };

    session.evidence.push(evidence);
    this.recomputeContradictionsAndSubQuestions(session);
    session.updatedAt = new Date().toISOString();
    return this.store.saveSession(session);
  }

  cancelSessionWithCheckpoint(sessionId: string, phase: string): ResearchSessionRecord {
    const session = this.requireSession(sessionId);
    session.status = "cancelled";
    session.checkpoint = {
      phase,
      completedQuestionIds: session.subQuestions
        .filter((q) => q.status === "answered")
        .map((q) => q.id),
      queriesExecuted: session.queriesExecuted,
      savedAt: new Date().toISOString(),
    };
    session.updatedAt = new Date().toISOString();
    return this.store.saveSession(session);
  }

  resumeSessionFromCheckpoint(sessionId: string): ResearchSessionRecord {
    const session = this.requireSession(sessionId);
    if (!session.checkpoint) {
      throw new Error("RESEARCH_CHECKPOINT_NOT_FOUND");
    }
    session.status = "running";
    session.updatedAt = new Date().toISOString();
    return this.store.saveSession(session);
  }

  finalizeAndHandoffToProject(
    sessionId: string,
    onProjectArtifactReady?: (handoff: ResearchProjectArtifactHandoff) => void
  ): ResearchSessionRecord {
    const session = this.requireSession(sessionId);
    this.recomputeContradictionsAndSubQuestions(session);
    for (const sq of session.subQuestions) {
      if (sq.status === "pending" || sq.status === "exhausted") {
        sq.status = "unconfirmed";
        sq.confirmedValue = "не удалось установить";
      }
    }

    const lines: string[] = [];
    lines.push(`# ${session.title}`);
    lines.push("");
    lines.push(`**Цель исследования:** ${session.goal}`);
    lines.push("");
    lines.push("## Сравнительная таблица (с честным статусом неподтверждённых полей)");
    lines.push("");
    lines.push(`| Вариант | ${session.criteria.join(" | ")} |`);
    lines.push(`| --- | ${session.criteria.map(() => "---").join(" | ")} |`);

    for (const optionName of session.options) {
      const cells = session.criteria.map((criterion) => {
        const group = session.contradictions.find(
          (g) => g.optionName === optionName && g.criterion === criterion
        );
        if (!group) return "не удалось установить";
        return group.hasConflict ? `${group.winningValue} (противоречие источников)` : group.winningValue;
      });
      lines.push(`| **${optionName}** | ${cells.join(" | ")} |`);
    }

    if (session.unavailableSources.length > 0) {
      lines.push("");
      lines.push("## Явно недоступные источники");
      for (const u of session.unavailableSources) {
        lines.push(`- ${u.url} — HTTP ${u.status} (${u.reason})`);
      }
    }

    const confirmedCount = session.subQuestions.filter((q) => q.status === "answered").length;
    const unconfirmedCount = session.subQuestions.filter((q) => q.status === "unconfirmed").length;
    const contradictionCount = session.contradictions.filter((c) => c.hasConflict).length;

    const handoff: ResearchProjectArtifactHandoff = {
      artifactId: `art-${session.sessionId}`,
      projectId: session.projectId || "default-project",
      title: session.title,
      markdownReport: lines.join("\n"),
      confirmedCount,
      unconfirmedCount,
      contradictionCount,
      exportedAt: new Date().toISOString(),
    };

    session.projectHandoff = handoff;
    session.status = "completed";
    session.updatedAt = new Date().toISOString();
    const saved = this.store.saveSession(session);
    if (onProjectArtifactReady) {
      onProjectArtifactReady(handoff);
    }
    return saved;
  }

  getSession(sessionId: string): ResearchSessionRecord {
    return this.requireSession(sessionId);
  }

  private requireSession(sessionId: string): ResearchSessionRecord {
    const found = this.store.getSession(sessionId);
    if (!found) {
      throw new Error(`RESEARCH_SESSION_NOT_FOUND: ${sessionId}`);
    }
    return found;
  }

  private recomputeContradictionsAndSubQuestions(session: ResearchSessionRecord): void {
    const bucketMap = new Map<string, ResearchEvidenceRecord[]>();
    for (const ev of session.evidence) {
      const key = `${ev.optionName}:::${ev.criterion}`;
      const list = bucketMap.get(key) || [];
      list.push(ev);
      bucketMap.set(key, list);
    }

    const groups: ResearchContradictionGroup[] = [];
    for (const [key, items] of bucketMap.entries()) {
      const [optionName, criterion] = key.split(":::");
      const perspectiveMap = new Map<
        string,
        {
          normalizedValue: string;
          displayValue: string;
          sources: ResearchContradictionGroup["perspectives"][number]["sources"];
        }
      >();

      for (const item of items) {
        const norm = normalizeClaimValue(item.claimedValue);
        const existing = perspectiveMap.get(norm) || {
          normalizedValue: norm,
          displayValue: item.claimedValue,
          sources: [],
        };
        existing.sources.push({
          sourceId: item.sourceId,
          sourceTitle: item.sourceTitle,
          sourceUrl: item.sourceUrl,
          publishedDate: item.publishedDate,
          verbatimQuote: item.verbatimQuote,
          pageVersion: item.pageVersion,
          fetchedAt: item.fetchedAt,
        });
        perspectiveMap.set(norm, existing);
      }

      const perspectives = Array.from(perspectiveMap.values());
      const hasConflict = perspectives.length > 1;
      const sortedItems = [...items].sort((a, b) =>
        String(b.publishedDate || "").localeCompare(String(a.publishedDate || ""))
      );
      const newest = sortedItems[0];

      groups.push({
        optionName,
        criterion,
        hasConflict,
        conflictSummary: hasConflict
          ? `Обнаружено расхождение между источниками (${perspectives
              .map((p) => p.displayValue)
              .join(" vs ")})`
          : null,
        winningValue: newest.claimedValue,
        resolutionReason: hasConflict
          ? `Приоритет отдан более свежему источнику (${newest.publishedDate || "без даты"}), альтернативная позиция сохранена.`
          : "Единогласное подтверждение источниками.",
        perspectives,
      });

      const subQuestion = session.subQuestions.find(
        (sq) => sq.optionName === optionName && sq.criterion === criterion
      );
      if (subQuestion) {
        subQuestion.status = "answered";
        subQuestion.confirmedValue = newest.claimedValue;
      }
    }

    session.contradictions = groups;
  }
}
