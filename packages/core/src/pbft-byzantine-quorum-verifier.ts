import { createHash } from "node:crypto";

export type PbftPhase = "PRE-PREPARE" | "PREPARE" | "COMMIT" | "COMMITTED";

export interface PbftProtocolMessage {
  type: "PRE-PREPARE" | "PREPARE" | "COMMIT";
  viewNumber: number;
  sequenceNumber: number;
  digest: string;
  replicaId: string;
  payload?: string;
}

export interface PbftSlotStatus {
  viewNumber: number;
  sequenceNumber: number;
  digest: string;
  phase: PbftPhase;
  prepareQuorumReached: boolean;
  commitQuorumReached: boolean;
  prepareReplicaIds: string[];
  commitReplicaIds: string[];
}

/**
 * Castro-Liskov Practical Byzantine Fault Tolerance (PBFT) 3-Phase Quorum Engine.
 * Tolerates up to f arbitrary/Byzantine faulty replicas in a cluster of N >= 3f + 1 nodes
 * by requiring 2f + 1 matching PREPARE and COMMIT certificates before executing a command.
 */
export class PbftByzantineQuorumEngine {
  public readonly totalReplicasN: number;
  public readonly maxFaultyByzantineF: number;
  public readonly quorumSize: number; // 2f + 1
  public currentView = 0;

  // slotKey = `${view}:${seq}:${digest}`
  private readonly prepareVotes = new Map<string, Set<string>>();
  private readonly commitVotes = new Map<string, Set<string>>();
  private readonly payloadsByDigest = new Map<string, string>();
  public readonly committedCommands: Array<{
    viewNumber: number;
    sequenceNumber: number;
    digest: string;
    payload: string;
  }> = [];

  constructor(totalReplicasN = 4) {
    if (totalReplicasN < 4) {
      throw new Error("PBFT_MIN_REPLICAS_4: PBFT requires N >= 3f + 1 >= 4 replicas");
    }
    this.totalReplicasN = totalReplicasN;
    this.maxFaultyByzantineF = Math.floor((totalReplicasN - 1) / 3);
    this.quorumSize = 2 * this.maxFaultyByzantineF + 1;
  }

  public static computeDigest(payload: string): string {
    return createHash("sha256").update(payload, "utf8").digest("hex");
  }

  public ingestMessage(msg: PbftProtocolMessage): PbftSlotStatus {
    const digest = msg.payload ? PbftByzantineQuorumEngine.computeDigest(msg.payload) : msg.digest;
    if (msg.payload) {
      this.payloadsByDigest.set(digest, msg.payload);
    }

    const slotKey = `${msg.viewNumber}:${msg.sequenceNumber}:${digest}`;
    if (!this.prepareVotes.has(slotKey)) {
      this.prepareVotes.set(slotKey, new Set());
    }
    if (!this.commitVotes.has(slotKey)) {
      this.commitVotes.set(slotKey, new Set());
    }

    if (msg.type === "PRE-PREPARE" || msg.type === "PREPARE") {
      this.prepareVotes.get(slotKey)!.add(msg.replicaId);
    } else if (msg.type === "COMMIT") {
      this.commitVotes.get(slotKey)!.add(msg.replicaId);
    }

    const prepSet = this.prepareVotes.get(slotKey)!;
    const commSet = this.commitVotes.get(slotKey)!;

    const prepareQuorumReached = prepSet.size >= this.quorumSize;
    const commitQuorumReached = prepareQuorumReached && commSet.size >= this.quorumSize;

    let phase: PbftPhase = "PRE-PREPARE";
    if (commitQuorumReached) {
      phase = "COMMITTED";
      const alreadyCommitted = this.committedCommands.some(
        (c) =>
          c.viewNumber === msg.viewNumber &&
          c.sequenceNumber === msg.sequenceNumber &&
          c.digest === digest
      );
      if (!alreadyCommitted) {
        this.committedCommands.push({
          viewNumber: msg.viewNumber,
          sequenceNumber: msg.sequenceNumber,
          digest,
          payload: this.payloadsByDigest.get(digest) ?? ""
        });
      }
    } else if (prepareQuorumReached) {
      phase = "COMMIT";
    } else if (prepSet.size > 0) {
      phase = "PREPARE";
    }

    return {
      viewNumber: msg.viewNumber,
      sequenceNumber: msg.sequenceNumber,
      digest,
      phase,
      prepareQuorumReached,
      commitQuorumReached,
      prepareReplicaIds: Array.from(prepSet).sort(),
      commitReplicaIds: Array.from(commSet).sort()
    };
  }
}
