// Node 24+; build @cosmora/core first. No models, network, database or user data.
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { fitContextMemory } from "../packages/core/dist/context-memory.js";
import { conversationWindow } from "../packages/core/dist/conversation-window.js";
import {
  legacyFitContextMemory,
  legacyConversationWindow
} from "../packages/core/test/fixtures/context-packing-reference.ts";

const sizesArgument = process.argv.find((value) => value.startsWith("--sizes="));
const sizes = (sizesArgument?.slice(8) ?? "100,500,1500").split(",").map(Number);
if (!sizes.length || sizes.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 5000))
  throw new Error("Use --sizes=integers from 1 through 5000");
const output = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function compare(kind, size, legacy, optimized) {
  const oldTimes = [],
    newTimes = [];
  for (let round = 0; round < 3; round++) {
    let start = performance.now();
    const expected = legacy();
    oldTimes.push(performance.now() - start);
    start = performance.now();
    const actual = optimized();
    newTimes.push(performance.now() - start);
    assert.deepEqual(actual, expected, kind + " changed behavior");
  }
  const before = median(oldTimes),
    after = median(newTimes);
  return {
    kind,
    size,
    equivalent: true,
    samples: 3,
    legacy_ms: Number(before.toFixed(3)),
    optimized_ms: Number(after.toFixed(3)),
    ratio: Number((before / after).toFixed(2))
  };
}
const rows = [];
for (const size of sizes) {
  const bundle = {
    format: "kosmora.context-memory.v1",
    target: { kind: "chat", id: "synthetic" },
    bytes: 0,
    budget_bytes: 1000000,
    omitted: 99,
    priority_omitted: 0,
    retrieval: "lexical",
    items: Array.from({ length: size }, (_, i) => ({
      reference: `M:${i}`,
      kind: "memory",
      title: `Source ${i}`,
      text: 'Synthetic память 😀 "quoted" \\ '.repeat(3),
      memory_kind: i % 23 === 0 ? "constraint" : "fact",
      priority: i % 17 === 0,
      source: null,
      excerpt_only: false
    }))
  };
  rows.push(
    compare(
      "memory",
      size,
      () => legacyFitContextMemory(bundle, 1000000),
      () => fitContextMemory(bundle, 1000000)
    )
  );
  const conversation = Array.from({ length: size * 20 }, (_, i) => ({
    role: "user",
    content: `Synthetic turn ${i}`
  }));
  const prefix = [{ role: "system", content: "Synthetic instructions" }];
  rows.push(
    compare(
      "conversation",
      conversation.length,
      () => legacyConversationWindow(prefix, conversation, 10000000),
      () => conversationWindow(prefix, conversation, 10000000)
    )
  );
}
const report = {
  at: new Date().toISOString(),
  node: process.version,
  synthetic: true,
  scope: "packing only; not model latency or end-to-end chat",
  rows
};
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
