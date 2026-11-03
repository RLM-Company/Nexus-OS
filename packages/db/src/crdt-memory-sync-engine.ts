/**
 * Kosmora / Nexus-OS Hybrid Logical Clock (HLC) & CRDT Conflict-Free Memory Sync Engine (Wave 19)
 *
 * Implements state-based Last-Write-Wins Element-Set (LWW-Element-Set) CRDTs with
 * Hybrid Logical Clocks (HLC) across Desktop, Cloud VPS, and Google Drive replicas.
 *
 * Mathematical Guarantees:
 * 1. Commutativity: merge(A, B) === merge(B, A)
 * 2. Associativity: merge(merge(A, B), C) === merge(A, merge(B, C))
 * 3. Idempotence:   merge(A, A) === A
 * 4. Monotonic causal ordering even under physical clock drift between Windows client and VPS.
 */

import type { DatabaseSync } from "node:sqlite";

export interface HybridLogicalTimestamp {
  wallTimeMs: number;
  logicalCounter: number;
  nodeId: string;
}

export interface CrdtFieldRegister {
  value: any;
  hlc: string;
}

export interface CrdtMemoryState {
  entryId: string;
  ownerId: string;
  fields: Record<string, CrdtFieldRegister>;
  tombstoned: boolean;
  tombstoneHlc?: string;
}

/**
 * Formats an HLC tuple into a canonical lexicographically sortable string:
 * `<15-digit padded wallTimeMs>:<6-digit hex counter>:<nodeId>`
 */
export function formatHlc(ts: HybridLogicalTimestamp): string {
  const wallPadded = String(Math.max(0, Math.floor(ts.wallTimeMs))).padStart(15, "0");
  const counterHex = Math.max(0, Math.floor(ts.logicalCounter)).toString(16).padStart(6, "0");
  return `${wallPadded}:${counterHex}:${ts.nodeId}`;
}

export function parseHlc(raw: string): HybridLogicalTimestamp {
  const parts = String(raw ?? "").split(":");
  if (parts.length < 3) {
    return { wallTimeMs: 0, logicalCounter: 0, nodeId: "0000" };
  }
  const wallTimeMs = Number.parseInt(parts[0], 10) || 0;
  const logicalCounter = Number.parseInt(parts[1], 16) || 0;
  const nodeId = parts.slice(2).join(":");
  return { wallTimeMs, logicalCounter, nodeId };
}

/**
 * Compares two HLC strings. Returns:
 *  1 if a > b
 * -1 if a < b
 *  0 if a === b
 */
export function compareHlc(a: string, b: string): number {
  if (a === b) return 0;
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (pa.wallTimeMs !== pb.wallTimeMs) {
    return pa.wallTimeMs > pb.wallTimeMs ? 1 : -1;
  }
  if (pa.logicalCounter !== pb.logicalCounter) {
    return pa.logicalCounter > pb.logicalCounter ? 1 : -1;
  }
  return pa.nodeId > pb.nodeId ? 1 : pa.nodeId < pb.nodeId ? -1 : 0;
}

export class HybridLogicalClock {
  private lastWallTimeMs: number;
  private lastCounter: number;
  private readonly nodeId: string;

  constructor(nodeId: string, initialWallTimeMs = Date.now()) {
    this.nodeId = nodeId;
    this.lastWallTimeMs = initialWallTimeMs;
    this.lastCounter = 0;
  }

  public now(physicalNowMs = Date.now()): string {
    if (physicalNowMs > this.lastWallTimeMs) {
      this.lastWallTimeMs = physicalNowMs;
      this.lastCounter = 0;
    } else {
      this.lastCounter += 1;
    }
    return formatHlc({
      wallTimeMs: this.lastWallTimeMs,
      logicalCounter: this.lastCounter,
      nodeId: this.nodeId
    });
  }

  public receive(remoteHlcStr: string, physicalNowMs = Date.now()): string {
    const remote = parseHlc(remoteHlcStr);
    if (physicalNowMs > this.lastWallTimeMs && physicalNowMs > remote.wallTimeMs) {
      this.lastWallTimeMs = physicalNowMs;
      this.lastCounter = 0;
    } else if (this.lastWallTimeMs === remote.wallTimeMs) {
      this.lastCounter = Math.max(this.lastCounter, remote.logicalCounter) + 1;
    } else if (this.lastWallTimeMs > remote.wallTimeMs) {
      this.lastCounter += 1;
    } else {
      this.lastWallTimeMs = remote.wallTimeMs;
      this.lastCounter = remote.logicalCounter + 1;
    }
    return formatHlc({
      wallTimeMs: this.lastWallTimeMs,
      logicalCounter: this.lastCounter,
      nodeId: this.nodeId
    });
  }
}

/**
 * Pure commutative, associative, idempotent merge of two CRDT memory states.
 */
