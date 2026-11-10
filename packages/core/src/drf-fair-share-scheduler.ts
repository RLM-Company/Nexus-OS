export interface ResourceVector {
  cpuMs: number;
  ramMb: number;
  tokens: number;
}

export interface TenantAllocationState {
  tenantId: string;
  weight: number;
  allocated: ResourceVector;
  dominantShare: number;
  dominantResource: keyof ResourceVector;
}

/**
 * Dominant Resource Fairness (DRF) Multi-Resource Fair-Share Scheduler.
 * Guarantees Pareto efficiency, sharing incentive, envy-freeness, and strategy-proofness
 * across heterogeneous CPU, RAM, and Token demands.
 */
export class DominantResourceFairnessScheduler {
  private readonly capacity: ResourceVector;
  private readonly used: ResourceVector = { cpuMs: 0, ramMb: 0, tokens: 0 };
  private readonly tenants = new Map<string, { weight: number; allocated: ResourceVector }>();

  constructor(totalCapacity: ResourceVector) {
    this.capacity = { ...totalCapacity };
  }

  public registerTenant(tenantId: string, weight = 1.0): void {
    if (!this.tenants.has(tenantId)) {
      this.tenants.set(tenantId, {
        weight: Math.max(0.1, weight),
        allocated: { cpuMs: 0, ramMb: 0, tokens: 0 }
      });
    }
  }

  public computeTenantState(tenantId: string): TenantAllocationState {
    const t = this.tenants.get(tenantId);
    if (!t) {
      throw new Error(`UNKNOWN_DRF_TENANT: ${tenantId}`);
    }

    const cpuShare = (t.allocated.cpuMs / Math.max(1, this.capacity.cpuMs)) / t.weight;
    const ramShare = (t.allocated.ramMb / Math.max(1, this.capacity.ramMb)) / t.weight;
    const tokShare = (t.allocated.tokens / Math.max(1, this.capacity.tokens)) / t.weight;

    let dominantResource: keyof ResourceVector = "cpuMs";
    let dominantShare = cpuShare;

    if (ramShare > dominantShare) {
      dominantShare = ramShare;
      dominantResource = "ramMb";
    }
    if (tokShare > dominantShare) {
      dominantShare = tokShare;
      dominantResource = "tokens";
    }

    return {
      tenantId,
      weight: t.weight,
      allocated: { ...t.allocated },
      dominantShare: Number(dominantShare.toFixed(6)),
      dominantResource
    };
  }

  /**
   * Selects the tenant with the lowest weighted dominant share whose pending demand
   * fits within remaining cluster capacity, and allocates the resources.
   */
  public scheduleNextTask(
    pendingDemands: Array<{ tenantId: string; taskId: string; demand: ResourceVector }>
  ): { scheduledTenantId: string; scheduledTaskId: string; updatedState: TenantAllocationState } | null {
    for (const pd of pendingDemands) {
      this.registerTenant(pd.tenantId);
    }

    // Filter tasks that fit within remaining capacity
    const feasible = pendingDemands.filter(
      (pd) =>
        this.used.cpuMs + pd.demand.cpuMs <= this.capacity.cpuMs &&
        this.used.ramMb + pd.demand.ramMb <= this.capacity.ramMb &&
        this.used.tokens + pd.demand.tokens <= this.capacity.tokens
    );

    if (feasible.length === 0) return null;

    // Pick tenant with minimum current dominant share
    feasible.sort((a, b) => {
      const shareA = this.computeTenantState(a.tenantId).dominantShare;
      const shareB = this.computeTenantState(b.tenantId).dominantShare;
      return shareA - shareB;
    });

    const chosen = feasible[0]!;
    const rec = this.tenants.get(chosen.tenantId)!;
    rec.allocated.cpuMs += chosen.demand.cpuMs;
    rec.allocated.ramMb += chosen.demand.ramMb;
    rec.allocated.tokens += chosen.demand.tokens;

    this.used.cpuMs += chosen.demand.cpuMs;
    this.used.ramMb += chosen.demand.ramMb;
    this.used.tokens += chosen.demand.tokens;

    return {
      scheduledTenantId: chosen.tenantId,
      scheduledTaskId: chosen.taskId,
      updatedState: this.computeTenantState(chosen.tenantId)
    };
  }
}
