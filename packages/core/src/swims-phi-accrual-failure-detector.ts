export type SwimMemberStatus = "ALIVE" | "SUSPECT" | "DEAD";

export interface SwimMemberState {
  nodeId: string;
  incarnation: number;
  status: SwimMemberStatus;
  phiSuspicion: number;
}

/**
 * Hayashibara Phi-Accrual Failure Detector + SWIM Gossip Membership State Machine.
 * Computes continuous suspicion score Phi(t) = -log10(1 - F_Normal(dt; mean, std))
 * from heartbeat inter-arrival intervals and supports incarnation-based suspicion refutation.
 */
export class PhiAccrualFailureDetector {
  private readonly windowSize: number;
  private readonly suspectPhiThreshold: number;
  private readonly deadPhiThreshold: number;
  private readonly intervalsByNode = new Map<string, number[]>();
  private readonly lastHeartbeatMsByNode = new Map<string, number>();
  private readonly incarnationByNode = new Map<string, number>();
  private readonly statusByNode = new Map<string, SwimMemberStatus>();

  constructor(params?: {
    windowSize?: number;
    suspectPhiThreshold?: number;
    deadPhiThreshold?: number;
  }) {
    this.windowSize = Math.max(4, params?.windowSize ?? 32);
    this.suspectPhiThreshold = params?.suspectPhiThreshold ?? 3.0;
    this.deadPhiThreshold = params?.deadPhiThreshold ?? 8.0;
  }

  public recordHeartbeat(nodeId: string, timestampMs: number, incarnation = 0): void {
    const prevTs = this.lastHeartbeatMsByNode.get(nodeId);
    if (prevTs !== undefined && timestampMs > prevTs) {
      const dt = timestampMs - prevTs;
      const arr = this.intervalsByNode.get(nodeId) ?? [];
      arr.push(dt);
      if (arr.length > this.windowSize) arr.shift();
      this.intervalsByNode.set(nodeId, arr);
    } else if (!this.intervalsByNode.has(nodeId)) {
      this.intervalsByNode.set(nodeId, [1000, 1000, 1000]);
    }

    this.lastHeartbeatMsByNode.set(nodeId, timestampMs);
    const prevInc = this.incarnationByNode.get(nodeId) ?? 0;
    this.incarnationByNode.set(nodeId, Math.max(prevInc, incarnation));
    this.statusByNode.set(nodeId, "ALIVE");
  }

  /**
   * Standard normal complementary CDF P(X > z) approximation to compute -log10(P(T > dt)).
   */
  public computePhi(nodeId: string, nowMs: number): number {
    const lastTs = this.lastHeartbeatMsByNode.get(nodeId);
    if (lastTs === undefined) return 0;

    const elapsed = Math.max(0, nowMs - lastTs);
    const intervals = this.intervalsByNode.get(nodeId) ?? [1000];
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance =
      intervals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / intervals.length;
    const std = Math.max(mean * 0.1, Math.sqrt(variance));

    // Exponential tail approximation for Hayashibara Phi:
    // z = (elapsed - mean) / std
    if (elapsed <= mean) return 0;
    const z = (elapsed - mean) / std;
    // Gaussian tail probability exp(-z^2 / 2) -> -log10(tail) ~ (z^2 / 2) * log10(e) + 0.3
    const phi = 0.217147 * z * z + 0.35 * z;
    return Number(phi.toFixed(4));
  }

  public evaluateNode(nodeId: string, nowMs: number): SwimMemberState {
    const phi = this.computePhi(nodeId, nowMs);
    let status: SwimMemberStatus = "ALIVE";
    if (phi >= this.deadPhiThreshold) {
      status = "DEAD";
    } else if (phi >= this.suspectPhiThreshold) {
      status = "SUSPECT";
    }
    this.statusByNode.set(nodeId, status);

    return {
      nodeId,
      incarnation: this.incarnationByNode.get(nodeId) ?? 0,
      status,
      phiSuspicion: phi
    };
  }

  /**
   * SWIM suspicion refutation: a suspected node increments its incarnation number to prove liveness.
   */
  public refuteSuspicion(nodeId: string, nowMs: number): SwimMemberState {
    const nextInc = (this.incarnationByNode.get(nodeId) ?? 0) + 1;
    this.recordHeartbeat(nodeId, nowMs, nextInc);
    return this.evaluateNode(nodeId, nowMs);
  }
}
