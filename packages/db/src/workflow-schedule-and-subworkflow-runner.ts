import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const MAX_WORKFLOW_DEFINITION_BYTES = 64000;
export const MAX_WORKFLOW_STEPS = 32;
export const MAX_WORKFLOW_PARAMS = 32;
export const MAX_SUBWORKFLOW_DEPTH = 3;

export type WorkflowStepKind =
  | "work_prompt"
  | "critic_review"
  | "sub_workflow"
  | "browser_action"
  | "computer_control";

export interface WorkflowParameterDef {
  name: string;
  type: "text" | "number" | "boolean" | "select" | "project_document" | "url";
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface WorkflowNodeDef {
  id: string;
  title: string;
  kind: WorkflowStepKind;
  dependsOn?: string[];
  promptTemplate?: string;
  subWorkflowId?: string;
  subWorkflowVersion?: number;
  browserUrlTemplate?: string;
  computerTargetApp?: string;
}

export interface WorkflowDefinitionPayload {
  name: string;
  description: string;
  parameters: WorkflowParameterDef[];
  nodes: WorkflowNodeDef[];
}

export interface FlattenedWorkflowPlan {
  rootWorkflowId: string;
  rootVersion: number;
  flattenedNodes: Array<{
    id: string;
    title: string;
    kind: Exclude<WorkflowStepKind, "sub_workflow">;
    dependsOn: string[];
    interpolatedPrompt: string;
    requiresStepUpConsent: boolean;
    sourceWorkflowId: string;
  }>;
  requiresDesktopOrBrowserConsent: boolean;
  totalSerializedBytes: number;
}

export interface ScheduledWorkflowRecord {
  scheduleId: string;
  workflowId: string;
  workflowVersion: number;
  projectId: string;
  ownerId: string;
  cronOrInterval: string;
  inputs: Record<string, unknown>;
  enabled: boolean;
  lastSlotIso: string | null;
  createdAt: string;
}

function interpolateTemplate(template: string, inputs: Record<string, unknown>): string {
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = inputs[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

/**
 * Extends PR #428 (`0062_reusable_workflows.sql`, `KOSWORK_REUSABLE_WORKFLOWS_2026-11-02_RU.md`)
 * with the remaining roadmap capabilities:
 * 1. Bounded Sub-Workflow Composition with Cycle Detection (`WORKFLOW_RECURSION_CYCLE_DETECTED`)
 *    and max depth (`<= 3`) + combined `<= 32` step / `<= 64 000` UTF-8 byte enforcement.
 * 2. Browser & Computer-Control step validation with mandatory owner step-up consent gating.
 * 3. Idempotent Scheduled Workflow Trigger Store (`kosmora_workflow_schedules`) bound to
 *    `kosmora_workflow_runs` via deterministic `client_request_id`.
 */
export class WorkflowScheduleAndSubworkflowRunner {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_workflow_definitions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        state_json TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        client_creation_id TEXT,
        creation_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS kosmora_workflow_def_client_idx
        ON kosmora_workflow_definitions(owner_id, project_id, client_creation_id)
        WHERE client_creation_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS kosmora_workflow_versions (
        workflow_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, version)
      );

      CREATE TABLE IF NOT EXISTS kosmora_workflow_runs (
        id TEXT PRIMARY KEY NOT NULL,
        workflow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        client_request_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        definition_version INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        dag_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (owner_id, project_id, client_request_id)
      );

      CREATE TABLE IF NOT EXISTS kosmora_workflow_schedules (
        schedule_id TEXT PRIMARY KEY NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        cron_or_interval TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_slot_iso TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  saveWorkflowVersion(options: {
    workflowId: string;
    projectId: string;
    ownerId: string;
    version: number;
    definition: WorkflowDefinitionPayload;
    clientCreationId?: string;
  }): void {
    const defJson = JSON.stringify(options.definition);
    const bytes = Buffer.byteLength(defJson, "utf8");
    if (bytes > MAX_WORKFLOW_DEFINITION_BYTES) {
      throw new Error("WORKFLOW_DEFINITION_BYTES_EXCEEDED");
    }
    if (
      options.definition.parameters.length > MAX_WORKFLOW_PARAMS ||
      options.definition.nodes.length === 0 ||
      options.definition.nodes.length > MAX_WORKFLOW_STEPS
    ) {
      throw new Error("WORKFLOW_STEP_OR_PARAM_LIMIT_EXCEEDED");
    }

    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_workflow_definitions (
          id, project_id, owner_id, version, state_json, archived_at,
          created_at, updated_at, client_creation_id, creation_json
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          version = excluded.version,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`
      )
      .run(
        options.workflowId,
        options.projectId,
        options.ownerId,
        options.version,
        defJson,
        now,
        now,
        options.clientCreationId ?? null,
        defJson
      );

    this.sqlite
      .prepare(
        `INSERT OR REPLACE INTO kosmora_workflow_versions (
          workflow_id, version, definition_json, created_at
        ) VALUES (?, ?, ?, ?)`
      )
      .run(options.workflowId, options.version, defJson, now);
  }

  /**
   * Expands any `sub_workflow` nodes recursively (up to depth 3), detecting cycles
   * (`A -> B -> A` or self-recursion `A -> A`) and enforcing the global 32-step and 64 KB limits.
   */
  resolveAndInlineSubWorkflows(options: {
    ownerId: string;
    projectId: string;
    workflowId: string;
    version: number;
    inputs: Record<string, unknown>;
    desktopOrBrowserConsentToken?: string | null;
  }): FlattenedWorkflowPlan {
    const flattenedNodes: FlattenedWorkflowPlan["flattenedNodes"] = [];
    let requiresDesktopOrBrowserConsent = false;

    const expand = (
      currentWorkflowId: string,
      currentVersion: number,
      prefix: string,
      ancestry: Set<string>,
      depth: number
    ) => {
      if (ancestry.has(currentWorkflowId)) {
        throw new Error(`WORKFLOW_RECURSION_CYCLE_DETECTED:${currentWorkflowId}`);
      }
      if (depth > MAX_SUBWORKFLOW_DEPTH) {
        throw new Error("WORKFLOW_MAX_SUBWORKFLOW_DEPTH_EXCEEDED");
      }

      const defRow = this.sqlite
        .prepare(
          `SELECT d.owner_id, d.project_id, d.archived_at, v.definition_json
           FROM kosmora_workflow_definitions d
           JOIN kosmora_workflow_versions v ON v.workflow_id = d.id AND v.version = ?
           WHERE d.id = ?`
        )
        .get(currentVersion, currentWorkflowId) as
        | {
            owner_id: string;
            project_id: string;
            archived_at: string | null;
            definition_json: string;
          }
        | undefined;

      if (!defRow || defRow.owner_id !== options.ownerId || defRow.project_id !== options.projectId) {
        throw new Error(`WORKFLOW_NOT_FOUND_OR_FORBIDDEN:${currentWorkflowId}`);
      }
      if (defRow.archived_at) {
        throw new Error(`WORKFLOW_ARCHIVED:${currentWorkflowId}`);
      }

      const def = JSON.parse(defRow.definition_json) as WorkflowDefinitionPayload;
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(currentWorkflowId);

      for (const node of def.nodes) {
        const scopedId = prefix ? `${prefix}.${node.id}` : node.id;
        const scopedDeps = (node.dependsOn ?? []).map((d) => (prefix ? `${prefix}.${d}` : d));

        if (node.kind === "sub_workflow") {
          if (!node.subWorkflowId) {
            throw new Error(`SUBWORKFLOW_ID_MISSING:${scopedId}`);
          }
          expand(
            node.subWorkflowId,
            node.subWorkflowVersion ?? 1,
            scopedId,
            nextAncestry,
            depth + 1
          );
          continue;
        }

        const isDesktopOrBrowser =
          node.kind === "browser_action" || node.kind === "computer_control";
        if (isDesktopOrBrowser) {
          requiresDesktopOrBrowserConsent = true;
        }

        const interpolatedPrompt = interpolateTemplate(
          node.promptTemplate ?? node.browserUrlTemplate ?? node.title,
          options.inputs
        );

        flattenedNodes.push({
          id: scopedId,
          title: node.title,
          kind: node.kind,
          dependsOn: scopedDeps,
          interpolatedPrompt,
          requiresStepUpConsent: isDesktopOrBrowser,
          sourceWorkflowId: currentWorkflowId
        });

        if (flattenedNodes.length > MAX_WORKFLOW_STEPS) {
          throw new Error("FLATTENED_WORKFLOW_EXCEEDS_32_STEPS");
        }
      }
    };

    expand(options.workflowId, options.version, "", new Set(), 0);

    if (
      requiresDesktopOrBrowserConsent &&
      (!options.desktopOrBrowserConsentToken || !options.desktopOrBrowserConsentToken.trim())
    ) {
      throw new Error("WORKFLOW_DESKTOP_OR_BROWSER_CONSENT_REQUIRED");
    }

    const totalSerializedBytes = Buffer.byteLength(JSON.stringify(flattenedNodes), "utf8");
    if (totalSerializedBytes > MAX_WORKFLOW_DEFINITION_BYTES) {
      throw new Error("FLATTENED_WORKFLOW_BYTES_EXCEEDED");
    }

    return {
      rootWorkflowId: options.workflowId,
      rootVersion: options.version,
      flattenedNodes,
      requiresDesktopOrBrowserConsent,
      totalSerializedBytes
    };
  }

  createSchedule(input: {
    scheduleId?: string;
    workflowId: string;
    workflowVersion: number;
    projectId: string;
    ownerId: string;
    cronOrInterval: string;
    inputs: Record<string, unknown>;
  }): ScheduledWorkflowRecord {
    const scheduleId = input.scheduleId ?? `wf-sched-${randomUUID()}`;
    const now = new Date().toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_workflow_schedules (
          schedule_id, workflow_id, workflow_version, project_id, owner_id,
          cron_or_interval, inputs_json, enabled, last_slot_iso, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`
      )
      .run(
        scheduleId,
        input.workflowId,
        input.workflowVersion,
        input.projectId,
        input.ownerId,
        input.cronOrInterval,
        JSON.stringify(input.inputs ?? {}),
        now,
        now
      );

    return {
      scheduleId,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      projectId: input.projectId,
      ownerId: input.ownerId,
      cronOrInterval: input.cronOrInterval,
      inputs: input.inputs ?? {},
      enabled: true,
      lastSlotIso: null,
      createdAt: now
    };
  }

  /**
   * Executes a scheduled tick idempotently using `client_request_id = "schedule:<scheduleId>:<slotIso>"`
   * so duplicate timer ticks or network retries never create duplicate `kosmora_workflow_runs`.
   */
  triggerScheduledTick(options: {
    scheduleId: string;
    ownerId: string;
    slotIso: string;
    desktopOrBrowserConsentToken?: string | null;
  }): { runId: string; dagId: string; deduplicated: boolean; flattenedStepCount: number } {
    const sched = this.sqlite
      .prepare(
        "SELECT * FROM kosmora_workflow_schedules WHERE schedule_id = ? AND owner_id = ?"
      )
      .get(options.scheduleId, options.ownerId) as
      | {
          schedule_id: string;
          workflow_id: string;
          workflow_version: number;
          project_id: string;
          owner_id: string;
          inputs_json: string;
          enabled: number;
        }
      | undefined;

    if (!sched) {
      throw new Error("WORKFLOW_SCHEDULE_NOT_FOUND");
    }
    if (!sched.enabled) {
      throw new Error("WORKFLOW_SCHEDULE_PAUSED");
    }

    const clientRequestId = `schedule:${sched.schedule_id}:${options.slotIso}`;
    const existingRun = this.sqlite
      .prepare(
        `SELECT id, dag_id, definition_json
         FROM kosmora_workflow_runs
         WHERE owner_id = ? AND project_id = ? AND client_request_id = ?`
      )
      .get(options.ownerId, sched.project_id, clientRequestId) as
      | { id: string; dag_id: string; definition_json: string }
      | undefined;

    if (existingRun) {
      const parsedPlan = JSON.parse(existingRun.definition_json) as FlattenedWorkflowPlan;
      return {
        runId: existingRun.id,
        dagId: existingRun.dag_id,
        deduplicated: true,
        flattenedStepCount: parsedPlan.flattenedNodes.length
      };
    }

    const inputs = JSON.parse(sched.inputs_json || "{}") as Record<string, unknown>;
    const flattenedPlan = this.resolveAndInlineSubWorkflows({
      ownerId: options.ownerId,
      projectId: sched.project_id,
      workflowId: sched.workflow_id,
      version: sched.workflow_version,
      inputs,
      desktopOrBrowserConsentToken: options.desktopOrBrowserConsentToken
    });

    const runId = `wfrun-${randomUUID()}`;
    const dagId = `dag-${createHash("sha256").update(clientRequestId, "utf8").digest("hex").slice(0, 16)}`;
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_workflow_runs (
            id, workflow_id, project_id, owner_id, client_request_id, request_json,
            definition_version, definition_json, inputs_json, dag_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          runId,
          sched.workflow_id,
          sched.project_id,
          options.ownerId,
          clientRequestId,
          JSON.stringify({ scheduleId: sched.schedule_id, slotIso: options.slotIso }),
          sched.workflow_version,
          JSON.stringify(flattenedPlan),
          sched.inputs_json,
          dagId,
          now
        );

      this.sqlite
        .prepare(
          "UPDATE kosmora_workflow_schedules SET last_slot_iso = ?, updated_at = ? WHERE schedule_id = ?"
        )
        .run(options.slotIso, now, sched.schedule_id);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    return {
      runId,
      dagId,
      deduplicated: false,
      flattenedStepCount: flattenedPlan.flattenedNodes.length
    };
  }
}
