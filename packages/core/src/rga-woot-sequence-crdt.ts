export interface RgaVertexId {
  lamport: number;
  replicaId: string;
}

export interface RgaInsertOp {
  id: RgaVertexId;
  leftOriginId: RgaVertexId | null;
  char: string;
}

export interface RgaDeleteOp {
  targetId: RgaVertexId;
}

interface InternalRgaNode {
  id: RgaVertexId;
  leftOriginId: RgaVertexId | null;
  char: string;
  deleted: boolean;
}

function compareVertexIdsDesc(a: RgaVertexId, b: RgaVertexId): number {
  if (a.lamport !== b.lamport) {
    return b.lamport - a.lamport; // Higher Lamport timestamp wins (placed earlier to the right of same origin)
  }
  return b.replicaId.localeCompare(a.replicaId);
}

function vertexEquals(a: RgaVertexId | null, b: RgaVertexId | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.lamport === b.lamport && a.replicaId === b.replicaId;
}

/**
 * Replicated Growable Array (RGA) Commutative Sequence & Collaborative Text CRDT.
 * Guarantees Strong Eventual Consistency (SEC): any two replicas applying the same set of
 * concurrent Insert and Delete operations in arbitrary order converge to the exact same text.
 */
export class RgaSequenceTextCrdt {
  public readonly replicaId: string;
  private lamportClock = 0;
  private readonly sequence: InternalRgaNode[] = [];

  constructor(replicaId: string) {
    this.replicaId = replicaId;
  }

  public localInsertAtVisibleIndex(visibleIndex: number, char: string): RgaInsertOp {
    this.lamportClock++;
    const id: RgaVertexId = { lamport: this.lamportClock, replicaId: this.replicaId };

    let leftOriginId: RgaVertexId | null = null;
    if (visibleIndex > 0) {
      let seenVisible = 0;
      for (const node of this.sequence) {
        if (!node.deleted) {
          seenVisible++;
          if (seenVisible === visibleIndex) {
            leftOriginId = node.id;
            break;
          }
        }
      }
    }

    const op: RgaInsertOp = { id, leftOriginId, char };
    this.applyInsert(op);
    return op;
  }

  public applyInsert(op: RgaInsertOp): void {
    this.lamportClock = Math.max(this.lamportClock, op.id.lamport);
    // Idempotency check
    if (this.sequence.some((n) => vertexEquals(n.id, op.id))) {
      return;
    }

    let insertIdx = 0;
    if (op.leftOriginId !== null) {
      const originPos = this.sequence.findIndex((n) => vertexEquals(n.id, op.leftOriginId));
      if (originPos === -1) {
        insertIdx = this.sequence.length;
      } else {
        insertIdx = originPos + 1;
      }
    }

    // RGA tie-breaking: skip rightwards past existing nodes whose ID is greater than op.id
    while (
      insertIdx < this.sequence.length &&
      compareVertexIdsDesc(this.sequence[insertIdx]!.id, op.id) < 0
    ) {
      insertIdx++;
    }

    this.sequence.splice(insertIdx, 0, {
      id: { ...op.id },
      leftOriginId: op.leftOriginId ? { ...op.leftOriginId } : null,
      char: op.char,
      deleted: false
    });
  }

  public applyDelete(op: RgaDeleteOp): boolean {
    const target = this.sequence.find((n) => vertexEquals(n.id, op.targetId));
    if (!target) return false;
    target.deleted = true;
    return true;
  }

  public toString(): string {
    return this.sequence
      .filter((n) => !n.deleted)
      .map((n) => n.char)
      .join("");
  }
}
