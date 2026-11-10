export interface HtbClassConfig {
  classId: string;
  assuredRateTokensPerSec: number; // CIR
  ceilRateTokensPerSec: number; // PIR
  burstCapacity: number;
  priority: number; // Lower = higher priority (0..7)
}

export interface HtbChargeOutcome {
  allowed: boolean;
  consumedFromAssured: number;
  borrowedFromParent: number;
  remainingParentTokens: number;
}

/**
 * Linux-Kernel-Inspired Hierarchical Token Bucket (HTB) Multi-Tenant Traffic & Token Shaper.
 * Enforces Guaranteed Rate (CIR) per tenant class and allows borrowing excess tokens from the
 * parent root bucket up to each class's Ceil Rate (PIR).
 */
export class HierarchicalTokenBucketShaper {
  private parentTokens: number;
  private readonly parentMaxBurst: number;
  private readonly parentRefillPerSec: number;
  private lastTickMs: number;

  private readonly classes = new Map<
    string,
    HtbClassConfig & { assuredTokens: number; ceilTokens: number }
  >();

  constructor(params: {
    parentRefillPerSec: number;
    parentMaxBurst: number;
    initialTimestampMs?: number;
  }) {
    this.parentRefillPerSec = Math.max(1, params.parentRefillPerSec);
    this.parentMaxBurst = Math.max(1, params.parentMaxBurst);
    this.parentTokens = this.parentMaxBurst;
    this.lastTickMs = params.initialTimestampMs ?? 0;
  }

  public registerClass(config: HtbClassConfig): void {
    this.classes.set(config.classId, {
      ...config,
      assuredTokens: config.burstCapacity,
      ceilTokens: config.burstCapacity * 2
    });
  }

  public advanceClock(nowMs: number): void {
    const dtSec = Math.max(0, (nowMs - this.lastTickMs) / 1000);
    if (dtSec <= 0) return;
    this.lastTickMs = nowMs;

    this.parentTokens = Math.min(
      this.parentMaxBurst,
      this.parentTokens + dtSec * this.parentRefillPerSec
    );

    for (const c of this.classes.values()) {
      c.assuredTokens = Math.min(
        c.burstCapacity,
        c.assuredTokens + dtSec * c.assuredRateTokensPerSec
      );
      c.ceilTokens = Math.min(
        c.burstCapacity * 2,
        c.ceilTokens + dtSec * c.ceilRateTokensPerSec
      );
    }
  }

  public requestTokens(classId: string, amount: number, nowMs?: number): HtbChargeOutcome {
    if (nowMs !== undefined) {
      this.advanceClock(nowMs);
    }
    const cls = this.classes.get(classId);
    if (!cls) {
      throw new Error(`UNKNOWN_HTB_CLASS: ${classId}`);
    }

    // Cannot exceed class ceil token bucket
    if (amount > cls.ceilTokens) {
      return {
        allowed: false,
        consumedFromAssured: 0,
        borrowedFromParent: 0,
        remainingParentTokens: Number(this.parentTokens.toFixed(4))
      };
    }

    if (amount <= cls.assuredTokens) {
      cls.assuredTokens -= amount;
      cls.ceilTokens -= amount;
      this.parentTokens = Math.max(0, this.parentTokens - amount);
      return {
        allowed: true,
        consumedFromAssured: amount,
        borrowedFromParent: 0,
        remainingParentTokens: Number(this.parentTokens.toFixed(4))
      };
    }

    // Need to borrow deficit from parent root bucket
    const fromAssured = cls.assuredTokens;
    const deficit = amount - fromAssured;

    if (this.parentTokens >= amount) {
      cls.assuredTokens = 0;
      cls.ceilTokens -= amount;
      this.parentTokens -= amount;
      return {
        allowed: true,
        consumedFromAssured: Number(fromAssured.toFixed(4)),
        borrowedFromParent: Number(deficit.toFixed(4)),
        remainingParentTokens: Number(this.parentTokens.toFixed(4))
      };
    }

    return {
      allowed: false,
      consumedFromAssured: 0,
      borrowedFromParent: 0,
      remainingParentTokens: Number(this.parentTokens.toFixed(4))
    };
  }
}
