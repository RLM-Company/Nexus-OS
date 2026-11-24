/** Повторяемый прогон качества сформированного контекста.
 *
 * Запуск:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
 *     --import ./scripts/context-quality/ts-resolve-hook.mjs \
 *     scripts/context-quality/run.mjs [baseline|optimized]
 *
 * Зона: сформированный контекст для модели. Никаких вызовов модели, сети и БД.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { compactContextEvidence } from "../../packages/core/src/context-evidence-selection.ts";
import { fitContextMemory } from "../../packages/core/src/context-memory.ts";

const fixturePath = fileURLToPath(new URL("./fixtures/context-set.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const mode = process.argv[2] ?? "baseline";
assert.ok(["baseline", "optimized"].includes(mode), "mode must be baseline|optimized");

const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

function bundleOf(scenario, items, bytes) {
  return {
    format: "kosmora.context-memory.v1",
    target: { kind: "chat", id: "chat-self" },
    items,
    omitted: 0,
    priority_omitted: 0,
    bytes: 0,
    budget_bytes: scenario.budget_bytes,
    retrieval: "lexical",
    answer_evidence: "absent",
    matched_items: 0,
    ...(bytes ? { bytes } : {})
  };
}

/** Current production path: raw fixtures are already scoped by the caller,
 * ranking is lexical and version is not used; deleted sources are passed in. */
function selectBaseline(scenario) {
  const items = scenario.items.map(({ owner, deleted, ...item }) => item);
  const compacted = compactContextEvidence(items);
  const ranked = compacted; // rankContextEvidence is applied inside fitContextMemory
  const bundle = bundleOf(scenario, ranked);
  const selected = fitContextMemory(bundle, scenario.budget_bytes, scenario.query);
  return selected?.items ?? [];
}

/** Optimized path: owner-scoped, newest-revision-first, deleted material dropped
 * before packing. Implemented in core/select-context-scope after the fix. */
function selectOptimized(scenario) {
  const { selectContextScope } = optimizedModule;
  return selectContextScope(scenario);
}

let optimizedModule = { selectContextScope: selectBaseline };
if (mode === "optimized") {
  optimizedModule = await import("./select-context-scope.mjs");
}

const results = [];
for (const scenario of fixture.scenarios) {
  const select = mode === "optimized" ? selectOptimized : selectBaseline;
  const started = performance.now();
  const items = select(scenario);
  const elapsedMs = performance.now() - started;
  const text = items.map((item) => item.text).join("\n");
  const refs = items.map((item) => item.reference);
  const required = scenario.required_facts ?? [];
  const forbidden = scenario.forbidden_facts ?? [];
  const expected = scenario.expected_references ?? [];
  const prohibited = scenario.forbidden_references ?? [];
  const foundRequired = required.filter((fact) => text.includes(fact));
  const leakedFacts = forbidden.filter((fact) => text.includes(fact));
  const foundRefs = expected.filter((ref) => refs.includes(ref));
  const leakedRefs = prohibited.filter((ref) => refs.includes(ref));
  const bytes = byteLength({ items, omitted: 0 });
  results.push({
    id: scenario.id,
    bytes,
    elapsed_ms: Number(elapsedMs.toFixed(3)),
    required_total: required.length,
    required_found: foundRequired.length,
    recall: required.length ? foundRequired.length / required.length : 1,
    expected_refs: expected.length,
    found_refs: foundRefs.length,
    ref_precision: refs.length ? foundRefs.length / refs.length : 1,
    forbidden_refs_leaked: leakedRefs.length,
    forbidden_facts_leaked: leakedFacts.length,
    items: refs
  });
}

const total = results.reduce(
  (acc, r) => {
    acc.bytes += r.bytes;
    acc.elapsed_ms += r.elapsed_ms;
    acc.required_total += r.required_total;
    acc.required_found += r.required_found;
    acc.expected_refs += r.expected_refs;
    acc.found_refs += r.found_refs;
    acc.forbidden_refs_leaked += r.forbidden_refs_leaked;
    acc.forbidden_facts_leaked += r.forbidden_facts_leaked;
    return acc;
  },
  {
    bytes: 0,
    elapsed_ms: 0,
    required_total: 0,
    required_found: 0,
    expected_refs: 0,
    found_refs: 0,
    forbidden_refs_leaked: 0,
    forbidden_facts_leaked: 0
  }
);
const summary = {
  mode,
  scenarios: results.length,
  total_bytes: total.bytes,
  total_elapsed_ms: Number(total.elapsed_ms.toFixed(3)),
  required_fact_recall: Number((total.required_found / total.required_total).toFixed(4)),
  reference_precision: Number(
    (total.found_refs / results.reduce((n, r) => n + r.items.length, 0)).toFixed(4)
  ),
  foreign_references_leaked: total.forbidden_refs_leaked,
  forbidden_facts_leaked: total.forbidden_facts_leaked,
  per_scenario: results
};
console.log(JSON.stringify(summary, null, 2));
