import { DatabaseSync } from "node:sqlite";

export interface SagaStepDefinition<TContext> {
  stepId: string;
  outboxTopic: string;
  forwardAction: (ctx: TContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
  compensateAction: (ctx: TContext) => Promise<void> | void;
}

export interface SagaExecutionReport {
  sagaId: string;
  ownerId: string;
  workflowName: string;
  status: "succeeded" | "compensated_rolled_back";
  completedSteps: string[];
  compensatedSteps: string[];
  outboxEventsCount: number;
  failureReason: string | null;
}

/**
 * Transactional Outbox & Compensating Saga Orchestrator.
 * Executes distributed multi-step workflows with durable SQLite outbox logging
 * and automatic LIFO reverse compensating rollbacks when any intermediate step fails.
 */
export class SagaAndTransactionalOutboxEngine {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTables();
  }

  private ensureTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_saga_executions (
        saga_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_steps_json TEXT NOT NULL,
        compensated_steps_json TEXT NOT NULL,
        failure_reason TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kosmora_transactional_outbox (
        event_id TEXT PRIMARY KEY NOT NULL,
        saga_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        dispatched INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
  }

  public async executeSaga<TContext>(params: {
    sagaId: string;
    ownerId: string;
    workflowName: string;
    context: TContext;
    steps: SagaStepDefinition<TContext>[];
  }): Promise<SagaExecutionReport> {
    const completedSteps: SagaStepDefinition<TContext>[] = [];
    const compensatedStepIds: string[] = [];
    let failureReason: string | null = null;
    let outboxSeq = 0;

    for (const step of params.steps) {
      try {
        const payload = await step.forwardAction(params.context);
        completedSteps.push(step);

        const eventId = `outbox_${params.sagaId}_${++outboxSeq}`;
        this.sqlite
          .prepare(
            `INSERT INTO kosmora_transactional_outbox
              (event_id, saga_id, owner_id, topic, payload_json, dispatched, created_at)
             VALUES (?, ?, ?, ?, ?, 0, ?)`
          )
          .run(
            eventId,
            params.sagaId,
            params.ownerId,
            step.outboxTopic,
            JSON.stringify(payload),
            new Date().toISOString()
          );
      } catch (err) {
        failureReason = err instanceof Error ? err.message : String(err);

        // Execute compensating actions in strict reverse LIFO order
        for (let i = completedSteps.length - 1; i >= 0; i--) {
          const prevStep = completedSteps[i]!;
          await prevStep.compensateAction(params.context);
          compensatedStepIds.push(prevStep.stepId);

          const compEventId = `outbox_${params.sagaId}_comp_${++outboxSeq}`;
          this.sqlite
            .prepare(
              `INSERT INTO kosmora_transactional_outbox
                (event_id, saga_id, owner_id, topic, payload_json, dispatched, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)`
            )
            .run(
              compEventId,
              params.sagaId,
              params.ownerId,
              `${prevStep.outboxTopic}.compensated`,
              JSON.stringify({ stepId: prevStep.stepId, rolledBackDueTo: failureReason }),
              new Date().toISOString()
            );
        }
        break;
      }
    }

    const status: SagaExecutionReport["status"] =
      failureReason === null ? "succeeded" : "compensated_rolled_back";

    const completedIds = completedSteps.map((s) => s.stepId);
    const nowIso = new Date().toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_saga_executions
          (saga_id, owner_id, workflow_name, status, completed_steps_json, compensated_steps_json, failure_reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(saga_id) DO UPDATE SET
          status = excluded.status,
          completed_steps_json = excluded.completed_steps_json,
          compensated_steps_json = excluded.compensated_steps_json,
          failure_reason = excluded.failure_reason,
          updated_at = excluded.updated_at`
      )
      .run(
        params.sagaId,
        params.ownerId,
        params.workflowName,
        status,
        JSON.stringify(completedIds),
        JSON.stringify(compensatedStepIds),
        failureReason,
        nowIso
      );

    return {
      sagaId: params.sagaId,
      ownerId: params.ownerId,
      workflowName: params.workflowName,
      status,
      completedSteps: completedIds,
      compensatedSteps: compensatedStepIds,
      outboxEventsCount: outboxSeq,
      failureReason
    };
  }

  public fetchPendingOutboxEvents(ownerId: string): Array<{
    eventId: string;
    sagaId: string;
    topic: string;
    payload: Record<string, unknown>;
  }> {
    const rows = this.sqlite
      .prepare(
        `SELECT event_id, saga_id, topic, payload_json
         FROM kosmora_transactional_outbox
         WHERE owner_id = ? AND dispatched = 0
         ORDER BY event_id ASC`
      )
      .all(ownerId) as Array<{
      event_id: string;
      saga_id: string;
      topic: string;
      payload_json: string;
    }>;

    return rows.map((r) => ({
      eventId: r.event_id,
      sagaId: r.saga_id,
      topic: r.topic,
      payload: JSON.parse(r.payload_json)
    }));
  }
}
