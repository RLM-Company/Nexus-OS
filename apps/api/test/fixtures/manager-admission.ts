import { readFileSync } from "node:fs";
import type { WorkIntelligenceGraphAdapter } from "@cosmora/contracts";

export const admissionBrief = JSON.parse(
  readFileSync(new URL("./manager-admission.json", import.meta.url), "utf8")
) as { goal: string; content: string };

// This graph fixture holds real context reads before the provider dispatch.
export function admissionProbe(onFirstRead: (signal: AbortSignal) => void) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0,
    active = 0,
    peak = 0;
  const graph: WorkIntelligenceGraphAdapter = {
    contract_version: "kosmora-work-v1",
    async read(input) {
      active++;
      peak = Math.max(peak, active);
      reads++;
      try {
        if (reads === 1) onFirstRead(input.signal);
        await gate;
        return { project_id: input.project_id, entries: [] };
      } finally {
        active--;
      }
    }
  };
  return { graph, release, stats: () => ({ reads, active, peak }) };
}
