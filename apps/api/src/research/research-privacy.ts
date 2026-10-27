import { researchMarkdown, type ResearchRun } from "@cosmora/core";
import type { ResearchStore } from "./research-store.js";
import type { ResearchCoordinator } from "./research-coordinator.js";

/** Register under shared owner privacy coordinator; does not delete accounting, audit or provider secrets. */
export class ResearchPrivacyAdapter {
  readonly id = "research";
  constructor(
    private readonly store: ResearchStore,
    private readonly coordinator: ResearchCoordinator
  ) {}
  async quiesce(ownerId: string): Promise<void> {
    await this.coordinator.quiesce(ownerId);
  }
  /** Snapshot: owner only, with authentic citations; no off-site fetch during export. */
  export(ownerId: string): {
    adapter: string;
    complete: boolean;
    items: Array<{
      id: string;
      project_id: string;
      status: string;
      report_markdown: string;
      state: ResearchRun;
    }>;
  } {
    if (!this.store.isFenced(ownerId)) throw Error("RESEARCH_QUIESCE_REQUIRED");
    return {
      adapter: this.id,
      complete: true,
      items: this.store.list(ownerId).map((run) => ({
        id: run.id,
        project_id: run.project_id,
        status: run.status,
        report_markdown: researchMarkdown(run),
        state: run
      }))
    };
  }
  delete(ownerId: string): { adapter: string; deleted: number; retained: string[] } {
    return {
      adapter: this.id,
      deleted: this.store.deleteOwner(ownerId),
      retained: ["model_usage_ledger", "provider_accounting", "system_audit"]
    };
  }
  /** Only for completed export without deletion; do not unquiesce during a destructive operation. */
  release(ownerId: string): void {
    this.store.unfence(ownerId);
  }
}
