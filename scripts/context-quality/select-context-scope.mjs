/** Thin adapter for the benchmark: core scoping function with fixture-shaped
 * inputs. No business logic lives here. */
import { selectContextScope as coreSelect } from "../../packages/core/src/context-evidence-selection.ts";
import { fitContextMemory } from "../../packages/core/src/context-memory.ts";

export function selectContextScope(scenario) {
  const items = scenario.items.map((item) => ({ ...item }));
  const selected = coreSelect(items, {
    owner: "owner-A",
    query: scenario.query,
    isDeleted: (item) => item.deleted === true
  });
  const bundle = {
    format: "kosmora.context-memory.v1",
    target: { kind: "chat", id: "chat-self" },
    items: selected,
    omitted: 0,
    priority_omitted: 0,
    bytes: 0,
    budget_bytes: scenario.budget_bytes,
    retrieval: "lexical",
    answer_evidence: "absent",
    matched_items: 0
  };
  const fitted = fitContextMemory(bundle, scenario.budget_bytes, scenario.query);
  return fitted?.items ?? [];
}
