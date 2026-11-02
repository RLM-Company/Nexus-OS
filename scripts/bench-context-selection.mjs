// Deterministic synthetic evidence, no models, network, database or user data.
// Build @cosmora/core first, or run pnpm bench:context-selection.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { fitContextMemory } from "../packages/core/dist/context-memory.js";
import { legacyFitContextMemory } from "../packages/core/test/fixtures/context-packing-reference.ts";

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const bundle = (items) => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "chat", id: "synthetic" },
  items,
  omitted: 0,
  priority_omitted: 0,
  bytes: 0,
  budget_bytes: 1_000_000,
  retrieval: "lexical"
});
const cases = [];
const repeated = [];
for (let index = 0; index < 12; index++) {
  const sentences = Array.from(
    { length: 8 },
    (_, n) => `Договор ${index}: этап ${n}, сумма ${100 + n}. `
  );
  const text = sentences.join("");
  const source = {
    kind: "chat_message",
    message_id: `message-${index}`,
    chat_id: "synthetic",
    project_id: null,
    role: "user",
    quote: text,
    sha256: createHash("sha256").update(text).digest("hex")
  };
  const full = {
    reference: `H:g:${source.message_id}`,
    kind: "history",
    title: "Synthetic source",
    text,
    source,
    excerpt_only: false,
    priority: index === 0
  };
  repeated.push(
    full,
    ...sentences.map((part) => ({
      ...full,
      text: part,
      source: { ...source, quote: part },
      excerpt_only: true
    }))
  );
}

const baseline = legacyFitContextMemory(bundle(repeated), 1_000_000);
const packed = fitContextMemory(bundle(repeated), 1_000_000);
assert.ok(baseline && packed);
for (const original of repeated) {
  const covering = packed.items.find(
    (item) =>
      item.reference === original.reference &&
      item.source.role === original.source.role &&
      item.source.sha256 === original.source.sha256 &&
      item.text.includes(original.text)
  );
  assert.ok(covering, "Lost literal evidence or provenance");
  if (original.priority) assert.ok(covering.priority, "Lost required evidence");
}
assert.equal(packed.omitted, 0);
assert.equal(bytes(packed), packed.bytes);
assert.deepEqual(
  new Set(packed.items.map((e) => e.reference)),
  new Set(repeated.map((e) => e.reference))
);
cases.push({
  name: "deliberately_repeated_quotes_and_overlapping_spans",
  synthetic: true,
  before_items: baseline.items.length,
  after_items: packed.items.length,
  before_bytes: bytes(baseline),
  after_bytes: bytes(packed),
  input_byte_reduction_percent: Number(((1 - bytes(packed) / bytes(baseline)) * 100).toFixed(2)),
  literal_evidence_coverage_percent: 100,
  independent_references_preserved: true
});

const optional = [
  {
    ...repeated[0],
    reference: "H:g:unrelated",
    text: "Посторонний вопрос " + "x".repeat(500),
    source: null,
    priority: false
  },
  {
    ...repeated[0],
    reference: "H:g:relevant",
    text: "Договор 20 " + "x".repeat(500),
    source: null,
    priority: false
  }
];
const limit = fitContextMemory({ ...bundle([optional[1]]), omitted: 1 }, 12000).bytes;
const selected = fitContextMemory(bundle(optional), limit, "Договор 20");
assert.deepEqual(
  selected.items.map((e) => e.reference),
  ["H:g:relevant"]
);
assert.ok(selected.bytes <= limit);
cases.push({
  name: "relevant_source_under_tight_budget",
  byte_budget: limit,
  selected_references: selected.items.map((e) => e.reference),
  omitted: selected.omitted,
  passed: true
});

const report = {
  synthetic: true,
  scope:
    "Exact JSON UTF-8 bytes and literal evidence coverage. Not actual provider tokens, semantic recall or end-to-end latency.",
  model_calls: 0,
  external_requests: 0,
  cases
};
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
