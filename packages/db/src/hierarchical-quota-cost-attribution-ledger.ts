import { DatabaseSync } from "node:sqlite";

export interface CostAttributionChargeInput {
  entryId: string;
  orgId: string;
  teamId: string;
  projectId: string;
  workflowId: string;
  promptTokens: number;
  completionTokens: number;
  costMicrosUsd: number;
}

export interface HierarchicalRollupSummary {
  orgTotalMicrosUsd: number;
  byTeamMicrosUsd: Record<string, number>;
  byProjectMicrosUsd: Record<string, number>;
  budgetExceeded: boolean;
}

/**
 * Multi-Tenant Hierarchical FinOps Cost & Token Attribution Ledger backed by SQLite.
 * Aggregates token and micro-USD expenditure across (org -> team -> project -> workflow)
 * and enforces hard budget circuit-breakers.
 */
export class HierarchicalCostAttributionLedger {
  private readonly db: DatabaseSync;
  private readonly orgBudgetLimitMicrosUsd: number;

  public constructor(db: DatabaseSync, orgBudgetLimitMicrosUsd: number = 10_000_000) {
    this.db = db;
    this.orgBudgetLimitMicrosUsd = orgBudgetLimitMicrosUsd;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_cost_attribution_entries (
        entry_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost_micros_usd INTEGER NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
  }

  public recordCharge(input: CostAttributionChargeInput): {
    accepted: boolean;
    cumulativeOrgCostMicrosUsd: number;
  } {
    const current = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_micros_usd), 0) AS total
         FROM kosmora_cost_attribution_entries
         WHERE org_id = ?`
      )
      .get(input.orgId) as { total: number };

    if (current.total + input.costMicrosUsd > this.orgBudgetLimitMicrosUsd) {
      return {
        accepted: false,
        cumulativeOrgCostMicrosUsd: current.total
      };
    }

    this.db
      .prepare(
        `INSERT INTO kosmora_cost_attribution_entries
         (entry_id, org_id, team_id, project_id, workflow_id, prompt_tokens, completion_tokens, cost_micros_usd, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.entryId,
        input.orgId,
        input.teamId,
        input.projectId,
        input.workflowId,
        input.promptTokens,
        input.completionTokens,
        input.costMicrosUsd,
        new Date().toISOString()
      );

    return {
      accepted: true,
      cumulativeOrgCostMicrosUsd: current.total + input.costMicrosUsd
    };
  }

  public computeOrgRollup(orgId: string): HierarchicalRollupSummary {
    const teamRows = this.db
      .prepare(
        `SELECT team_id, SUM(cost_micros_usd) AS total
         FROM kosmora_cost_attribution_entries
         WHERE org_id = ?
         GROUP BY team_id`
      )
      .all(orgId) as Array<{ team_id: string; total: number }>;

    const projectRows = this.db
      .prepare(
        `SELECT project_id, SUM(cost_micros_usd) AS total
         FROM kosmora_cost_attribution_entries
         WHERE org_id = ?
         GROUP BY project_id`
      )
      .all(orgId) as Array<{ project_id: string; total: number }>;

    const byTeamMicrosUsd: Record<string, number> = {};
    let orgTotal = 0;
    for (const r of teamRows) {
      byTeamMicrosUsd[r.team_id] = r.total;
      orgTotal += r.total;
    }

    const byProjectMicrosUsd: Record<string, number> = {};
    for (const r of projectRows) {
      byProjectMicrosUsd[r.project_id] = r.total;
    }

    return {
      orgTotalMicrosUsd: orgTotal,
      byTeamMicrosUsd,
      byProjectMicrosUsd,
      budgetExceeded: orgTotal >= this.orgBudgetLimitMicrosUsd
    };
  }
}
