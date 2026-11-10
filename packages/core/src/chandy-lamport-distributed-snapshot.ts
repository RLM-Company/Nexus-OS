export interface GlobalConsistentCutSnapshot<TLocalState = Record<string, unknown>> {
  snapshotId: string;
  complete: boolean;
  recordedLocalStatesByNode: Record<string, TLocalState>;
  inFlightChannelMessages: Record<string, string[]>; // channelKey "from->to" -> messages captured in transit
}

/**
 * Chandy-Lamport Distributed Global Snapshot Algorithm.
 * Captures a causally consistent global state cut across asynchronous message-passing processes
 * using Marker messages without pausing application traffic.
 */
export class ChandyLamportSnapshotCoordinator<TLocalState = Record<string, unknown>> {
  public readonly snapshotId: string;
  private readonly allNodes: string[];
  private readonly incomingPeersByNode = new Map<string, Set<string>>();
  private readonly recordedNodeStates = new Map<string, TLocalState>();
  // markerClosedChannels: `${from}->${to}` where marker has arrived on that incoming channel
  private readonly closedChannels = new Set<string>();
  private readonly channelBuffers = new Map<string, string[]>();

  constructor(snapshotId: string, nodes: string[], directedChannels: Array<{ from: string; to: string }>) {
    this.snapshotId = snapshotId;
    this.allNodes = [...nodes];
    for (const n of nodes) {
      this.incomingPeersByNode.set(n, new Set());
    }
    for (const ch of directedChannels) {
      if (!this.incomingPeersByNode.has(ch.to)) {
        this.incomingPeersByNode.set(ch.to, new Set());
      }
      this.incomingPeersByNode.get(ch.to)!.add(ch.from);
      this.channelBuffers.set(`${ch.from}->${ch.to}`, []);
    }
  }

  /**
   * Initiates snapshot at `initiatorNodeId` by recording its local state immediately.
   */
  public initiateSnapshotAtNode(initiatorNodeId: string, currentLocalState: TLocalState): void {
    if (!this.recordedNodeStates.has(initiatorNodeId)) {
      this.recordedNodeStates.set(
        initiatorNodeId,
        JSON.parse(JSON.stringify(currentLocalState)) as TLocalState
      );
    }
  }

  /**
   * Delivers a regular application message along channel `fromNodeId -> toNodeId`.
   * If `toNodeId` has already recorded its local state, AND the marker on `fromNodeId -> toNodeId`
   * has not yet arrived, this message is recorded as part of the in-flight channel state!
   */
  public onApplicationMessageReceived(
    fromNodeId: string,
    toNodeId: string,
    messagePayload: string
  ): void {
    const channelKey = `${fromNodeId}->${toNodeId}`;
    if (this.recordedNodeStates.has(toNodeId) && !this.closedChannels.has(channelKey)) {
      const buf = this.channelBuffers.get(channelKey) ?? [];
      buf.push(messagePayload);
      this.channelBuffers.set(channelKey, buf);
    }
  }

  /**
   * Delivers a Chandy-Lamport Marker along channel `fromNodeId -> toNodeId`.
   * - If `toNodeId` has NOT recorded its state yet: it records `currentLocalStateOfReceiver` and marks
   *   channel `fromNodeId -> toNodeId` as empty/closed.
   * - If `toNodeId` HAS already recorded its state: it closes channel `fromNodeId -> toNodeId`
   *   (freezing all in-flight messages recorded since `toNodeId` took its local snapshot).
   */
  public onMarkerReceived(
    fromNodeId: string,
    toNodeId: string,
    currentLocalStateOfReceiver: TLocalState
  ): void {
    const channelKey = `${fromNodeId}->${toNodeId}`;
    if (!this.recordedNodeStates.has(toNodeId)) {
      this.recordedNodeStates.set(
        toNodeId,
        JSON.parse(JSON.stringify(currentLocalStateOfReceiver)) as TLocalState
      );
      this.channelBuffers.set(channelKey, []);
    }
    this.closedChannels.add(channelKey);
  }

  public getSnapshotCut(): GlobalConsistentCutSnapshot<TLocalState> {
    const allNodesRecorded = this.allNodes.every((n) => this.recordedNodeStates.has(n));
    const allChannelsClosed = Array.from(this.channelBuffers.keys()).every((ch) =>
      this.closedChannels.has(ch)
    );

    return {
      snapshotId: this.snapshotId,
      complete: allNodesRecorded && allChannelsClosed,
      recordedLocalStatesByNode: Object.fromEntries(this.recordedNodeStates.entries()),
      inFlightChannelMessages: Object.fromEntries(this.channelBuffers.entries())
    };
  }
}
