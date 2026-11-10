import { DatabaseSync } from "node:sqlite";

export type TwoPhaseCommitDecision = "GLOBAL_COMMIT" | "GLOBAL_ABORT";

export interface ParticipantVote {
  participantId: string;
  vote: "VOTE_COMMIT" | "VOTE_ABORT";
  reason?: string;
}

export interface TwoPhaseTransactionRecord {
  txId: string;
  coordinatorId: string;
  decision: TwoPhaseCommitDecision;
  committedParticipants: string[];
  abortedParticipants: string[];
}

export interface DeadlockResolutionReport {
  hasDeadlock: boolean;
  cyclesDetected: string[][];
  selectedVictimTxId: string | null;
}

/**
 * Atomic Two-Phase Commit (2PC) Coordinator & Wait-For Graph (WFG) Deadlock Detector.
 * Logs 2PC decisions to SQLite (`kosmora_2pc_transactions`) and detects lock wait-for cycles,
 * automatically selecting the youngest transaction (highest start timestamp) as the abort victim.
 */
export class TwoPhaseCommitAndWaitForDeadlockEngine {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_2pc_transactions (
        tx_id TEXT PRIMARY KEY NOT NULL,
        coordinator_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        participants_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  public executeTwoPhaseCommit(params: {
    txId: string;
    coordinatorId: string;
    votes: ParticipantVote[];
  }): TwoPhaseTransactionRecord {
    const committedParticipants: string[] = [];
    const abortedParticipants: string[] = [];

    for (const v of params.votes) {
      if (v.vote === "VOTE_COMMIT") {
        committedParticipants.push(v.participantId);
      } else {
        abortedParticipants.push(v.participantId);
      }
    }

    // Atomic 2PC rule: GLOBAL_COMMIT iff 100% of participants voted VOTE_COMMIT
    const decision: TwoPhaseCommitDecision =
      params.votes.length > 0 && abortedParticipants.length === 0
        ? "GLOBAL_COMMIT"
        : "GLOBAL_ABORT";

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_2pc_transactions
          (tx_id, coordinator_id, decision, participants_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tx_id) DO UPDATE SET
          decision = excluded.decision,
          participants_json = excluded.participants_json`
      )
      .run(
        params.txId,
        params.coordinatorId,
        decision,
        JSON.stringify(params.votes),
        new Date().toISOString()
      );

    return {
      txId: params.txId,
      coordinatorId: params.coordinatorId,
      decision,
      committedParticipants,
      abortedParticipants
    };
  }

  /**
   * Analyzes a transaction Wait-For Graph (edge `waiterTxId -> holderTxId`) for deadlock cycles
   * and selects the youngest transaction in the cycle as the victim to abort.
   */
  public static detectWaitForDeadlock(params: {
    transactions: Array<{ txId: string; startTimestampMs: number }>;
    waitForEdges: Array<{ waiterTxId: string; holderTxId: string }>;
  }): DeadlockResolutionReport {
    const startTsByTx = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const tx of params.transactions) {
      startTsByTx.set(tx.txId, tx.startTimestampMs);
      adj.set(tx.txId, []);
    }
    for (const e of params.waitForEdges) {
      if (!adj.has(e.waiterTxId)) adj.set(e.waiterTxId, []);
      adj.get(e.waiterTxId)!.push(e.holderTxId);
    }

    const visited = new Set<string>();
    const onPath = new Set<string>();
    const pathStack: string[] = [];
    const cyclesDetected: string[][] = [];

    const dfs = (u: string) => {
      visited.add(u);
      onPath.add(u);
      pathStack.push(u);

      for (const v of adj.get(u) ?? []) {
        if (!visited.has(v)) {
          dfs(v);
        } else if (onPath.has(v)) {
          const cycleStart = pathStack.indexOf(v);
          if (cycleStart !== -1) {
            cyclesDetected.push(pathStack.slice(cycleStart));
          }
        }
      }

      pathStack.pop();
      onPath.delete(u);
    };

    for (const txId of adj.keys()) {
      if (!visited.has(txId)) {
        dfs(txId);
      }
    }

    if (cyclesDetected.length === 0) {
      return {
        hasDeadlock: false,
        cyclesDetected: [],
        selectedVictimTxId: null
      };
    }

    // Pick youngest transaction (largest startTimestampMs) in the first detected cycle
    let victimTxId = cyclesDetected[0]![0]!;
    let maxStartTs = -Infinity;
    for (const txId of cyclesDetected[0]!) {
      const ts = startTsByTx.get(txId) ?? 0;
      if (ts > maxStartTs) {
        maxStartTs = ts;
        victimTxId = txId;
      }
    }

    return {
      hasDeadlock: true,
      cyclesDetected,
      selectedVictimTxId: victimTxId
    };
  }
}