export function mergeCrdtStates(stateA: CrdtMemoryState, stateB: CrdtMemoryState): CrdtMemoryState {
  if (stateA.entryId !== stateB.entryId || stateA.ownerId !== stateB.ownerId) {
    throw new Error("CRDT_MISMATCH: Cannot merge states with different entryId or ownerId");
  }

  const allKeys = new Set([
    ...Object.keys(stateA.fields || {}),
    ...Object.keys(stateB.fields || {})
  ]);

  const mergedFields: Record<string, CrdtFieldRegister> = {};
  for (const key of Array.from(allKeys).sort()) {
    const regA = stateA.fields[key];
    const regB = stateB.fields[key];
    if (regA && !regB) {
      mergedFields[key] = { ...regA };
    } else if (!regA && regB) {
      mergedFields[key] = { ...regB };
    } else if (regA && regB) {
      const cmp = compareHlc(regA.hlc, regB.hlc);
      mergedFields[key] = cmp >= 0 ? { ...regA } : { ...regB };
    }
  }

  // Merge tombstone state
  let tombstoned = false;
  let tombstoneHlc: string | undefined;

  if (stateA.tombstoned && stateB.tombstoned) {
    tombstoned = true;
    tombstoneHlc =
      compareHlc(stateA.tombstoneHlc || "", stateB.tombstoneHlc || "") >= 0
        ? stateA.tombstoneHlc
        : stateB.tombstoneHlc;
  } else if (stateA.tombstoned || stateB.tombstoned) {
    const candidateTombHlc = stateA.tombstoned ? stateA.tombstoneHlc! : stateB.tombstoneHlc!;
    // Check if any field write is newer than the tombstone HLC (resurrection)
    let latestFieldHlc = "";
    for (const reg of Object.values(mergedFields)) {
      if (compareHlc(reg.hlc, latestFieldHlc) > 0) {
        latestFieldHlc = reg.hlc;
      }
    }
    if (compareHlc(candidateTombHlc, latestFieldHlc) >= 0) {
      tombstoned = true;
      tombstoneHlc = candidateTombHlc;
    } else {
      tombstoned = false;
      tombstoneHlc = undefined;
    }
  }

  return {
    entryId: stateA.entryId,
    ownerId: stateA.ownerId,
    fields: mergedFields,
    tombstoned,
    ...(tombstoneHlc ? { tombstoneHlc } : {})
  };
}

export class CrdtMemorySyncEngine {
  private readonly clock: HybridLogicalClock;

  constructor(private readonly sqlite: DatabaseSync, nodeId = "node-local", initialWallTimeMs = Date.now()) {
    this.clock = new HybridLogicalClock(nodeId, initialWallTimeMs);
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_crdt_memory_states (
        entry_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        crdt_json TEXT NOT NULL,
        latest_hlc TEXT NOT NULL,
        tombstoned INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, entry_id)
      );
      CREATE INDEX IF NOT EXISTS kosmora_crdt_memory_owner_hlc_idx
        ON kosmora_crdt_memory_states(owner_id, latest_hlc ASC);
    `);
  }

  public upsertLocalMutation(options: {
    ownerId: string;
    entryId: string;
    patchFields: Record<string, any>;
    physicalNowMs?: number;
  }): CrdtMemoryState {
    const hlc = this.clock.now(options.physicalNowMs);
    const existing = this.getState(options.ownerId, options.entryId);

    const nextFields: Record<string, CrdtFieldRegister> = existing ? { ...existing.fields } : {};
    for (const [k, v] of Object.entries(options.patchFields)) {
      nextFields[k] = { value: v, hlc };
    }

    const nextState: CrdtMemoryState = {
      entryId: options.entryId,
      ownerId: options.ownerId,
      fields: nextFields,
      tombstoned: false
    };

    const merged = existing ? mergeCrdtStates(existing, nextState) : nextState;
    this.saveState(merged, hlc);
    return merged;
  }

  public applyRemoteState(remoteState: CrdtMemoryState, physicalNowMs?: number): CrdtMemoryState {
    // Advance local HLC against all remote HLCs
    for (const reg of Object.values(remoteState.fields)) {
      this.clock.receive(reg.hlc, physicalNowMs);
    }
    if (remoteState.tombstoneHlc) {
      this.clock.receive(remoteState.tombstoneHlc, physicalNowMs);
    }

    const existing = this.getState(remoteState.ownerId, remoteState.entryId);
    const merged = existing ? mergeCrdtStates(existing, remoteState) : remoteState;

    let maxHlc = merged.tombstoneHlc || "";
    for (const reg of Object.values(merged.fields)) {
      if (compareHlc(reg.hlc, maxHlc) > 0) {
        maxHlc = reg.hlc;
      }
    }
    this.saveState(merged, maxHlc || this.clock.now(physicalNowMs));
    return merged;
  }

  public getState(ownerId: string, entryId: string): CrdtMemoryState | null {
    const row = this.sqlite
      .prepare(
        "SELECT crdt_json FROM kosmora_crdt_memory_states WHERE owner_id = ? AND entry_id = ?"
      )
      .get(ownerId, entryId) as { crdt_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.crdt_json) as CrdtMemoryState;
  }

  public materializeValue(ownerId: string, entryId: string): Record<string, any> | null {
    const st = this.getState(ownerId, entryId);
    if (!st || st.tombstoned) return null;
    const result: Record<string, any> = {};
    for (const [k, reg] of Object.entries(st.fields)) {
      result[k] = reg.value;
    }
    return result;
  }

  private saveState(state: CrdtMemoryState, latestHlc: string): void {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_crdt_memory_states (
          entry_id, owner_id, crdt_json, latest_hlc, tombstoned, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, entry_id) DO UPDATE SET
          crdt_json = excluded.crdt_json,
          latest_hlc = excluded.latest_hlc,
          tombstoned = excluded.tombstoned,
          updated_at = excluded.updated_at`
      )
      .run(
        state.entryId,
        state.ownerId,
        JSON.stringify(state),
        latestHlc,
        state.tombstoned ? 1 : 0,
        now
      );
  }
}
