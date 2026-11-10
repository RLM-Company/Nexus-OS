import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  containsSensitiveSecret,
  extractMemoryEntities,
  normalizeStem,
  type ExtractedEntity
} from "./context-memory-hybrid-search.ts";

export type CompactionTopicKey =
  | "budget_and_limits"
  | "architecture_and_storage"
  | "schedule_and_deadlines"
  | "security_and_privacy"
  | "ui_and_frozen_visuals"
  | "general_context";

export interface CompactionMessageInput {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface TopicChangeEvent {
  topic: CompactionTopicKey;
  subjectStem: string;
  previousMessageId: string;
  previousQuote: string;
  previousValue: string;
  currentMessageId: string;
  currentQuote: string;
  currentValue: string;
  changedAt: string;
}

export interface CompactedTopicSpan {
  id: string;
  topic: CompactionTopicKey;
  messageId: string;
  role: "user" | "assistant";
  verbatimQuote: string;
  quoteSha256: string;
  createdAt: string;
  isProtectedConstraint: boolean;
  supersededByMessageId: string | null;
  entities: ExtractedEntity[];
}

export interface TopicCompactionCapsule {
  topic: CompactionTopicKey;
  topicLabelRu: string;
  activeSpans: CompactedTopicSpan[];
  supersededSpans: CompactedTopicSpan[];
  changeEvents: TopicChangeEvent[];
  sourceMessageIds: string[];
}

export interface CompactionFidelityMetrics {
  mandatoryConstraintTotal: number;
  mandatoryConstraintRetained: number;
  mandatoryConstraintRetentionRate: number;
  numericAndDateEntityTotal: number;
  numericAndDateEntityRetained: number;
  numericAndDateEntityRetentionRate: number;
  topicCoverageRate: number;
  semanticLossScore: number;
  compressionRatio: number;
}

export interface TopicHistoryCompactionReport {
  method: "verified-topic-compaction-v2";
  state: "disabled" | "not_needed" | "applied" | "blocked" | "skipped";
  reason:
    | "off"
    | "short_history"
    | "manual_summary"
    | "unsupported_material"
    | "input_limit"
    | "protected_budget"
    | "no_saving"
    | "ready";
  original_messages: number;
  compacted_messages: number;
  source_bytes: number;
  capsule_bytes: number;
  protected_spans: number;
  protected_kept: number;
  omitted_spans: number;
  sensitive_messages: number;
  duplicate_spans: number;
  topic_count: number;
  change_events_count: number;
  fidelity: CompactionFidelityMetrics;
}

export interface TopicCompactedHistoryResult {
  capsules: TopicCompactionCapsule[];
  recentTailMessages: CompactionMessageInput[];
  report: TopicHistoryCompactionReport;
  dispatchBlocked: boolean;
}

const TOPIC_LABELS_RU: Record<CompactionTopicKey, string> = {
  budget_and_limits: "Бюджет, токены и лимиты",
  architecture_and_storage: "Архитектура, БД и хранилище",
  schedule_and_deadlines: "Сроки, этапы и расписание",
  security_and_privacy: "Безопасность, ключи и приватность",
  ui_and_frozen_visuals: "Интерфейс и ограничения визуала",
  general_context: "Общий рабочий контекст"
};

const TOPIC_KEYWORDS: Array<{ topic: CompactionTopicKey; pattern: RegExp }> = [
  {
    topic: "budget_and_limits",
    pattern: /(?:^|[^\p{L}\p{N}_])(?:бюджет|лимит|токен|стоимост|расход|потолок|байт|квот|budget|limit|token|cost|price|mib|kb)/iu
  },
  {
    topic: "ui_and_frozen_visuals",
    pattern: /(?:^|[^\p{L}\p{N}_])(?:визуал|сайдбар|логотип|интерфейс|экран|стил|css|studio|sidebar|ui|layout)/iu
  },
  {
    topic: "security_and_privacy",
    pattern: /(?:^|[^\p{L}\p{N}_])(?:безопасност|приватност|шифрован|доступ|секрет|аудит|ssrf|oauth|privacy|security|fence|quiesce)/iu
  },
  {
    topic: "schedule_and_deadlines",
    pattern: /(?:^|[^\p{L}\p{N}_])(?:срок|дедлайн|этап|приёмк|релиз|расписан|ноябр|октябр|deadline|release|schedule|\d{4}-\d{2}-\d{2})/iu
  },
  {
    topic: "architecture_and_storage",
    pattern: /(?:^|[^\p{L}\p{N}_])(?:миграци|таблиц|папк|сейф|диск|архив|модул|сервер|sqlite|vault|drive|vps|workspace|pr\s*#?\d+)/iu
  }
];

export function classifyTopic(text: string): CompactionTopicKey {
  for (const item of TOPIC_KEYWORDS) {
    if (item.pattern.test(text)) {
      return item.topic;
    }
  }
  return "general_context";
}

export function isMandatoryConstraintSpan(text: string): boolean {
  return /(?:^|[^\p{L}\p{N}_])(?:строго|обязательно|нельзя|запрещено|не\s+меняй|не\s+изменяй|заморожен|потолок|лимит|must\s+not|never|strictly|required|frozen)(?=[^\p{L}\p{N}_]|$)/iu.test(
    text
  );
}

function splitIntoCandidateSentences(content: string): string[] {
  return content
    .normalize("NFKC")
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 1000);
}

function extractSubjectStemForChangeTracking(sentence: string): string | null {
  const norm = sentence.normalize("NFKC").toLowerCase();
  const subjects = [
    "лимит", "бюджет", "окно", "потолок", "дедлайн", "срок", "папка", "порт", "таймаут",
    "limit", "budget", "window", "deadline", "port", "timeout"
  ];
  for (const subj of subjects) {
    if (norm.includes(subj)) {
      return normalizeStem(subj);
    }
  }
  return null;
}

export interface CompactHistoryByTopicsOptions {
  enabled: boolean;
  messages: CompactionMessageInput[];
  keepRecentCount?: number;
  maxCapsuleBytes?: number;
  manualSummaryPresent?: boolean;
}

export function compactHistoryByTopicsAndChanges(
  options: CompactHistoryByTopicsOptions
): TopicCompactedHistoryResult {
  const messages = options.messages ?? [];
  const sourceBytes = Buffer.byteLength(
    messages.map((m) => m.content).join("\n"),
    "utf8"
  );

  const emptyFidelity: CompactionFidelityMetrics = {
    mandatoryConstraintTotal: 0,
    mandatoryConstraintRetained: 0,
    mandatoryConstraintRetentionRate: 1,
    numericAndDateEntityTotal: 0,
    numericAndDateEntityRetained: 0,
    numericAndDateEntityRetentionRate: 1,
    topicCoverageRate: 1,
    semanticLossScore: 0,
    compressionRatio: 1
  };

  if (!options.enabled) {
    return {
      capsules: [],
      recentTailMessages: messages,
      dispatchBlocked: false,
      report: {
        method: "verified-topic-compaction-v2",
        state: "disabled",
        reason: "off",
        original_messages: messages.length,
        compacted_messages: messages.length,
        source_bytes: sourceBytes,
        capsule_bytes: 0,
        protected_spans: 0,
        protected_kept: 0,
        omitted_spans: 0,
        sensitive_messages: 0,
        duplicate_spans: 0,
        topic_count: 0,
        change_events_count: 0,
        fidelity: emptyFidelity
      }
    };
  }

  if (options.manualSummaryPresent) {
    return {
      capsules: [],
      recentTailMessages: messages,
      dispatchBlocked: false,
      report: {
        method: "verified-topic-compaction-v2",
        state: "skipped",
        reason: "manual_summary",
        original_messages: messages.length,
        compacted_messages: messages.length,
        source_bytes: sourceBytes,
        capsule_bytes: 0,
        protected_spans: 0,
        protected_kept: 0,
        omitted_spans: 0,
        sensitive_messages: 0,
        duplicate_spans: 0,
        topic_count: 0,
        change_events_count: 0,
        fidelity: emptyFidelity
      }
    };
  }

  const keepRecentCount = Math.max(options.keepRecentCount ?? 2, 1);
  if (messages.length <= keepRecentCount + 1) {
    return {
      capsules: [],
      recentTailMessages: messages,
      dispatchBlocked: false,
      report: {
        method: "verified-topic-compaction-v2",
        state: "not_needed",
        reason: "short_history",
        original_messages: messages.length,
        compacted_messages: messages.length,
        source_bytes: sourceBytes,
        capsule_bytes: 0,
        protected_spans: 0,
        protected_kept: 0,
        omitted_spans: 0,
        sensitive_messages: 0,
        duplicate_spans: 0,
        topic_count: 0,
        change_events_count: 0,
        fidelity: emptyFidelity
      }
    };
  }

  const olderMessages = messages.slice(0, messages.length - keepRecentCount);
  const recentTailMessages = messages.slice(messages.length - keepRecentCount);
  const maxCapsuleBytes = Math.max(options.maxCapsuleBytes ?? 8000, 64);

  let sensitiveMessages = 0;
  let duplicateSpans = 0;
  const seenQuotes = new Set<string>();
  const allSpans: CompactedTopicSpan[] = [];

  for (const msg of olderMessages) {
    if (containsSensitiveSecret(msg.content)) {
      sensitiveMessages++;
      continue;
    }

    const sentences = splitIntoCandidateSentences(msg.content);
    for (const sentence of sentences) {
      const normQuote = sentence.toLowerCase().replace(/\s+/g, " ");
      if (seenQuotes.has(normQuote)) {
        duplicateSpans++;
        continue;
      }

      const entities = extractMemoryEntities(sentence);
      const isProtected = isMandatoryConstraintSpan(sentence);
      if (!isProtected && entities.length === 0 && msg.role === "assistant") {
        continue;
      }

      seenQuotes.add(normQuote);
      const topic = classifyTopic(sentence);
      const quoteSha256 = createHash("sha256").update(sentence, "utf8").digest("hex");

      allSpans.push({
        id: `${msg.id}:${quoteSha256.slice(0, 12)}`,
        topic,
        messageId: msg.id,
        role: msg.role,
        verbatimQuote: sentence,
        quoteSha256,
        createdAt: msg.created_at,
        isProtectedConstraint: isProtected,
        supersededByMessageId: null,
        entities
      });
    }
  }

  const changeEvents: TopicChangeEvent[] = [];
  const latestSpanByTopicSubject = new Map<string, CompactedTopicSpan>();

  for (const span of allSpans) {
    const subj = extractSubjectStemForChangeTracking(span.verbatimQuote);
    const preferredKind =
      span.topic === "schedule_and_deadlines" ? "date" : "money_or_number";
    const numOrDate =
      span.entities.find((e) => e.kind === preferredKind) ??
      span.entities.find((e) => e.kind === "money_or_number" || e.kind === "date");
    if (subj && numOrDate) {
      const key = `${span.topic}:${subj}`;
      const prev = latestSpanByTopicSubject.get(key);
      if (prev && prev.messageId !== span.messageId) {
        const prevVal =
          prev.entities.find((e) => e.kind === numOrDate.kind) ??
          prev.entities.find((e) => e.kind === "money_or_number" || e.kind === "date");
        if (prevVal && prevVal.normalized !== numOrDate.normalized) {
          prev.supersededByMessageId = span.messageId;
          changeEvents.push({
            topic: span.topic,
            subjectStem: subj,
            previousMessageId: prev.messageId,
            previousQuote: prev.verbatimQuote,
            previousValue: prevVal.raw,
            currentMessageId: span.messageId,
            currentQuote: span.verbatimQuote,
            currentValue: numOrDate.raw,
            changedAt: span.createdAt
          });
        }
      }
      latestSpanByTopicSubject.set(key, span);
    }
  }

  const prioritizedSpans = [...allSpans].sort((a, b) => {
    const aActive = a.supersededByMessageId === null ? 1 : 0;
    const bActive = b.supersededByMessageId === null ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (a.isProtectedConstraint !== b.isProtectedConstraint) {
      return a.isProtectedConstraint ? -1 : 1;
    }
    return b.entities.length - a.entities.length;
  });

  const activeProtectedSpans = allSpans.filter(
    (s) => s.isProtectedConstraint && s.supersededByMessageId === null
  );
  const selectedSpanIds = new Set<string>();
  let currentBytes = 2;
  let protectedKept = 0;

  for (const span of prioritizedSpans) {
    const cost = Buffer.byteLength(JSON.stringify(span), "utf8") + 2;
    if (currentBytes + cost > maxCapsuleBytes) {
      continue;
    }
    selectedSpanIds.add(span.id);
    currentBytes += cost;
    if (span.isProtectedConstraint && span.supersededByMessageId === null) {
      protectedKept++;
    }
  }

  const capsulesByTopic = new Map<CompactionTopicKey, TopicCompactionCapsule>();
  for (const span of allSpans) {
    if (!selectedSpanIds.has(span.id)) continue;
    let cap = capsulesByTopic.get(span.topic);
    if (!cap) {
      cap = {
        topic: span.topic,
        topicLabelRu: TOPIC_LABELS_RU[span.topic],
        activeSpans: [],
        supersededSpans: [],
        changeEvents: changeEvents.filter((ce) => ce.topic === span.topic),
        sourceMessageIds: []
      };
      capsulesByTopic.set(span.topic, cap);
    }
    if (span.supersededByMessageId) {
      cap.supersededSpans.push(span);
    } else {
      cap.activeSpans.push(span);
    }
    if (!cap.sourceMessageIds.includes(span.messageId)) {
      cap.sourceMessageIds.push(span.messageId);
    }
  }

  const capsules = Array.from(capsulesByTopic.values());
  const fidelity = measureCompactionFidelity(allSpans, selectedSpanIds, sourceBytes, currentBytes);
  const dispatchBlocked = fidelity.mandatoryConstraintRetentionRate < 1.0;

  return {
    capsules,
    recentTailMessages,
    dispatchBlocked,
    report: {
      method: "verified-topic-compaction-v2",
      state: dispatchBlocked ? "blocked" : "applied",
      reason: dispatchBlocked ? "protected_budget" : "ready",
      original_messages: messages.length,
      compacted_messages: recentTailMessages.length + capsules.length,
      source_bytes: sourceBytes,
      capsule_bytes: currentBytes,
      protected_spans: activeProtectedSpans.length,
      protected_kept: protectedKept,
      omitted_spans: allSpans.length - selectedSpanIds.size,
      sensitive_messages: sensitiveMessages,
      duplicate_spans: duplicateSpans,
      topic_count: capsules.length,
      change_events_count: changeEvents.length,
      fidelity
    }
  };
}

export function measureCompactionFidelity(
  allSpans: CompactedTopicSpan[],
  selectedSpanIds: Set<string>,
  sourceBytes: number,
  capsuleBytes: number
): CompactionFidelityMetrics {
  const activeSpans = allSpans.filter((s) => s.supersededByMessageId === null);
  const mandatorySpans = activeSpans.filter((s) => s.isProtectedConstraint);
  const mandatoryRetained = mandatorySpans.filter((s) => selectedSpanIds.has(s.id)).length;
  const mandatoryConstraintRetentionRate =
    mandatorySpans.length > 0 ? mandatoryRetained / mandatorySpans.length : 1;

  const allNumericDateEntities = new Set<string>();
  const retainedNumericDateEntities = new Set<string>();
  const allTopics = new Set<CompactionTopicKey>();
  const retainedTopics = new Set<CompactionTopicKey>();

  for (const span of activeSpans) {
    allTopics.add(span.topic);
    const isRetained = selectedSpanIds.has(span.id);
    if (isRetained) retainedTopics.add(span.topic);
    for (const ent of span.entities) {
      if (ent.kind === "money_or_number" || ent.kind === "date") {
        const key = `${ent.kind}:${ent.normalized}`;
        allNumericDateEntities.add(key);
        if (isRetained) retainedNumericDateEntities.add(key);
      }
    }
  }

  const numericAndDateEntityRetentionRate =
    allNumericDateEntities.size > 0
      ? retainedNumericDateEntities.size / allNumericDateEntities.size
      : 1;
  const topicCoverageRate =
    allTopics.size > 0 ? retainedTopics.size / allTopics.size : 1;

  const weightedRetention =
    mandatoryConstraintRetentionRate * 0.5 +
    numericAndDateEntityRetentionRate * 0.3 +
    topicCoverageRate * 0.2;
  const semanticLossScore = Number(Math.max(0, 1 - weightedRetention).toFixed(4));
  const compressionRatio =
    sourceBytes > 0 ? Number((capsuleBytes / sourceBytes).toFixed(4)) : 1;

  return {
    mandatoryConstraintTotal: mandatorySpans.length,
    mandatoryConstraintRetained: mandatoryRetained,
    mandatoryConstraintRetentionRate: Number(mandatoryConstraintRetentionRate.toFixed(4)),
    numericAndDateEntityTotal: allNumericDateEntities.size,
    numericAndDateEntityRetained: retainedNumericDateEntities.size,
    numericAndDateEntityRetentionRate: Number(numericAndDateEntityRetentionRate.toFixed(4)),
    topicCoverageRate: Number(topicCoverageRate.toFixed(4)),
    semanticLossScore,
    compressionRatio
  };
}

export interface RestoredTopicDetail {
  topic: CompactionTopicKey;
  messageId: string;
  role: "user" | "assistant";
  fullContent: string;
  createdAt: string;
  verifiedQuoteHashes: string[];
}

export function restoreCompactedTopicDetails(
  sqlite: DatabaseSync,
  ownerId: string,
  chatId: string,
  capsule: TopicCompactionCapsule
): RestoredTopicDetail[] {
  const restored: RestoredTopicDetail[] = [];
  for (const msgId of capsule.sourceMessageIds) {
    const row = sqlite
      .prepare(
        `SELECT id, role, content, created_at
         FROM general_chat_messages
         WHERE id = ? AND chat_id = ? AND owner_id = ?`
      )
      .get(msgId, chatId, ownerId) as
      | { id: string; role: "user" | "assistant"; content: string; created_at: string }
      | undefined;
    if (!row) continue;

    const matchingSpans = [...capsule.activeSpans, ...capsule.supersededSpans].filter(
      (s) => s.messageId === msgId
    );
    const verifiedQuoteHashes: string[] = [];
    for (const span of matchingSpans) {
      if (row.content.normalize("NFKC").includes(span.verbatimQuote)) {
        const actualHash = createHash("sha256").update(span.verbatimQuote, "utf8").digest("hex");
        if (actualHash === span.quoteSha256) {
          verifiedQuoteHashes.push(actualHash);
        }
      }
    }

    restored.push({
      topic: capsule.topic,
      messageId: row.id,
      role: row.role,
      fullContent: row.content,
      createdAt: row.created_at,
      verifiedQuoteHashes
    });
  }
  return restored;
}
