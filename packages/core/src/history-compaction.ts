import { createHash } from "node:crypto";
import {
  memoryContainsCredential,
  type CompactedHistory,
  type ContextMemoryBundle,
  type ContextMemoryEvidence,
  type GeneralChatMessage,
  type HistoryCompactionOptions,
  type HistoryCompactionReport
} from "@cosmora/contracts";

const utf8 = (s: string) => new TextEncoder().encode(s).length;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const protectedText = (text: string) =>
  /\p{N}/u.test(text) ||
  /(?:^|[^\p{L}])(?:не|нельзя|только|кроме|если|иначе|важно|обязательно|запомни|сохрани|предпочитаю|решили|утвердили|осталось|цель|план|задача|имя)(?!\p{L})|запрещ|долж[еён]|ограничени|услови|решени|бюджет|срок|следующ|предпочтени|меня зовут|\b(?:must|never|only|except|unless|if|requirement|constraint|budget|deadline|decided|pending|remember|goal|next|name)\b/iu.test(
    text
  );

type Unit = {
  message: GeneralChatMessage;
  sequence: number;
  start: number;
  end: number;
  text: string;
  priority: boolean;
};
function spans(message: GeneralChatMessage, sequence: number): Unit[] {
  const result: Unit[] = [];
  let cursor = 0;
  const add = (end: number) => {
    const raw = message.content.slice(cursor, end);
    const start = cursor + (raw.length - raw.trimStart().length);
    const stop = end - (raw.length - raw.trimEnd().length);
    cursor = end;
    if (stop > start)
      result.push({
        message,
        sequence,
        start,
        end: stop,
        text: message.content.slice(start, stop),
        priority: false
      });
  };
  // A decimal, version, date or URL dot without following whitespace is NOT a boundary.
  for (const match of message.content.matchAll(/[.!?;。！？](?=\s|$)|\r?\n/g)) {
    add(match.index + match[0].length);
    if (result.length > 4000) break;
  }
  if (cursor < message.content.length && result.length <= 4000) add(message.content.length);
  const direct = result.map((u) => message.role === "user" && protectedText(u.text));
  for (let i = 0; i < result.length; i++)
    result[i]!.priority = Boolean(direct[i] || direct[i - 1] || direct[i + 1]);
  return result;
}
function split(messages: GeneralChatMessage[]) {
  const groups: GeneralChatMessage[][] = [];
  for (const m of messages) {
    if (!m.content.trim()) continue; // The ordinary model window already excludes empty turns.
    if (m.role === "user" || !groups.length) groups.push([]);
    groups.at(-1)!.push(m);
  }
  return { prefix: groups.slice(0, -4).flat(), recent: groups.slice(-4).flat() };
}
function analyze(messages: GeneralChatMessage[]) {
  const unique = new Map<string, Unit>();
  let sensitive = 0,
    duplicates = 0;
  const firstOwner = messages.find(
    (m) => m.role === "user" && !memoryContainsCredential(m.content)
  )?.id;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (memoryContainsCredential(message.content)) {
      sensitive++;
      continue;
    }
    const messageUnits = spans(message, i);
    if (messageUnits.length > 4000) return { units: [], sensitive, duplicates, limited: true };
    if (message.id === firstOwner) for (const u of messageUnits.slice(0, 2)) u.priority = true;
    for (const unit of messageUnits) {
      const key = message.role + "\0" + unit.text;
      const prior = unique.get(key);
      if (prior) {
        duplicates++;
        unit.priority ||= prior.priority;
      }
      unique.set(key, unit); // Latest exact occurrence; never merge user and assistant claims.
      if (unique.size > 4000) return { units: [], sensitive, duplicates, limited: true };
    }
  }
  return { units: [...unique.values()], sensitive, duplicates, limited: false };
}
function evidence(unit: Unit, hashes: Map<string, string>): ContextMemoryEvidence {
  const m = unit.message;
  if (!hashes.has(m.id)) hashes.set(m.id, hash(m.content));
  return {
    reference: "H:g:" + m.id,
    kind: "history",
    title: m.created_at,
    text: unit.text,
    sequence: unit.sequence,
    priority: unit.priority,
    excerpt_only: unit.start > 0 || unit.end < m.content.length,
    source: {
      kind: "chat_message",
      message_id: m.id,
      chat_id: m.chat_id,
      project_id: null,
      role: m.role,
      quote: "",
      sha256: hashes.get(m.id)!
    }
  };
}
const measured = (bundle: ContextMemoryBundle) => {
  for (let i = 0; i < 4; i++) bundle.bytes = utf8(JSON.stringify(bundle));
  return bundle;
};

