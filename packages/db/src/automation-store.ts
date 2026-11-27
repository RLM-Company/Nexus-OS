import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  automationOccurrenceKey,
  eventDedupeKey,
  type AutomationTrigger,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationEvent,
  type AutomationExternalAction,
  type CreateAutomationTrigger,
  type AutomationRunControl
} from "@cosmora/contracts";
import { automationTransaction } from "./project-automation-store.js";

export class AutomationRunError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type TriggerRow = {
  id: string;
  owner_id: string;
  project_id: string;
  workflow_id: string;
  definition_version: number;
  kind: AutomationTrigger["kind"];
  inputs_json: string;
  schedule_json: string | null;
  event_json: string | null;
  event_key: string | null;
  status: AutomationTrigger["status"];
  version: number;
  client_request_id: string;
  created_at: string;
  updated_at: string;
};
type RunRow = {
  id: string;
  trigger_id: string;
  owner_id: string;
  project_id: string;
  workflow_id: string;
  definition_version: number;
  dag_id: string | null;
  occurrence_key: string;
  event_key: string | null;
  kind: AutomationRun["kind"];
  status: AutomationRunStatus;
  node_id: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt: number;
  error_code: string | null;
  error_reason: string | null;
  confirmation_id: string | null;
  external_action_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
type EventRow = {
  id: string;
  run_id: string;
  owner_id: string;
  at: string;
  kind: string;
  reason: string;
  actor: string;
};
type ActionRow = {
  id: string;
  owner_id: string;
  run_id: string;
  trigger_id: string;
  connector: string;
  operation: string;
  operation_key: string;
  status: AutomationExternalAction["status"];
  confirmation_id: string | null;
  created_at: string;
  updated_at: string;
};

const triggerView = (row: TriggerRow): AutomationTrigger =>
  ({
    id: row.id,
    owner_id: row.owner_id,
    project_id: row.project_id,
    workflow_id: row.workflow_id,
    definition_version: row.definition_version,
    kind: row.kind,
    inputs: JSON.parse(row.inputs_json) as AutomationTrigger["inputs"],
    ...(row.schedule_json ? { schedule: JSON.parse(row.schedule_json) } : {}),
    ...(row.event_json ? { event: JSON.parse(row.event_json) } : {}),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version
  }) as AutomationTrigger;
const runView = (row: RunRow): AutomationRun => ({
  id: row.id,
  trigger_id: row.trigger_id,
  owner_id: row.owner_id,
  project_id: row.project_id,
  workflow_id: row.workflow_id,
  definition_version: row.definition_version,
  ...(row.dag_id ? { dag_id: row.dag_id } : {}),
  occurrence_key: row.occurrence_key,
  ...(row.event_key ? { event_key: row.event_key } : {}),
  kind: row.kind,
  status: row.status,
  ...(row.node_id ? { node_id: row.node_id } : {}),
  ...(row.lease_owner ? { lease_owner: row.lease_owner } : {}),
  ...(row.lease_expires_at ? { lease_expires_at: row.lease_expires_at } : {}),
  attempt: row.attempt,
  ...(row.error_code ? { error_code: row.error_code } : {}),
  ...(row.error_reason ? { error_reason: row.error_reason } : {}),
  ...(row.confirmation_id ? { confirmation_id: row.confirmation_id } : {}),
  ...(row.external_action_id ? { external_action_id: row.external_action_id } : {}),
  created_at: row.created_at,
  updated_at: row.updated_at,
  version: row.version
});
const actionView = (row: ActionRow): AutomationExternalAction => ({
  id: row.id,
  owner_id: row.owner_id,
  run_id: row.run_id,
  trigger_id: row.trigger_id,
  connector: row.connector,
  operation: row.operation,
  operation_key: row.operation_key,
  status: row.status,
  ...(row.confirmation_id ? { confirmation_id: row.confirmation_id } : {}),
  created_at: row.created_at,
  updated_at: row.updated_at
});

/** Automation persistence. Every write is owner/project scoped, versioned (CAS)
 * and fenced by the same data-lifecycle predicates as WorkflowStore. */
export class AutomationStore {
  constructor(
    private readonly sql: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  private assertWritable(owner: string, project: string): void {
    if (
      !this.sql
        .prepare(
          "SELECT 1 FROM projects WHERE id=? AND owner_id=? AND status IN ('DRAFT','ACTIVE')"
        )
        .get(project, owner)
    )
      throw new AutomationRunError("PROJECT_NOT_FOUND");
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner) ||
      this.sql.prepare("SELECT 1 FROM work_owner_fences WHERE owner_id=? AND fenced=1").get(owner)
    )
      throw new AutomationRunError("OWNER_DATA_FENCED");
  }

  createTrigger(
    owner: string,
    project: string,
    actor: string,
    input: CreateAutomationTrigger
  ): AutomationTrigger {
    return automationTransaction(this.sql, () => {
      this.assertWritable(owner, project);
      const previous = this.sql
        .prepare(
          "SELECT * FROM automation_triggers WHERE owner_id=? AND client_request_id=?"
        )
        .get(owner, input.client_request_id) as TriggerRow | undefined;
      const eventKey = input.event
        ? eventDedupeKey(input.event.source, input.event.event_id)
        : null;
      if (previous) {
        const same =
          previous.project_id === project &&
          previous.workflow_id === input.workflow_id &&
          previous.definition_version === input.definition_version &&
          previous.kind === input.kind &&
          previous.inputs_json === JSON.stringify(input.inputs) &&
          previous.event_key === eventKey &&
          (previous.schedule_json ?? null) === (input.schedule ? JSON.stringify(input.schedule) : null);
        if (!same) throw new AutomationRunError("IDEMPOTENCY_CONFLICT");
        return triggerView(previous);
      }
      // One event identity per owner: a repeated connector event returns the
      // existing trigger and never creates a second run.
      if (eventKey) {
        const byEvent = this.sql
          .prepare("SELECT * FROM automation_triggers WHERE owner_id=? AND event_key=?")
          .get(owner, eventKey) as TriggerRow | undefined;
        if (byEvent) return triggerView(byEvent);
      }
      const id = randomUUID(),
        at = this.now();
      this.sql
        .prepare(
          `INSERT INTO automation_triggers
           (id,owner_id,project_id,workflow_id,definition_version,kind,inputs_json,schedule_json,event_json,event_key,status,version,client_request_id,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          owner,
          project,
          input.workflow_id,
          input.definition_version,
          input.kind,
          JSON.stringify(input.inputs),
          input.schedule ? JSON.stringify(input.schedule) : null,
          input.event ? JSON.stringify(input.event) : null,
          eventKey,
          "enabled",
          1,
          input.client_request_id,
          at,
          at
        );
      void actor;
      return this.getTrigger(owner, id)!;
    });
  }

  getTrigger(owner: string, id: string): AutomationTrigger | null {
    const row = this.sql
      .prepare("SELECT * FROM automation_triggers WHERE id=? AND owner_id=?")
      .get(id, owner) as TriggerRow | undefined;
    return row ? triggerView(row) : null;
  }

  listTriggers(
    owner: string,
    project?: string,
    workflowId?: string
  ): AutomationTrigger[] {
    const rows = this.sql
      .prepare(
        `SELECT * FROM automation_triggers
         WHERE owner_id=? AND (? IS NULL OR project_id=?) AND (? IS NULL OR workflow_id=?)
         ORDER BY updated_at DESC, id LIMIT 200`
      )
      .all(owner, project ?? null, project ?? null, workflowId ?? null, workflowId ?? null) as TriggerRow[];
    return rows.map(triggerView);
  }

  controlTrigger(
    owner: string,
    project: string,
    id: string,
    expectedVersion: number,
    status: AutomationTrigger["status"]
  ): AutomationTrigger {
    return automationTransaction(this.sql, () => {
      this.assertWritable(owner, project);
      const current = this.getTrigger(owner, id);
      if (!current || current.project_id !== project)
        throw new AutomationRunError("TRIGGER_NOT_FOUND");
      if (current.version !== expectedVersion)
        throw new AutomationRunError("STALE_TRIGGER");
      const result = this.sql
        .prepare(
          `UPDATE automation_triggers SET status=?, version=?, updated_at=?
           WHERE id=? AND owner_id=? AND version=?`
        )
        .run(status, expectedVersion + 1, this.now(), id, owner, expectedVersion);
      if (!result.changes) throw new AutomationRunError("STALE_TRIGGER");
      return this.getTrigger(owner, id)!;
    });
  }

  /** Create-or-return one run per trigger occurrence; the occurrence key is
   * globally unique per owner, so replayed events/schedule ticks cannot double-execute. */
  enqueue(
    owner: string,
    project: string,
    trigger: AutomationTrigger,
    actor: string,
    options: { eventKey?: string; dueAt?: string; confirmationRequired?: boolean } = {}
  ): AutomationRun {
    return automationTransaction(this.sql, () => {
      this.assertWritable(owner, project);
      if (trigger.status !== "enabled") throw new AutomationRunError("TRIGGER_DISABLED");
      const occurrenceKey = automationOccurrenceKey({
        triggerId: trigger.id,
        kind: trigger.kind,
        ...(options.dueAt !== undefined ? { dueAt: options.dueAt } : {}),
        ...(trigger.event?.source !== undefined ? { source: trigger.event.source } : {}),
        ...(trigger.event?.event_id !== undefined ? { eventId: trigger.event.event_id } : {})
      });
      const existing = this.sql
        .prepare("SELECT * FROM automation_runs WHERE owner_id=? AND occurrence_key=?")
        .get(owner, occurrenceKey) as RunRow | undefined;
      if (existing) return runView(existing);
      const id = randomUUID(),
        at = this.now();
      this.sql
        .prepare(
          `INSERT INTO automation_runs
           (id,trigger_id,owner_id,project_id,workflow_id,definition_version,dag_id,occurrence_key,event_key,kind,status,node_id,lease_owner,lease_expires_at,attempt,error_code,error_reason,confirmation_id,external_action_id,version,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          trigger.id,
          owner,
          project,
          trigger.workflow_id,
          trigger.definition_version,
          null,
          occurrenceKey,
          options.eventKey ?? null,
          trigger.kind,
          options.confirmationRequired ? "awaiting_confirmation" : "queued",
          null,
          null,
          null,
          0,
          null,
          null,
          null,
          null,
          1,
          at,
          at
        );
      this.recordEvent(id, owner, "queued", `Occurrence ${occurrenceKey}`, actor);
      return this.getRun(owner, id)!;
    });
  }

  getRun(owner: string, id: string): AutomationRun | null {
    const row = this.sql
      .prepare("SELECT * FROM automation_runs WHERE id=? AND owner_id=?")
      .get(id, owner) as RunRow | undefined;
    return row ? runView(row) : null;
  }

  listRuns(owner: string, project?: string, triggerId?: string): AutomationRun[] {
    const rows = this.sql
      .prepare(
        `SELECT * FROM automation_runs
         WHERE owner_id=? AND (? IS NULL OR project_id=?) AND (? IS NULL OR trigger_id=?)
         ORDER BY created_at DESC, id LIMIT 200`
      )
      .all(owner, project ?? null, project ?? null, triggerId ?? null, triggerId ?? null) as RunRow[];
    return rows.map(runView);
  }

  /** Lease claim. Only one server process can own a queued run until the lease expires. */
  claim(owner: string, id: string, leaseOwner: string, leaseMs: number, actor: string): AutomationRun | null {
    return automationTransaction(this.sql, () => {
      this.assertWritable(owner, this.runProject(owner, id));
      const current = this.getRun(owner, id);
      if (!current || current.status !== "queued") return null;
      const until = new Date(Date.parse(this.now()) + leaseMs).toISOString();
      const result = this.sql
        .prepare(
          `UPDATE automation_runs SET status='claimed', lease_owner=?, lease_expires_at=?,
           attempt=attempt+1, version=version+1, updated_at=?
           WHERE id=? AND owner_id=? AND version=? AND status='queued'`
        )
        .run(leaseOwner, until, this.now(), id, owner, current.version);
      if (!result.changes) return null;
      this.recordEvent(id, owner, "claimed", `Lease ${leaseOwner} until ${until}`, actor);
      return this.getRun(owner, id)!;
    });
  }

  private runProject(owner: string, id: string): string {
    const row = this.sql
      .prepare("SELECT project_id FROM automation_runs WHERE id=? AND owner_id=?")
      .get(id, owner) as { project_id: string } | undefined;
    if (!row) throw new AutomationRunError("RUN_NOT_FOUND");
    return row.project_id;
  }

  /** Reconcile leases after restart: only claimed/running runs with an expired
   * lease become queued again; external actions remain untouched. */
  recoverExpiredLeases(owner: string, actor = "system"): AutomationRun[] {
    return automationTransaction(this.sql, () => {
      const now = this.now();
      const rows = this.sql
        .prepare(
          `SELECT * FROM automation_runs WHERE owner_id=? AND status IN ('claimed','running')
           AND (lease_expires_at IS NULL OR lease_expires_at<=?)`
        )
        .all(owner, now) as RunRow[];
      const recovered: AutomationRun[] = [];
      for (const row of rows) {
        const result = this.sql
          .prepare(
            `UPDATE automation_runs SET status='queued', lease_owner=NULL, lease_expires_at=NULL,
             version=version+1, updated_at=? WHERE id=? AND owner_id=? AND version=?`
          )
          .run(now, row.id, owner, row.version);
        if (result.changes) {
          this.recordEvent(row.id, owner, "lease_expired", "Lease expired; queued for recovery", actor);
          recovered.push(this.getRun(owner, row.id)!);
        }
      }
      return recovered;
    });
  }

  /** CAS state transition with optional reason/error. */
  transition(
    owner: string,
    id: string,
    expectedVersion: number,
    next: {
      status: AutomationRunStatus;
      reason?: string;
      errorCode?: string;
      errorReason?: string;
      dagId?: string | null;
      nodeId?: string | null;
      leaseOwner?: string | null;
      leaseExpiresAt?: string | null;
      confirmationId?: string | null;
      externalActionId?: string | null;
      actor?: string;
    }
  ): AutomationRun {
    return automationTransaction(this.sql, () => {
      const current = this.getRun(owner, id);
      if (!current) throw new AutomationRunError("RUN_NOT_FOUND");
      this.assertWritable(owner, current.project_id);
      const result = this.sql
        .prepare(
          `UPDATE automation_runs SET status=?, version=version+1, updated_at=?,
           error_code=?, error_reason=?, dag_id=?, node_id=?, lease_owner=?, lease_expires_at=?,
           confirmation_id=?, external_action_id=?
           WHERE id=? AND owner_id=? AND version=?`
        )
        .run(
          next.status,
          this.now(),
          next.errorCode ?? null,
          next.errorReason ?? null,
          (next.dagId === undefined ? current.dag_id : next.dagId) ?? null,
          (next.nodeId === undefined ? current.node_id : next.nodeId) ?? null,
          (next.leaseOwner === undefined ? current.lease_owner : next.leaseOwner) ?? null,
          (next.leaseExpiresAt === undefined ? current.lease_expires_at : next.leaseExpiresAt) ?? null,
          (next.confirmationId === undefined ? current.confirmation_id : next.confirmationId) ?? null,
          (next.externalActionId === undefined ? current.external_action_id : next.externalActionId) ?? null,
          id,
          owner,
          expectedVersion
        );
      if (!result.changes) throw new AutomationRunError("STALE_RUN");
      this.recordEvent(
        id,
        owner,
        next.status,
        next.reason ?? next.errorReason ?? "Transition",
        next.actor ?? "system"
      );
      return this.getRun(owner, id)!;
    });
  }

  recordEvent(runId: string, owner: string, kind: string, reason: string, actor: string): AutomationEvent {
    const id = randomUUID(),
      at = this.now();
    this.sql
      .prepare(
        "INSERT INTO automation_events(id,run_id,owner_id,at,kind,reason,actor) VALUES(?,?,?,?,?,?,?)"
      )
      .run(id, runId, owner, at, kind, reason.slice(0, 500), actor.slice(0, 128));
    return { id, run_id: runId, owner_id: owner, at, kind, reason: reason.slice(0, 500), actor };
  }

  events(owner: string, runId: string): AutomationEvent[] {
    if (!this.getRun(owner, runId)) throw new AutomationRunError("RUN_NOT_FOUND");
    return (
      this.sql
        .prepare(
          "SELECT * FROM automation_events WHERE run_id=? AND owner_id=? ORDER BY at, id LIMIT 500"
        )
        .all(runId, owner) as EventRow[]
    ).map((row) => ({
      id: row.id,
      run_id: row.run_id,
      owner_id: row.owner_id,
      at: row.at,
      kind: row.kind,
      reason: row.reason,
      actor: row.actor
    }));
  }

  /** Create a pending external action. Retry always reuses the same operation_key. */
  externalAction(input: {
    owner: string;
    runId: string;
    triggerId: string;
    connector: string;
    operation: string;
    operationKey: string;
    confirmationId?: string;
  }): AutomationExternalAction {
    return automationTransaction(this.sql, () => {
      const existing = this.sql
        .prepare("SELECT * FROM automation_external_actions WHERE owner_id=? AND operation_key=?")
        .get(input.owner, input.operationKey) as ActionRow | undefined;
      if (existing) return actionView(existing);
      const id = randomUUID(),
        at = this.now();
      this.sql
        .prepare(
          `INSERT INTO automation_external_actions
           (id,owner_id,run_id,trigger_id,connector,operation,operation_key,status,confirmation_id,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          input.owner,
          input.runId,
          input.triggerId,
          input.connector,
          input.operation,
          input.operationKey,
          "pending",
          input.confirmationId ?? null,
          at,
          at
        );
      return this.getExternalAction(input.owner, id)!;
    });
  }

  getExternalAction(owner: string, id: string): AutomationExternalAction | null {
    const row = this.sql
      .prepare("SELECT * FROM automation_external_actions WHERE id=? AND owner_id=?")
      .get(id, owner) as ActionRow | undefined;
    return row ? actionView(row) : null;
  }

  externalActionByKey(owner: string, operationKey: string): AutomationExternalAction | null {
    const row = this.sql
      .prepare("SELECT * FROM automation_external_actions WHERE owner_id=? AND operation_key=?")
      .get(owner, operationKey) as ActionRow | undefined;
    return row ? actionView(row) : null;
  }

  /** Mark unknown only after a real attempt with an unconfirmed result.
   * Never silently flips to verified or retries. */
  markExternalUnknown(owner: string, id: string, actor = "system"): AutomationExternalAction {
    return automationTransaction(this.sql, () => {
      const current = this.getExternalAction(owner, id);
      if (!current || current.status === "verified")
        throw new AutomationRunError("EXTERNAL_ACTION_NOT_FOUND");
      const result = this.sql
        .prepare(
          "UPDATE automation_external_actions SET status='unknown', updated_at=? WHERE id=? AND owner_id=? AND status IN ('pending','unknown')"
        )
        .run(this.now(), id, owner);
      if (!result.changes) throw new AutomationRunError("EXTERNAL_ACTION_TERMINAL");
      const run = this.getRun(owner, current.run_id);
      if (run && run.external_action_id === id && run.status !== "cancelled")
        this.transition(owner, run.id, run.version, {
          status: "unknown_external",
          reason: "External result unknown; verification required before any retry",
          externalActionId: id,
          actor
        });
      return this.getExternalAction(owner, id)!;
    });
  }

  /** Verification is supplied by the connector after a real check. */
  verifyExternal(
    owner: string,
    id: string,
    verified: boolean,
    actor: string
  ): AutomationExternalAction {
    return automationTransaction(this.sql, () => {
      const current = this.getExternalAction(owner, id);
      if (!current || !["pending", "unknown"].includes(current.status))
        throw new AutomationRunError("EXTERNAL_ACTION_TERMINAL");
      const status = verified ? "verified" : "failed";
      this.sql
        .prepare("UPDATE automation_external_actions SET status=?, updated_at=? WHERE id=? AND owner_id=?")
        .run(status, this.now(), id, owner);
      const run = this.getRun(owner, current.run_id);
      if (run && run.status === "unknown_external")
        this.transition(owner, run.id, run.version, {
          status: verified ? "succeeded" : "failed",
          reason: verified ? "External result verified" : "External result confirmed failed",
          ...(verified ? {} : { errorCode: "EXTERNAL_ACTION_FAILED" }),
          actor
        });
      return this.getExternalAction(owner, id)!;
    });
  }

  /** Persist an advanced schedule due date without touching status. */
  updateScheduleDue(owner: string, id: string, expectedVersion: number, nextDueAt: string): AutomationTrigger {
    return automationTransaction(this.sql, () => {
      const current = this.getTrigger(owner, id);
      if (!current || !current.schedule) throw new AutomationRunError("TRIGGER_NOT_FOUND");
      if (current.version !== expectedVersion) throw new AutomationRunError("STALE_TRIGGER");
      const schedule = { ...current.schedule, due_at: nextDueAt };
      const result = this.sql
        .prepare(
          "UPDATE automation_triggers SET schedule_json=?, version=version+1, updated_at=? WHERE id=? AND owner_id=? AND version=?"
        )
        .run(JSON.stringify(schedule), this.now(), id, owner, expectedVersion);
      if (!result.changes) throw new AutomationRunError("STALE_TRIGGER");
      return this.getTrigger(owner, id)!;
    });
  }

  /** Convenience: apply a simple run control with CAS. */
  controlRun(owner: string, id: string, input: AutomationRunControl, actor: string): AutomationRun {
    const current = this.getRun(owner, id);
    if (!current) throw new AutomationRunError("RUN_NOT_FOUND");
    if (current.version !== input.expected_version)
      throw new AutomationRunError("STALE_RUN");
    const status: Record<string, AutomationRunStatus> = {
      run: "queued",
      pause: "queued",
      resume: "queued",
      cancel: "cancelled",
      confirm: "queued",
      verify_external: current.status
    };
    if (input.action === "verify_external" && current.external_action_id) {
      if (input.verified === undefined)
        throw new AutomationRunError("EXTERNAL_VERIFICATION_REQUIRED");
      this.verifyExternal(owner, current.external_action_id, input.verified, actor);
      return this.getRun(owner, id)!;
    }
    const next = status[input.action];
    if (!next) throw new AutomationRunError("INVALID_ACTION");
    if (input.action === "confirm" && current.status !== "awaiting_confirmation")
      throw new AutomationRunError("NOT_AWAITING_CONFIRMATION");
    if (input.action !== "confirm" && input.action !== "cancel" && current.status === "cancelled")
      throw new AutomationRunError("RUN_CANCELLED");
    return this.transition(owner, id, current.version, {
      status: next,
      reason: input.reason ?? `Control ${input.action}`,
      actor
    });
  }
}
