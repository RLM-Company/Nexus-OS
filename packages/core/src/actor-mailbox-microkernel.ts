export type ActorPriority = "high" | "normal" | "background";
export type SupervisionDirective = "restart" | "resume" | "stop" | "escalate";

export interface ActorMessage<TPayload = unknown> {
  messageId: string;
  senderId: string;
  recipientId: string;
  priority: ActorPriority;
  type: string;
  payload: TPayload;
  timestampMs: number;
}

export interface ActorContext<TState> {
  actorId: string;
  state: TState;
  setState: (nextState: TState) => void;
  send: (recipientId: string, type: string, payload: unknown, priority?: ActorPriority) => void;
}

export interface ActorSpecification<TState = unknown> {
  actorId: string;
  initialState: () => TState;
  supervisionStrategy?: SupervisionDirective;
  maxMailboxSize?: number;
  onMessage: (msg: ActorMessage, ctx: ActorContext<TState>) => Promise<void> | void;
}

export interface DeadLetterEntry {
  message: ActorMessage;
  reason: string;
}

/**
 * Deterministic Actor Model & Priority Mailbox Microkernel.
 * Provides isolated per-actor state, priority-ordered mailboxes (high -> normal -> background),
 * Erlang/Akka-style supervision recovery (restart / resume / stop / escalate), and Dead-Letter Queue tracking.
 */
export class ActorMailboxMicrokernel {
  private readonly specs = new Map<string, ActorSpecification<any>>();
  private readonly states = new Map<string, unknown>();
  private readonly mailboxes = new Map<string, ActorMessage[]>();
  private readonly stoppedActors = new Set<string>();
  private readonly deadLetters: DeadLetterEntry[] = [];
  private readonly processedTrace: Array<{
    actorId: string;
    messageId: string;
    type: string;
    outcome: "ok" | "restarted" | "resumed" | "stopped";
  }> = [];
  private msgSeq = 0;

  public registerActor<TState>(spec: ActorSpecification<TState>): void {
    this.specs.set(spec.actorId, spec);
    this.states.set(spec.actorId, spec.initialState());
    this.mailboxes.set(spec.actorId, []);
    this.stoppedActors.delete(spec.actorId);
  }

  public enqueueMessage(params: {
    senderId: string;
    recipientId: string;
    type: string;
    payload: unknown;
    priority?: ActorPriority;
  }): string {
    const messageId = `msg_${++this.msgSeq}`;
    const msg: ActorMessage = {
      messageId,
      senderId: params.senderId,
      recipientId: params.recipientId,
      priority: params.priority ?? "normal",
      type: params.type,
      payload: params.payload,
      timestampMs: Date.now()
    };

    const spec = this.specs.get(params.recipientId);
    if (!spec || this.stoppedActors.has(params.recipientId)) {
      this.deadLetters.push({
        message: msg,
        reason: spec ? "ACTOR_STOPPED" : "UNKNOWN_RECIPIENT_ACTOR"
      });
      return messageId;
    }

    const box = this.mailboxes.get(params.recipientId)!;
    const maxCap = spec.maxMailboxSize ?? 256;
    if (box.length >= maxCap) {
      this.deadLetters.push({
        message: msg,
        reason: "MAILBOX_OVERFLOW"
      });
      return messageId;
    }

    box.push(msg);
    // Keep sorted by priority (high=0, normal=1, background=2) while preserving FIFO within same priority
    const rank = (p: ActorPriority) => (p === "high" ? 0 : p === "normal" ? 1 : 2);
    box.sort((a, b) => rank(a.priority) - rank(b.priority));

    return messageId;
  }

  /**
   * Drains all actor mailboxes deterministically up to `maxSteps` messages.
   */
  public async drainUntilIdle(maxSteps = 500): Promise<{
    processedCount: number;
    deadLetterCount: number;
  }> {
    let processedCount = 0;

    while (processedCount < maxSteps) {
      let dispatchedInRound = false;

      for (const [actorId, box] of this.mailboxes.entries()) {
        if (this.stoppedActors.has(actorId) || box.length === 0) continue;
        const msg = box.shift()!;
        const spec = this.specs.get(actorId)!;
        dispatchedInRound = true;
        processedCount++;

        const ctx: ActorContext<any> = {
          actorId,
          state: this.states.get(actorId),
          setState: (next) => {
            this.states.set(actorId, next);
            ctx.state = next;
          },
          send: (recipientId, type, payload, priority = "normal") => {
            this.enqueueMessage({
              senderId: actorId,
              recipientId,
              type,
              payload,
              priority
            });
          }
        };

        try {
          await spec.onMessage(msg, ctx);
          this.processedTrace.push({
            actorId,
            messageId: msg.messageId,
            type: msg.type,
            outcome: "ok"
          });
        } catch (err) {
          const directive = spec.supervisionStrategy ?? "restart";
          if (directive === "restart") {
            this.states.set(actorId, spec.initialState());
            this.processedTrace.push({
              actorId,
              messageId: msg.messageId,
              type: msg.type,
              outcome: "restarted"
            });
          } else if (directive === "resume") {
            this.processedTrace.push({
              actorId,
              messageId: msg.messageId,
              type: msg.type,
              outcome: "resumed"
            });
          } else if (directive === "stop") {
            this.stoppedActors.add(actorId);
            this.processedTrace.push({
              actorId,
              messageId: msg.messageId,
              type: msg.type,
              outcome: "stopped"
            });
          } else {
            throw err;
          }
        }
      }

      if (!dispatchedInRound) break;
    }

    return {
      processedCount,
      deadLetterCount: this.deadLetters.length
    };
  }

  public getActorState<TState>(actorId: string): TState | undefined {
    return this.states.get(actorId) as TState | undefined;
  }

  public getDeadLetters(): ReadonlyArray<DeadLetterEntry> {
    return [...this.deadLetters];
  }

  public getTrace(): ReadonlyArray<{
    actorId: string;
    messageId: string;
    type: string;
    outcome: string;
  }> {
    return [...this.processedTrace];
  }
}