/** Independent evidence/coverage check; does not interpret whether a sentence is factually true. */
export function verifyHistoryCompaction(
  original: GeneralChatMessage[],
  memory: ContextMemoryBundle
): boolean {
  if (original.length > 2000 || original.reduce((n, m) => n + m.content.length, 0) > 2_000_000)
    return false;
  const keys = (value: object, allowed: string[]) =>
    Object.keys(value).every((k) => allowed.includes(k));
  if (
    !keys(memory, [
      "format",
      "target",
      "items",
      "omitted",
      "priority_omitted",
      "bytes",
      "budget_bytes",
      "retrieval"
    ]) ||
    !keys(memory.target, ["kind", "id"]) ||
    memory.format !== "kosmora.context-memory.v1" ||
    memory.retrieval !== "lexical" ||
    memory.budget_bytes !== 8000
  )
    return false;
  const { prefix } = split(original);
  if (
    prefix.some(
      (m) => m.attachments?.length || m.status !== "completed" || /['\x60]{3}|~{3}/.test(m.content)
    )
  )
    return false;
  const { units, limited } = analyze(prefix);
  if (limited) return false;
  const sources = new Map(prefix.map((m) => [m.id, m]));
  const expected = new Map(units.map((u) => [u.message.role + "\0" + u.text, u]));
  const seen = new Set<string>(),
    hashes = new Map<string, string>();
  for (const e of memory.items) {
    const source = e.source,
      message = source ? sources.get(source.message_id) : undefined;
    if (
      !keys(e, [
        "reference",
        "kind",
        "title",
        "text",
        "sequence",
        "priority",
        "excerpt_only",
        "source"
      ]) ||
      !source ||
      !keys(source, ["kind", "message_id", "chat_id", "project_id", "role", "quote", "sha256"]) ||
      source.quote !== "" ||
      !message ||
      source.kind !== "chat_message" ||
      source.role !== message.role ||
      source.chat_id !== message.chat_id ||
      source.project_id !== null ||
      memoryContainsCredential(message.content) ||
      e.reference !== "H:g:" + message.id ||
      e.kind !== "history" ||
      e.title !== message.created_at
    )
      return false;
    if (!hashes.has(message.id)) hashes.set(message.id, hash(message.content));
    const key = message.role + "\0" + e.text,
      unit = expected.get(key);
    if (
      !unit ||
      source.sha256 !== hashes.get(message.id) ||
      unit.message.id !== message.id ||
      e.priority !== unit.priority ||
      e.excerpt_only !== (unit.start > 0 || unit.end < message.content.length) ||
      e.sequence !== unit.sequence ||
      seen.has(key)
    )
      return false;
    seen.add(key);
  }
  const missing = units.filter(
    (u) => u.priority && !seen.has(u.message.role + "\0" + u.text)
  ).length;
  return (
    memory.priority_omitted === missing &&
    memory.target.kind === "chat" &&
    memory.target.id === original.at(-1)?.chat_id &&
    memory.bytes === utf8(JSON.stringify(memory)) &&
    memory.bytes <= memory.budget_bytes &&
    memory.items.length <= 64 &&
    memory.omitted === units.length - memory.items.length
  );
}

/** Local exact-quote compaction, deliberately not an LLM semantic summary or a losslessness claim. */
export function compactChatHistory(
  messages: GeneralChatMessage[],
  options: HistoryCompactionOptions
): CompactedHistory {
  const report: HistoryCompactionReport = {
    method: "verified-extractive-v1",
    state: "disabled",
    reason: "off",
    original_messages: messages.length,
    compacted_messages: 0,
    source_bytes: null,
    capsule_bytes: 0,
    protected_spans: 0,
    protected_kept: 0,
    omitted_spans: 0,
    sensitive_messages: 0,
    duplicate_spans: 0
  };
  const unchanged = (
    state: HistoryCompactionReport["state"],
    reason: HistoryCompactionReport["reason"]
  ) => {
    report.state = state;
    report.reason = reason;
    return { messages, report };
  };
  if (!options.enabled) return unchanged("disabled", "off");
  if (options.manual_summary) return unchanged("skipped", "manual_summary");
  if (messages.length > 2000 || messages.reduce((n, m) => n + m.content.length, 0) > 2_000_000)
    return unchanged("skipped", "input_limit");
  if (
    new Set(messages.map((m) => m.id)).size !== messages.length ||
    messages.some((m) => m.chat_id !== messages.at(-1)?.chat_id)
  )
    return unchanged("skipped", "unsupported_material");
  const { prefix, recent } = split(messages);
  report.source_bytes = prefix.reduce((n, m) => n + utf8(m.content), 0);
  if (!prefix.length || report.source_bytes < 6000) return unchanged("not_needed", "short_history");
  if (
    prefix.some(
      (m) => m.attachments?.length || m.status !== "completed" || /['\x60]{3}|~{3}/.test(m.content)
    )
  )
    return unchanged("skipped", "unsupported_material");
  const { units, sensitive, duplicates, limited } = analyze(prefix);
  if (limited) return unchanged("skipped", "input_limit");
  report.sensitive_messages = sensitive;
  report.duplicate_spans = duplicates;
  report.protected_spans = units.filter((u) => u.priority).length;
  const terms = [
    ...new Set(
      options.query
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]{3,}/gu) ?? []
    )
  ].slice(0, 16);
  const ranked = units
    .map((u) => ({
      u,
      score:
        terms.filter((t) => u.text.normalize("NFKC").toLocaleLowerCase().includes(t)).length * 100 +
        u.sequence
    }))
    .sort((a, b) => Number(b.u.priority) - Number(a.u.priority) || b.score - a.score);
  const memory: ContextMemoryBundle = {
    format: "kosmora.context-memory.v1",
    target: { kind: "chat", id: messages.at(-1)!.chat_id },
    items: [],
    omitted: units.length,
    priority_omitted: report.protected_spans,
    bytes: 0,
    budget_bytes: 8000,
    retrieval: "lexical"
  };
  const hashes = new Map<string, string>();
  for (const { u } of ranked) {
    const next = measured({
      ...memory,
      items: [...memory.items, evidence(u, hashes)],
      omitted: memory.omitted - 1,
      priority_omitted: memory.priority_omitted - Number(u.priority)
    });
    if (next.bytes > memory.budget_bytes - 64 || memory.items.length >= 64) continue;
    Object.assign(memory, next);
  }
  memory.items.sort(
    (a, b) =>
      (a.sequence ?? 0) - (b.sequence ?? 0) ||
      prefix[a.sequence ?? 0]!.content.indexOf(a.text) -
        prefix[b.sequence ?? 0]!.content.indexOf(b.text)
  );
  measured(memory);
  if (!verifyHistoryCompaction(messages, memory)) throw new Error("COMPACTION_EVIDENCE_INVALID");
  report.protected_kept = report.protected_spans - memory.priority_omitted;
  report.omitted_spans = memory.omitted;
  report.capsule_bytes = memory.bytes;
  if (memory.priority_omitted)
    return {
      messages,
      memory,
      report: { ...report, state: "blocked", reason: "protected_budget" }
    };
  // Include framing overhead; never replace a short history with a larger packet.
  if (memory.bytes + 1600 >= report.source_bytes) return unchanged("not_needed", "no_saving");
  report.state = "applied";
  report.reason = "ready";
  report.compacted_messages = prefix.length;
  return { messages: recent, memory, report };
}
