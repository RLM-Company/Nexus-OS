export type RaftRole = "follower" | "candidate" | "leader";

export interface RaftLogEntry {
  term: number;
  index: number; // 1-indexed
  command: string;
}

export interface RequestVoteArgs {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteReply {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesArgs {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: RaftLogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesReply {
  term: number;
  success: boolean;
  matchIndex: number;
}

/**
 * Deterministic Raft Consensus State Machine & Replicated Log Node.
 * Enforces Election Safety, Log Matching, and Leader Completeness invariants.
 */
export class RaftConsensusNode {
  public readonly nodeId: string;
  public readonly clusterPeers: string[];
  public currentTerm = 0;
  public votedFor: string | null = null;
  public role: RaftRole = "follower";
  public readonly log: RaftLogEntry[] = [];
  public commitIndex = 0;
  public lastApplied = 0;
  public readonly appliedCommands: string[] = [];

  private votesReceived = new Set<string>();
  private readonly matchIndexByPeer = new Map<string, number>();

  constructor(nodeId: string, clusterPeers: string[]) {
    this.nodeId = nodeId;
    this.clusterPeers = clusterPeers;
  }

  public get lastLogIndex(): number {
    return this.log.length;
  }

  public get lastLogTerm(): number {
    return this.log.length > 0 ? this.log[this.log.length - 1]!.term : 0;
  }

  public termAt(index: number): number {
    if (index <= 0 || index > this.log.length) return 0;
    return this.log[index - 1]!.term;
  }

  /**
   * Transitions node to Candidate, increments term, votes for self, and builds RequestVote RPC args.
   */
  public startElection(): RequestVoteArgs {
    this.currentTerm++;
    this.role = "candidate";
    this.votedFor = this.nodeId;
    this.votesReceived = new Set([this.nodeId]);

    return {
      term: this.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex: this.lastLogIndex,
      lastLogTerm: this.lastLogTerm
    };
  }

  public handleRequestVote(args: RequestVoteArgs): RequestVoteReply {
    if (args.term > this.currentTerm) {
      this.currentTerm = args.term;
      this.role = "follower";
      this.votedFor = null;
    }

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    // Check Election Restriction: candidate's log must be at least as up-to-date as receiver's log
    const logUpToDate =
      args.lastLogTerm > this.lastLogTerm ||
      (args.lastLogTerm === this.lastLogTerm && args.lastLogIndex >= this.lastLogIndex);

    const canVote =
      (this.votedFor === null || this.votedFor === args.candidateId) && logUpToDate;

    if (canVote) {
      this.votedFor = args.candidateId;
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  public receiveVoteReply(peerId: string, reply: RequestVoteReply): boolean {
    if (reply.term > this.currentTerm) {
      this.currentTerm = reply.term;
      this.role = "follower";
      this.votedFor = null;
      return false;
    }

    if (this.role !== "candidate" || reply.term !== this.currentTerm) {
      return false;
    }

    if (reply.voteGranted) {
      this.votesReceived.add(peerId);
      const totalClusterSize = this.clusterPeers.length + 1;
      const quorum = Math.floor(totalClusterSize / 2) + 1;
      if (this.votesReceived.size >= quorum) {
        this.role = "leader";
        for (const p of this.clusterPeers) {
          this.matchIndexByPeer.set(p, 0);
        }
        return true;
      }
    }
    return false;
  }

  public proposeCommand(command: string): RaftLogEntry {
    if (this.role !== "leader") {
      throw new Error(`RAFT_NOT_LEADER: node '${this.nodeId}' is ${this.role}`);
    }
    const entry: RaftLogEntry = {
      term: this.currentTerm,
      index: this.log.length + 1,
      command
    };
    this.log.push(entry);
    return entry;
  }

  public handleAppendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    if (args.term > this.currentTerm) {
      this.currentTerm = args.term;
      this.votedFor = null;
    }

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, success: false, matchIndex: 0 };
    }

    this.role = "follower";

    // Log Matching check at prevLogIndex
    if (args.prevLogIndex > 0) {
      if (this.log.length < args.prevLogIndex) {
        return { term: this.currentTerm, success: false, matchIndex: this.log.length };
      }
      if (this.termAt(args.prevLogIndex) !== args.prevLogTerm) {
        // Delete conflicting entry and all that follow it
        this.log.splice(args.prevLogIndex - 1);
        return { term: this.currentTerm, success: false, matchIndex: this.log.length };
      }
    }

    // Append any new entries not already in the log
    for (const entry of args.entries) {
      const idx0 = entry.index - 1;
      if (idx0 < this.log.length) {
        if (this.log[idx0]!.term !== entry.term) {
          this.log.splice(idx0);
          this.log.push(entry);
        }
      } else {
        this.log.push(entry);
      }
    }

    if (args.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(args.leaderCommit, this.lastLogIndex);
      this.applyCommittedEntries();
    }

    return {
      term: this.currentTerm,
      success: true,
      matchIndex: this.lastLogIndex
    };
  }

  public recordFollowerAppendReply(peerId: string, reply: AppendEntriesReply): number {
    if (reply.term > this.currentTerm) {
      this.currentTerm = reply.term;
      this.role = "follower";
      this.votedFor = null;
      return this.commitIndex;
    }

    if (this.role === "leader" && reply.success) {
      this.matchIndexByPeer.set(peerId, reply.matchIndex);
      const allMatchIndices = [
        this.lastLogIndex,
        ...this.clusterPeers.map((p) => this.matchIndexByPeer.get(p) ?? 0)
      ].sort((a, b) => b - a);

      const quorumIdx = Math.floor((this.clusterPeers.length + 1) / 2);
      const majorityMatchIndex = allMatchIndices[quorumIdx] ?? 0;

      if (
        majorityMatchIndex > this.commitIndex &&
        this.termAt(majorityMatchIndex) === this.currentTerm
      ) {
        this.commitIndex = majorityMatchIndex;
        this.applyCommittedEntries();
      }
    }

    return this.commitIndex;
  }

  private applyCommittedEntries(): void {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied - 1]!;
      this.appliedCommands.push(entry.command);
    }
  }
}
