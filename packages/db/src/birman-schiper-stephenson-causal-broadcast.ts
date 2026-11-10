import { DatabaseSync } from "node:sqlite";

export interface CausalBroadcastMessage {
  messageId: string;
  senderNodeId: string;
  vectorClock: Record<string, number>;
  payload: string;
}

/**
 * Birman-Schiper-Stephenson (BSS) Vector-Clock Causal Broadcast Buffer backed by SQLite.
 * Buffers out-of-order incoming messages in `kosmora_causal_broadcast_queue` and delivers
 * a message m from sender s only when:
 *   1. V_m[s] == V_local[s] + 1
 *   2. For all k != s: V_m[k] <= V_local[k]
 */
export class CausalBroadcastVectorClockBuffer {
  private readonly db: DatabaseSync;
  private readonly localClock = new Map<string, number>();
  public readonly deliveredMessages: CausalBroadcastMessage[] = [];

  public constructor(db: DatabaseSync, knownNodeIds: string[] = []) {
    this.db = db;
    for (const id of knownNodeIds) {
      this.localClock.set(id, 0);
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_causal_broadcast_queue (
        message_id TEXT PRIMARY KEY,
        sender_node_id TEXT NOT NULL,
        vector_clock_json TEXT NOT NULL,
        payload TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private isCausallyDeliverable(msg: CausalBroadcastMessage): boolean {
    const s = msg.senderNodeId;
    const localS = this.localClock.get(s) ?? 0;
    const msgS = msg.vectorClock[s] ?? 0;
    if (msgS !== localS + 1) return false;

    for (const [nodeId, msgTick] of Object.entries(msg.vectorClock)) {
      if (nodeId === s) continue;
      const localTick = this.localClock.get(nodeId) ?? 0;
      if (msgTick > localTick) return false;
    }
    return true;
  }

  public receiveMessage(msg: CausalBroadcastMessage): CausalBroadcastMessage[] {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO kosmora_causal_broadcast_queue
         (message_id, sender_node_id, vector_clock_json, payload, delivered)
         VALUES (?, ?, ?, ?, 0)`
      )
      .run(msg.messageId, msg.senderNodeId, JSON.stringify(msg.vectorClock), msg.payload);

    return this.drainDeliverableMessages();
  }

  public drainDeliverableMessages(): CausalBroadcastMessage[] {
    const newlyDelivered: CausalBroadcastMessage[] = [];
    let progress = true;

    while (progress) {
      progress = false;
      const pendingRows = this.db
        .prepare(
          `SELECT message_id, sender_node_id, vector_clock_json, payload
           FROM kosmora_causal_broadcast_queue
           WHERE delivered = 0`
        )
        .all() as Array<{
        message_id: string;
        sender_node_id: string;
        vector_clock_json: string;
        payload: string;
      }>;

      for (const row of pendingRows) {
        const candidate: CausalBroadcastMessage = {
          messageId: row.message_id,
          senderNodeId: row.sender_node_id,
          vectorClock: JSON.parse(row.vector_clock_json) as Record<string, number>,
          payload: row.payload
        };

        if (this.isCausallyDeliverable(candidate)) {
          this.localClock.set(
            candidate.senderNodeId,
            (this.localClock.get(candidate.senderNodeId) ?? 0) + 1
          );
          this.db
            .prepare(
              `UPDATE kosmora_causal_broadcast_queue SET delivered = 1 WHERE message_id = ?`
            )
            .run(candidate.messageId);
          this.deliveredMessages.push(candidate);
          newlyDelivered.push(candidate);
          progress = true;
        }
      }
    }

    return newlyDelivered;
  }
}
