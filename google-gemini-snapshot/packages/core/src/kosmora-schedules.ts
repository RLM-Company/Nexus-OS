/**
 * Kosmora Schedules & Triggers — Automated Playbook Execution Engine
 * Supports Cron (5-field), Interval, One-Time, HMAC-SHA256 Signed Webhooks,
 * and System Event Triggers with Payload-to-Variable Mapping, Idempotency Deduplication,
 * Daily Run/Budget/Concurrency Guardrails, and Automatic Circuit Breakers.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  SCHEDULE_AUDIT_EVENT_TYPES,
  SCHEDULE_EVENT_TOPICS,
  SCHEDULE_RUN_SOURCES,
  SCHEDULE_RUN_STATUSES,
  SCHEDULE_STATUSES,
  SCHEDULE_TRIGGER_TYPES,
  type CreatePlaybookScheduleInput,
  type CreatePlaybookScheduleResult,
  type CronValidationResult,
  type PlaybookSchedule,
  type ScheduleAuditEvent,
  type ScheduleAuditEventType,
  type ScheduleEventTopic,
  type ScheduleExecutionResult,
  type ScheduleRun,
  type ScheduleRunSource,
  type ScheduleRunStatus,
  type ScheduleStatus,
  type ScheduleTriggerType,
  type ScheduleVariableMapping,
  type SystemEventTriggerInput,
  type TriggerScheduleInput,
  type UpdatePlaybookScheduleInput,
  type WebhookTriggerInput
} from "../../contracts/src/kosmora-schedules.js";
import {
  KosmoraEnterpriseSecurityEngine,
  type TenantPrincipal
} from "./kosmora-enterprise-security.js";
import {
  KosmoraMissionControlService,
  type MissionPriority
} from "./kosmora-mission-control.js";
import {
  KosmoraPlaybooksService,
  PlaybookAccessDeniedError,
  PlaybookNotFoundError,
  PlaybookValidationError
} from "./kosmora-playbooks.js";
import {
  KosmoraRuntimeStore,
  type StoredPlaybookScheduleRow,
  type StoredScheduleAuditEventRow,
  type StoredScheduleRunRow
} from "./kosmora-runtime-store.js";

export {
  SCHEDULE_AUDIT_EVENT_TYPES,
  SCHEDULE_EVENT_TOPICS,
  SCHEDULE_RUN_SOURCES,
  SCHEDULE_RUN_STATUSES,
  SCHEDULE_STATUSES,
  SCHEDULE_TRIGGER_TYPES
};

export type {
  CreatePlaybookScheduleInput,
  CreatePlaybookScheduleResult,
  CronValidationResult,
  PlaybookSchedule,
  ScheduleAuditEvent,
  ScheduleAuditEventType,
  ScheduleEventTopic,
  ScheduleExecutionResult,
  ScheduleRun,
  ScheduleRunSource,
  ScheduleRunStatus,
  ScheduleStatus,
  ScheduleTriggerType,
  ScheduleVariableMapping,
  SystemEventTriggerInput,
  TriggerScheduleInput,
  UpdatePlaybookScheduleInput,
  WebhookTriggerInput
};

export class ScheduleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleAccessDeniedError";
  }
}

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export class ScheduleConcurrencyConflictError extends Error {
  constructor(
    scheduleId: string,
    expectedVersion: number,
    actualVersion: number
  ) {
    super(
      `Optimistic concurrency conflict on schedule '${scheduleId}': expected version ${expectedVersion}, actual ${actualVersion}.`
    );
    this.name = "ScheduleConcurrencyConflictError";
  }
}

export class ScheduleWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleWebhookSignatureError";
  }
}

// ============================================================================
// DETERMINISTIC 5-FIELD CRON PARSER & NEXT RUN CALCULATOR
// ============================================================================

interface ParsedCronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  normalized: string;
}

function parseCronField(
  fieldStr: string,
  min: number,
  max: number,
  fieldName: string,
  mapSevenToZero = false
): Set<number> {
  const result = new Set<number>();
  const trimmed = fieldStr.trim();
  if (!trimmed) {
    throw new Error(`Empty cron field '${fieldName}'`);
  }

  const parts = trimmed.split(",");
  for (const part of parts) {
    let rangePart = part.trim();
    let step = 1;

    if (rangePart.includes("/")) {
      const splitStep = rangePart.split("/");
      if (splitStep.length !== 2) {
        throw new Error(`Invalid step syntax '${part}' in ${fieldName}`);
      }
      rangePart = splitStep[0]!.trim();
      const parsedStep = Number(splitStep[1]!.trim());
      if (!Number.isInteger(parsedStep) || parsedStep <= 0) {
        throw new Error(`Invalid step value '${splitStep[1]}' in ${fieldName}`);
      }
      step = parsedStep;
    }

    let start = min;
    let end = max;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const splitRange = rangePart.split("-");
      if (splitRange.length !== 2) {
        throw new Error(`Invalid range syntax '${rangePart}' in ${fieldName}`);
      }
      let rStart = Number(splitRange[0]!.trim());
      let rEnd = Number(splitRange[1]!.trim());
      if (!Number.isInteger(rStart) || !Number.isInteger(rEnd)) {
        throw new Error(`Non-integer range bounds '${rangePart}' in ${fieldName}`);
      }
      if (mapSevenToZero) {
        if (rStart === 7) rStart = 0;
        if (rEnd === 7 && rStart === 0) rEnd = 6;
      }
      if (rStart < min || rStart > max || rEnd < min || rEnd > max || rStart > rEnd) {
        throw new Error(
          `Range '${rangePart}' out of bounds [${min}..${max}] in ${fieldName}`
        );
      }
      start = rStart;
      end = rEnd;
    } else {
      let val = Number(rangePart);
      if (!Number.isInteger(val) || rangePart === "") {
        throw new Error(`Invalid value '${rangePart}' in ${fieldName}`);
      }
      if (mapSevenToZero && val === 7) {
        val = 0;
      }
      if (val < min || val > max) {
        throw new Error(
          `Value '${val}' out of bounds [${min}..${max}] in ${fieldName}`
        );
      }
      if (step === 1) {
        result.add(val);
        continue;
      }
      start = val;
      end = max;
    }

    for (let v = start; v <= end; v += step) {
      result.add(mapSevenToZero && v === 7 ? 0 : v);
    }
  }

  if (result.size === 0) {
    throw new Error(`Cron field '${fieldName}' matched zero values`);
  }
  return result;
}

export function parseFiveFieldCron(expression: string): ParsedCronSpec {
  const tokens = expression
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length !== 5) {
    throw new Error(
      `Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${tokens.length}`
    );
  }

  const minutes = parseCronField(tokens[0]!, 0, 59, "minute");
  const hours = parseCronField(tokens[1]!, 0, 23, "hour");
  const daysOfMonth = parseCronField(tokens[2]!, 1, 31, "day_of_month");
  const months = parseCronField(tokens[3]!, 1, 12, "month");
  const daysOfWeek = parseCronField(tokens[4]!, 0, 7, "day_of_week", true);

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    normalized: tokens.join(" ")
  };
}

export function computeNextCronRuns(
  expression: string,
  fromIso: string,
  count = 1
): string[] {
  const spec = parseFiveFieldCron(expression);
  const startMs = Date.parse(fromIso);
  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid reference timestamp '${fromIso}'`);
  }

  // Start searching at the next whole minute boundary strictly after fromIso
  const cursor = new Date(startMs);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const results: string[] = [];
  const maxIterations = 525_600; // 1 year in minutes

  for (let i = 0; i < maxIterations && results.length < count; i += 1) {
    const month = cursor.getUTCMonth() + 1;
    if (!spec.months.has(month)) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const dom = cursor.getUTCDate();
    const dow = cursor.getUTCDay();
    if (!spec.daysOfMonth.has(dom) || !spec.daysOfWeek.has(dow)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const hour = cursor.getUTCHours();
    if (!spec.hours.has(hour)) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = cursor.getUTCMinutes();
    if (!spec.minutes.has(minute)) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
      continue;
    }

    results.push(cursor.toISOString());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
  }

  return results;
}

export function validateCronExpression(
  expression: string,
  referenceIso = new Date().toISOString()
): CronValidationResult {
  try {
    const spec = parseFiveFieldCron(expression);
    const preview = computeNextCronRuns(spec.normalized, referenceIso, 3);
    return {
      valid: true,
      errors: [],
      normalized_expression: spec.normalized,
      next_runs_preview: preview
    };
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      normalized_expression: null,
      next_runs_preview: []
    };
  }
}

// ============================================================================
// SAFE PAYLOAD PATH EXTRACTOR & HMAC-SHA256 WEBHOOK SIGNING
// ============================================================================

const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor"
]);

export function extractSafePayloadPath(
  payload: Record<string, unknown>,
  dottedPath: string
): string | number | boolean | undefined {
  if (!dottedPath || typeof dottedPath !== "string") {
    return undefined;
  }
  const segments = dottedPath
    .trim()
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = payload;
  for (const seg of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg)) {
      throw new ScheduleValidationError(
        `Forbidden payload path segment '${seg}' in '${dottedPath}'.`
      );
    }
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, seg)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }

  if (
    typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
  ) {
    return current;
  }
  return undefined;
}

export function signWebhookPayload(rawBody: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }
  const normalized = signatureHeader.trim();
  const expected = signWebhookPayload(rawBody, secret);
  const a = Buffer.from(normalized, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

const WEBHOOK_VAULT_KEY = createHash("sha256")
  .update("kosmora-schedules-webhook-vault-key-v1")
  .digest();

function sealWebhookSecret(secret: string): string {
  const sha = createHash("sha256").update(secret, "utf8").digest("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", WEBHOOK_VAULT_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `${sha}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function unsealWebhookSecret(storedValue: string | null): {
  sha256: string | null;
  secret: string | null;
} {
  if (!storedValue) {
    return { sha256: null, secret: null };
  }
  const parts = storedValue.split(":");
  if (parts.length !== 4) {
    return { sha256: storedValue, secret: null };
  }
  const [sha, ivHex, tagHex, encHex] = parts;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      WEBHOOK_VAULT_KEY,
      Buffer.from(ivHex!, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(encHex!, "hex")),
      decipher.final()
    ]).toString("utf8");
    return { sha256: sha!, secret: dec };
  } catch {
    return { sha256: sha ?? null, secret: null };
  }
}

// ============================================================================
// KOSMORA SCHEDULES & TRIGGERS SERVICE
// ============================================================================

export class KosmoraSchedulesService {
  private idCounter = 0;

  constructor(
    private readonly store: KosmoraRuntimeStore,
    private readonly security: KosmoraEnterpriseSecurityEngine,
    private readonly missionControl: KosmoraMissionControlService,
    private readonly playbooksService: KosmoraPlaybooksService
  ) {
    this.store.ensureSchedulesSchema();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    const entropy = createHash("sha256")
      .update(`${prefix}:${Date.now()}:${this.idCounter}:${Math.random()}`)
      .digest("hex")
      .slice(0, 10);
    return `${prefix}_${entropy}`;
  }

  private rowToSchedule(row: StoredPlaybookScheduleRow): PlaybookSchedule {
    const { sha256 } = unsealWebhookSecret(row.webhook_secret_sha256);
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      owner_id: row.owner_id,
      playbook_id: row.playbook_id,
      playbook_version_number:
        row.playbook_version_number === null ||
        row.playbook_version_number === undefined
          ? null
          : Number(row.playbook_version_number),
      title: row.title,
      description: row.description,
      trigger_type: row.trigger_type as ScheduleTriggerType,
      cron_expression: row.cron_expression,
      interval_minutes:
        row.interval_minutes === null || row.interval_minutes === undefined
          ? null
          : Number(row.interval_minutes),
      one_time_run_at: row.one_time_run_at,
      timezone: row.timezone || "UTC",
      event_topic: row.event_topic,
      event_filter_json: JSON.parse(row.event_filter_json || "{}") as Record<
        string,
        string | number | boolean
      >,
      webhook_secret_sha256: sha256,
      webhook_signing_secret_preview: row.webhook_signing_secret_preview,
      default_variables_json: JSON.parse(
        row.default_variables_json || "{}"
      ) as Record<string, string | number | boolean>,
      variable_mappings_json: JSON.parse(
        row.variable_mappings_json || "[]"
      ) as ScheduleVariableMapping[],
      auto_start_mission: Number(row.auto_start_mission) === 1,
      mission_priority: (row.mission_priority || "medium") as MissionPriority,
      mission_title_override: row.mission_title_override,
      max_runs_per_day: Number(row.max_runs_per_day),
      runs_today_count: Number(row.runs_today_count),
      max_concurrent_missions: Number(row.max_concurrent_missions),
      daily_budget_limit: Number(row.daily_budget_limit),
      daily_budget_spent: Number(row.daily_budget_spent),
      consecutive_failures_limit: Number(row.consecutive_failures_limit),
      consecutive_failures_count: Number(row.consecutive_failures_count),
      deduplication_window_seconds: Number(row.deduplication_window_seconds),
      status: row.status as ScheduleStatus,
      disabled_reason: row.disabled_reason,
      last_run_at: row.last_run_at,
      next_run_at: row.next_run_at,
      version: Number(row.version),
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived_at: row.archived_at
    };
  }

  private rowToScheduleRun(row: StoredScheduleRunRow): ScheduleRun {
    return {
      id: row.id,
      schedule_id: row.schedule_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      playbook_id: row.playbook_id,
      playbook_version_id: row.playbook_version_id,
      playbook_instantiation_id: row.playbook_instantiation_id,
      resulting_mission_id: row.resulting_mission_id,
      trigger_source: row.trigger_source as ScheduleRunSource,
      idempotency_key: row.idempotency_key,
      status: row.status as ScheduleRunStatus,
      resolved_variables_json: JSON.parse(
        row.resolved_variables_json || "{}"
      ) as Record<string, string | number | boolean>,
      failure_reason: row.failure_reason,
      estimated_budget: Number(row.estimated_budget),
      initiated_by: row.initiated_by,
      initiated_at: row.initiated_at,
      completed_at: row.completed_at
    };
  }

  private rowToAuditEvent(row: StoredScheduleAuditEventRow): ScheduleAuditEvent {
    return {
      id: row.id,
      schedule_id: row.schedule_id,
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      actor_id: row.actor_id,
      event_type: row.event_type as ScheduleAuditEventType,
      details_json: JSON.parse(row.details_json || "{}") as Record<
        string,
        unknown
      >,
      created_at: row.created_at
    };
  }

  private recordAuditEvent(params: {
    schedule_id: string;
    tenant_id: string;
    project_id: string;
    actor_id: string;
    event_type: ScheduleAuditEventType;
    details: Record<string, unknown>;
    now_iso?: string;
  }): ScheduleAuditEvent {
    const nowIso = params.now_iso ?? new Date().toISOString();
    const row: StoredScheduleAuditEventRow = {
      id: this.nextId("sca"),
      schedule_id: params.schedule_id,
      tenant_id: params.tenant_id,
      project_id: params.project_id,
      actor_id: params.actor_id,
      event_type: params.event_type,
      details_json: JSON.stringify(params.details),
      created_at: nowIso
    };
    this.store.insertScheduleAuditEventRow(row);
    this.security.appendAuditEntry(
      params.tenant_id,
      params.actor_id,
      params.event_type,
      params.schedule_id,
      "allow",
      params.details
    );
    return this.rowToAuditEvent(row);
  }

  private assertPrincipalReadAccess(
    principal: TenantPrincipal,
    schedule: PlaybookSchedule,
    requestedProjectId?: string
  ): void {
    const auth = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      principal.workspace_ids[0] ?? "ws_default",
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new ScheduleAccessDeniedError(auth.reason);
    }
    if (schedule.tenant_id !== principal.tenant_id) {
      throw new ScheduleAccessDeniedError(
        `Cross-tenant access denied for schedule '${schedule.id}'.`
      );
    }
    if (requestedProjectId && schedule.project_id !== requestedProjectId) {
      throw new ScheduleAccessDeniedError(
        `Cross-project access denied for schedule '${schedule.id}'.`
      );
    }
  }

  private assertPrincipalWriteAccess(
    principal: TenantPrincipal,
    schedule?: PlaybookSchedule
  ): void {
    const auth = this.security.authorizeAction(
      principal,
      principal.tenant_id,
      principal.workspace_ids[0] ?? "ws_default",
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new ScheduleAccessDeniedError(auth.reason);
    }
    if (schedule && schedule.tenant_id !== principal.tenant_id) {
      throw new ScheduleAccessDeniedError(
        `Cross-tenant write access denied for schedule '${schedule.id}'.`
      );
    }
  }

  private computeNextRunTimestamp(params: {
    trigger_type: ScheduleTriggerType;
    cron_expression: string | null;
    interval_minutes: number | null;
    one_time_run_at: string | null;
    reference_iso: string;
  }): { normalizedCron: string | null; nextRunAt: string | null } {
    const {
      trigger_type,
      cron_expression,
      interval_minutes,
      one_time_run_at,
      reference_iso
    } = params;

    if (trigger_type === "cron") {
      if (!cron_expression || !cron_expression.trim()) {
        throw new ScheduleValidationError(
          "cron_expression is required when trigger_type is 'cron'."
        );
      }
      const validation = validateCronExpression(cron_expression, reference_iso);
      if (!validation.valid || !validation.normalized_expression) {
        throw new ScheduleValidationError(
          `Invalid cron_expression '${cron_expression}': ${validation.errors.join("; ")}`
        );
      }
      return {
        normalizedCron: validation.normalized_expression,
        nextRunAt: validation.next_runs_preview[0] ?? null
      };
    }

    if (trigger_type === "interval") {
      if (
        interval_minutes === null ||
        interval_minutes === undefined ||
        !Number.isInteger(interval_minutes) ||
        interval_minutes < 1 ||
        interval_minutes > 43_200
      ) {
        throw new ScheduleValidationError(
          "interval_minutes must be an integer between 1 and 43200 when trigger_type is 'interval'."
        );
      }
      const refMs = Date.parse(reference_iso);
      const nextIso = new Date(refMs + interval_minutes * 60_000).toISOString();
      return { normalizedCron: null, nextRunAt: nextIso };
    }

    if (trigger_type === "one_time") {
      if (!one_time_run_at || Number.isNaN(Date.parse(one_time_run_at))) {
        throw new ScheduleValidationError(
          "one_time_run_at must be a valid ISO-8601 timestamp when trigger_type is 'one_time'."
        );
      }
      return {
        normalizedCron: null,
        nextRunAt: new Date(Date.parse(one_time_run_at)).toISOString()
      };
    }

    if (trigger_type === "webhook" || trigger_type === "event") {
      return { normalizedCron: null, nextRunAt: null };
    }

    throw new ScheduleValidationError(
      `Unsupported trigger_type '${String(trigger_type)}'.`
    );
  }

  public createSchedule(params: {
    principal: TenantPrincipal;
    input: CreatePlaybookScheduleInput;
  }): CreatePlaybookScheduleResult {
    this.assertPrincipalWriteAccess(params.principal);
    const { input, principal } = params;

    if (!input.project_id || !input.project_id.trim()) {
      throw new ScheduleValidationError("project_id is required.");
    }
    if (!input.title || !input.title.trim()) {
      throw new ScheduleValidationError("Schedule title is required.");
    }
    if (!SCHEDULE_TRIGGER_TYPES.includes(input.trigger_type)) {
      throw new ScheduleValidationError(
        `Invalid trigger_type '${input.trigger_type}'.`
      );
    }

    if (input.trigger_type === "event") {
      if (!input.event_topic || !String(input.event_topic).trim()) {
        throw new ScheduleValidationError(
          "event_topic is required when trigger_type is 'event'."
        );
      }
    }

    // Verify target playbook exists, is accessible, is not archived, and has a published version
    let playbook;
    try {
      playbook = this.playbooksService.getPlaybookDetails({
        principal,
        playbook_id: input.playbook_id,
        project_id: input.project_id
      }).playbook;
    } catch (err) {
      if (err instanceof PlaybookNotFoundError) {
        throw new ScheduleValidationError(err.message);
      }
      if (err instanceof PlaybookAccessDeniedError) {
        throw new ScheduleAccessDeniedError(err.message);
      }
      throw err;
    }

    if (playbook.status === "archived") {
      throw new ScheduleValidationError(
        `Cannot create schedule for archived playbook '${playbook.id}'.`
      );
    }
    if (playbook.current_version < 1) {
      throw new ScheduleValidationError(
        `Playbook '${playbook.id}' must have at least one published version before scheduling.`
      );
    }

    if (
      input.playbook_version_number !== undefined &&
      input.playbook_version_number !== null
    ) {
      const ver = this.playbooksService.getVersion({
        principal,
        playbook_id: playbook.id,
        version_id: input.playbook_version_number,
        project_id: input.project_id
      });
      if (!ver.is_published) {
        throw new ScheduleValidationError(
          `Playbook version ${input.playbook_version_number} is not published.`
        );
      }
    }

    // Validate variable mappings syntax
    for (const mapping of input.variable_mappings_json ?? []) {
      if (!mapping.variable_key || !mapping.payload_path) {
        throw new ScheduleValidationError(
          "Each variable mapping must specify non-empty variable_key and payload_path."
        );
      }
      for (const seg of mapping.payload_path.split(".")) {
        if (FORBIDDEN_PATH_SEGMENTS.has(seg.trim())) {
          throw new ScheduleValidationError(
            `Forbidden payload_path segment '${seg}' in variable mapping.`
          );
        }
      }
    }

    const nowIso = input.now_iso ?? new Date().toISOString();
    const { normalizedCron, nextRunAt } = this.computeNextRunTimestamp({
      trigger_type: input.trigger_type,
      cron_expression: input.cron_expression ?? null,
      interval_minutes: input.interval_minutes ?? null,
      one_time_run_at: input.one_time_run_at ?? null,
      reference_iso: nowIso
    });

    const maxRunsPerDay = Number(input.max_runs_per_day ?? 24);
    const maxConcurrentMissions = Number(input.max_concurrent_missions ?? 3);
    const dailyBudgetLimit = Number(input.daily_budget_limit ?? 100);
    const consecutiveFailuresLimit = Number(
      input.consecutive_failures_limit ?? 3
    );
    const dedupWindowSeconds = Number(
      input.deduplication_window_seconds ?? 300
    );

    if (maxRunsPerDay < 1 || maxConcurrentMissions < 1 || dailyBudgetLimit <= 0 || consecutiveFailuresLimit < 1 || dedupWindowSeconds < 0) {
      throw new ScheduleValidationError(
        "Guardrail limits must be positive (max_runs_per_day >= 1, max_concurrent_missions >= 1, daily_budget_limit > 0, consecutive_failures_limit >= 1)."
      );
    }

    let rawWebhookSecret: string | null = null;
    let sealedWebhookSecret: string | null = null;
    let webhookPreview: string | null = null;

    if (input.trigger_type === "webhook") {
      rawWebhookSecret = `whsec_${randomBytes(24).toString("hex")}`;
      sealedWebhookSecret = sealWebhookSecret(rawWebhookSecret);
      webhookPreview = `${rawWebhookSecret.slice(0, 10)}...${rawWebhookSecret.slice(-4)}`;
    }

    const scheduleId = this.nextId("sch");
    const row: StoredPlaybookScheduleRow = {
      id: scheduleId,
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      owner_id: principal.user_id,
      playbook_id: playbook.id,
      playbook_version_number: input.playbook_version_number ?? null,
      title: input.title.trim(),
      description: (input.description ?? "").trim(),
      trigger_type: input.trigger_type,
      cron_expression: normalizedCron,
      interval_minutes:
        input.trigger_type === "interval"
          ? Number(input.interval_minutes)
          : null,
      one_time_run_at:
        input.trigger_type === "one_time" ? nextRunAt : null,
      timezone: (input.timezone ?? "UTC").trim() || "UTC",
      event_topic:
        input.trigger_type === "event" ? String(input.event_topic).trim() : null,
      event_filter_json: JSON.stringify(input.event_filter_json ?? {}),
      webhook_secret_sha256: sealedWebhookSecret,
      webhook_signing_secret_preview: webhookPreview,
      default_variables_json: JSON.stringify(input.default_variables_json ?? {}),
      variable_mappings_json: JSON.stringify(input.variable_mappings_json ?? []),
      auto_start_mission: input.auto_start_mission === false ? 0 : 1,
      mission_priority: input.mission_priority ?? "medium",
      mission_title_override: input.mission_title_override ?? null,
      max_runs_per_day: maxRunsPerDay,
      runs_today_count: 0,
      max_concurrent_missions: maxConcurrentMissions,
      daily_budget_limit: dailyBudgetLimit,
      daily_budget_spent: 0,
      consecutive_failures_limit: consecutiveFailuresLimit,
      consecutive_failures_count: 0,
      deduplication_window_seconds: dedupWindowSeconds,
      status: "active",
      disabled_reason: null,
      last_run_at: null,
      next_run_at: nextRunAt,
      version: 1,
      created_at: nowIso,
      updated_at: nowIso,
      archived_at: null
    };

    this.store.upsertPlaybookScheduleRow(row);
    const schedule = this.rowToSchedule(row);

    this.recordAuditEvent({
      schedule_id: schedule.id,
      tenant_id: schedule.tenant_id,
      project_id: schedule.project_id,
      actor_id: principal.user_id,
      event_type: "schedule_created",
      details: {
        title: schedule.title,
        playbook_id: schedule.playbook_id,
        trigger_type: schedule.trigger_type,
        next_run_at: schedule.next_run_at
      },
      now_iso: nowIso
    });

    return {
      schedule,
      webhook_signing_secret: rawWebhookSecret
    };
  }

  public getSchedule(params: {
    principal: TenantPrincipal;
    schedule_id: string;
    project_id?: string;
  }): PlaybookSchedule {
    const row = this.store.getPlaybookScheduleRow(params.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${params.schedule_id}' not found.`
      );
    }
    const schedule = this.rowToSchedule(row);
    this.assertPrincipalReadAccess(
      params.principal,
      schedule,
      params.project_id
    );
    return schedule;
  }

  public listSchedules(params: {
    principal: TenantPrincipal;
    project_id?: string;
    playbook_id?: string;
    trigger_type?: ScheduleTriggerType;
    status?: ScheduleStatus;
  }): PlaybookSchedule[] {
    const auth = this.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.principal.workspace_ids[0] ?? "ws_default",
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new ScheduleAccessDeniedError(auth.reason);
    }

    const rows = this.store.listPlaybookScheduleRows({
      tenant_id: params.principal.tenant_id,
      project_id: params.project_id,
      playbook_id: params.playbook_id,
      trigger_type: params.trigger_type,
      status: params.status
    });
    return rows.map((r) => this.rowToSchedule(r));
  }

  public updateSchedule(params: {
    principal: TenantPrincipal;
    input: UpdatePlaybookScheduleInput;
  }): PlaybookSchedule {
    const { principal, input } = params;
    const row = this.store.getPlaybookScheduleRow(input.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${input.schedule_id}' not found.`
      );
    }
    const existing = this.rowToSchedule(row);
    this.assertPrincipalWriteAccess(principal, existing);

    if (existing.status === "archived") {
      throw new ScheduleValidationError(
        `Archived schedule '${existing.id}' cannot be modified.`
      );
    }
    if (Number(row.version) !== Number(input.expected_version)) {
      throw new ScheduleConcurrencyConflictError(
        existing.id,
        input.expected_version,
        Number(row.version)
      );
    }

    const nowIso = input.now_iso ?? new Date().toISOString();
    const nextTriggerType = input.trigger_type ?? existing.trigger_type;
    const nextCronExpr =
      input.cron_expression !== undefined
        ? input.cron_expression
        : existing.cron_expression;
    const nextInterval =
      input.interval_minutes !== undefined
        ? input.interval_minutes
        : existing.interval_minutes;
    const nextOneTime =
      input.one_time_run_at !== undefined
        ? input.one_time_run_at
        : existing.one_time_run_at;

    const { normalizedCron, nextRunAt } = this.computeNextRunTimestamp({
      trigger_type: nextTriggerType,
      cron_expression: nextCronExpr,
      interval_minutes: nextInterval,
      one_time_run_at: nextOneTime,
      reference_iso: nowIso
    });

    const updatedRow: StoredPlaybookScheduleRow = {
      ...row,
      title: input.title !== undefined ? input.title.trim() : row.title,
      description:
        input.description !== undefined
          ? input.description.trim()
          : row.description,
      playbook_version_number:
        input.playbook_version_number !== undefined
          ? input.playbook_version_number
          : row.playbook_version_number,
      trigger_type: nextTriggerType,
      cron_expression: normalizedCron,
      interval_minutes:
        nextTriggerType === "interval" ? Number(nextInterval) : null,
      one_time_run_at: nextTriggerType === "one_time" ? nextRunAt : null,
      timezone:
        input.timezone !== undefined ? input.timezone.trim() : row.timezone,
      event_topic:
        input.event_topic !== undefined
          ? input.event_topic
          : row.event_topic,
      event_filter_json:
        input.event_filter_json !== undefined
          ? JSON.stringify(input.event_filter_json)
          : row.event_filter_json,
      default_variables_json:
        input.default_variables_json !== undefined
          ? JSON.stringify(input.default_variables_json)
          : row.default_variables_json,
      variable_mappings_json:
        input.variable_mappings_json !== undefined
          ? JSON.stringify(input.variable_mappings_json)
          : row.variable_mappings_json,
      auto_start_mission:
        input.auto_start_mission !== undefined
          ? input.auto_start_mission
            ? 1
            : 0
          : row.auto_start_mission,
      mission_priority:
        input.mission_priority !== undefined
          ? input.mission_priority
          : row.mission_priority,
      mission_title_override:
        input.mission_title_override !== undefined
          ? input.mission_title_override
          : row.mission_title_override,
      max_runs_per_day:
        input.max_runs_per_day !== undefined
          ? Number(input.max_runs_per_day)
          : row.max_runs_per_day,
      max_concurrent_missions:
        input.max_concurrent_missions !== undefined
          ? Number(input.max_concurrent_missions)
          : row.max_concurrent_missions,
      daily_budget_limit:
        input.daily_budget_limit !== undefined
          ? Number(input.daily_budget_limit)
          : row.daily_budget_limit,
      consecutive_failures_limit:
        input.consecutive_failures_limit !== undefined
          ? Number(input.consecutive_failures_limit)
          : row.consecutive_failures_limit,
      deduplication_window_seconds:
        input.deduplication_window_seconds !== undefined
          ? Number(input.deduplication_window_seconds)
          : row.deduplication_window_seconds,
      next_run_at:
        row.status === "active" ? nextRunAt : null,
      version: Number(row.version) + 1,
      updated_at: nowIso
    };

    this.store.upsertPlaybookScheduleRow(updatedRow);
    const updated = this.rowToSchedule(updatedRow);

    this.recordAuditEvent({
      schedule_id: updated.id,
      tenant_id: updated.tenant_id,
      project_id: updated.project_id,
      actor_id: principal.user_id,
      event_type: "schedule_updated",
      details: {
        version: updated.version,
        trigger_type: updated.trigger_type,
        next_run_at: updated.next_run_at
      },
      now_iso: nowIso
    });

    return updated;
  }

  public pauseSchedule(params: {
    principal: TenantPrincipal;
    schedule_id: string;
    reason?: string;
    now_iso?: string;
  }): PlaybookSchedule {
    const row = this.store.getPlaybookScheduleRow(params.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${params.schedule_id}' not found.`
      );
    }
    const existing = this.rowToSchedule(row);
    this.assertPrincipalWriteAccess(params.principal, existing);

    if (existing.status === "archived") {
      throw new ScheduleValidationError(
        `Archived schedule '${existing.id}' cannot be paused.`
      );
    }

    const nowIso = params.now_iso ?? new Date().toISOString();
    const updatedRow: StoredPlaybookScheduleRow = {
      ...row,
      status: "paused",
      disabled_reason: params.reason?.trim() || "Приостановлено пользователем",
      next_run_at: null,
      version: Number(row.version) + 1,
      updated_at: nowIso
    };
    this.store.upsertPlaybookScheduleRow(updatedRow);
    const updated = this.rowToSchedule(updatedRow);

    this.recordAuditEvent({
      schedule_id: updated.id,
      tenant_id: updated.tenant_id,
      project_id: updated.project_id,
      actor_id: params.principal.user_id,
      event_type: "schedule_paused",
      details: { reason: updated.disabled_reason },
      now_iso: nowIso
    });
    return updated;
  }

  public resumeSchedule(params: {
    principal: TenantPrincipal;
    schedule_id: string;
    reset_daily_counters?: boolean;
    now_iso?: string;
  }): PlaybookSchedule {
    const row = this.store.getPlaybookScheduleRow(params.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${params.schedule_id}' not found.`
      );
    }
    const existing = this.rowToSchedule(row);
    this.assertPrincipalWriteAccess(params.principal, existing);

    if (existing.status === "archived") {
      throw new ScheduleValidationError(
        `Archived schedule '${existing.id}' cannot be resumed.`
      );
    }

    const nowIso = params.now_iso ?? new Date().toISOString();
    const { nextRunAt } = this.computeNextRunTimestamp({
      trigger_type: existing.trigger_type,
      cron_expression: existing.cron_expression,
      interval_minutes: existing.interval_minutes,
      one_time_run_at: existing.one_time_run_at,
      reference_iso: nowIso
    });

    const updatedRow: StoredPlaybookScheduleRow = {
      ...row,
      status: "active",
      disabled_reason: null,
      consecutive_failures_count: 0,
      runs_today_count: params.reset_daily_counters ? 0 : row.runs_today_count,
      daily_budget_spent: params.reset_daily_counters
        ? 0
        : row.daily_budget_spent,
      next_run_at: nextRunAt,
      version: Number(row.version) + 1,
      updated_at: nowIso
    };
    this.store.upsertPlaybookScheduleRow(updatedRow);
    const updated = this.rowToSchedule(updatedRow);

    this.recordAuditEvent({
      schedule_id: updated.id,
      tenant_id: updated.tenant_id,
      project_id: updated.project_id,
      actor_id: params.principal.user_id,
      event_type: "schedule_resumed",
      details: {
        next_run_at: updated.next_run_at,
        reset_daily_counters: Boolean(params.reset_daily_counters)
      },
      now_iso: nowIso
    });
    return updated;
  }

  public archiveSchedule(params: {
    principal: TenantPrincipal;
    schedule_id: string;
    now_iso?: string;
  }): PlaybookSchedule {
    const row = this.store.getPlaybookScheduleRow(params.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${params.schedule_id}' not found.`
      );
    }
    const existing = this.rowToSchedule(row);
    this.assertPrincipalWriteAccess(params.principal, existing);

    const nowIso = params.now_iso ?? new Date().toISOString();
    const updatedRow: StoredPlaybookScheduleRow = {
      ...row,
      status: "archived",
      next_run_at: null,
      archived_at: nowIso,
      version: Number(row.version) + 1,
      updated_at: nowIso
    };
    this.store.upsertPlaybookScheduleRow(updatedRow);
    const updated = this.rowToSchedule(updatedRow);

    this.recordAuditEvent({
      schedule_id: updated.id,
      tenant_id: updated.tenant_id,
      project_id: updated.project_id,
      actor_id: params.principal.user_id,
      event_type: "schedule_archived",
      details: { archived_at: nowIso },
      now_iso: nowIso
    });
    return updated;
  }

  public rotateWebhookSecret(params: {
    principal: TenantPrincipal;
    schedule_id: string;
    now_iso?: string;
  }): CreatePlaybookScheduleResult {
    const row = this.store.getPlaybookScheduleRow(params.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${params.schedule_id}' not found.`
      );
    }
    const existing = this.rowToSchedule(row);
    this.assertPrincipalWriteAccess(params.principal, existing);

    if (existing.trigger_type !== "webhook") {
      throw new ScheduleValidationError(
        `Schedule '${existing.id}' is not a webhook schedule.`
      );
    }

    const nowIso = params.now_iso ?? new Date().toISOString();
    const rawWebhookSecret = `whsec_${randomBytes(24).toString("hex")}`;
    const sealed = sealWebhookSecret(rawWebhookSecret);
    const preview = `${rawWebhookSecret.slice(0, 10)}...${rawWebhookSecret.slice(-4)}`;

    const updatedRow: StoredPlaybookScheduleRow = {
      ...row,
      webhook_secret_sha256: sealed,
      webhook_signing_secret_preview: preview,
      version: Number(row.version) + 1,
      updated_at: nowIso
    };
    this.store.upsertPlaybookScheduleRow(updatedRow);
    const updated = this.rowToSchedule(updatedRow);

    this.recordAuditEvent({
      schedule_id: updated.id,
      tenant_id: updated.tenant_id,
      project_id: updated.project_id,
      actor_id: params.principal.user_id,
      event_type: "schedule_secret_rotated",
      details: {
        webhook_secret_sha256: updated.webhook_secret_sha256,
        webhook_signing_secret_preview: preview
      },
      now_iso: nowIso
    });

    return {
      schedule: updated,
      webhook_signing_secret: rawWebhookSecret
    };
  }

  public listScheduleRuns(params: {
    principal: TenantPrincipal;
    schedule_id: string;
  }): ScheduleRun[] {
    const schedule = this.getSchedule({
      principal: params.principal,
      schedule_id: params.schedule_id
    });
    return this.store
      .listScheduleRunRows(schedule.id)
      .map((r) => this.rowToScheduleRun(r));
  }

  public listScheduleAuditEvents(params: {
    principal: TenantPrincipal;
    schedule_id: string;
  }): ScheduleAuditEvent[] {
    const schedule = this.getSchedule({
      principal: params.principal,
      schedule_id: params.schedule_id
    });
    return this.store
      .listScheduleAuditEventRows(schedule.id)
      .map((r) => this.rowToAuditEvent(r));
  }

  private countActiveConcurrentMissionsForSchedule(
    principal: TenantPrincipal,
    scheduleId: string
  ): number {
    const runs = this.store.listScheduleRunRows(scheduleId);
    const activeStatuses = new Set([
      "ready",
      "running",
      "waiting_for_review",
      "paused"
    ]);
    let activeCount = 0;
    const seenMissionIds = new Set<string>();

    for (const r of runs) {
      if (!r.resulting_mission_id || seenMissionIds.has(r.resulting_mission_id)) {
        continue;
      }
      seenMissionIds.add(r.resulting_mission_id);
      try {
        const details = this.missionControl.getMissionDetails({
          principal,
          mission_id: r.resulting_mission_id
        });
        if (activeStatuses.has(details.mission.status)) {
          activeCount += 1;
        }
      } catch {
        // Ignore if mission was deleted
      }
    }
    return activeCount;
  }

  /**
   * Core execution pipeline shared across Manual, Cron/Interval/One-Time Tick,
   * Webhook, and System Event triggers.
   */
  public triggerScheduleNow(params: {
    principal: TenantPrincipal;
    input: TriggerScheduleInput;
  }): ScheduleExecutionResult {
    const { principal, input } = params;
    const row = this.store.getPlaybookScheduleRow(input.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${input.schedule_id}' not found.`
      );
    }
    let schedule = this.rowToSchedule(row);
    this.assertPrincipalWriteAccess(principal, schedule);

    if (schedule.status !== "active") {
      throw new ScheduleValidationError(
        `Schedule '${schedule.id}' cannot be triggered while in status '${schedule.status}' (${schedule.disabled_reason ?? "inactive"}).`
      );
    }

    const nowIso = input.now_iso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const triggerSource: ScheduleRunSource = input.trigger_source ?? "manual";
    const idempotencyKey =
      input.idempotency_key?.trim() ||
      `${schedule.id}:${triggerSource}:${nowIso}`;

    // 1. Check idempotency deduplication within deduplication_window_seconds
    if (schedule.deduplication_window_seconds > 0) {
      const existingRuns = this.store.listScheduleRunRows(schedule.id);
      const duplicate = existingRuns.find((r) => {
        if (r.idempotency_key !== idempotencyKey) return false;
        if (r.status !== "triggered") return false;
        const ageSeconds = (nowMs - Date.parse(r.initiated_at)) / 1000;
        return ageSeconds >= 0 && ageSeconds <= schedule.deduplication_window_seconds;
      });

      if (duplicate) {
        const skippedRunRow: StoredScheduleRunRow = {
          id: this.nextId("scr"),
          schedule_id: schedule.id,
          tenant_id: schedule.tenant_id,
          project_id: schedule.project_id,
          playbook_id: schedule.playbook_id,
          playbook_version_id: duplicate.playbook_version_id,
          playbook_instantiation_id: duplicate.playbook_instantiation_id,
          resulting_mission_id: duplicate.resulting_mission_id,
          trigger_source: triggerSource,
          idempotency_key: idempotencyKey,
          status: "skipped_dedup",
          resolved_variables_json: duplicate.resolved_variables_json,
          failure_reason: `Deduplicated against run '${duplicate.id}' within ${schedule.deduplication_window_seconds}s window.`,
          estimated_budget: 0,
          initiated_by: principal.user_id,
          initiated_at: nowIso,
          completed_at: nowIso
        };
        this.store.insertScheduleRunRow(skippedRunRow);
        this.recordAuditEvent({
          schedule_id: schedule.id,
          tenant_id: schedule.tenant_id,
          project_id: schedule.project_id,
          actor_id: principal.user_id,
          event_type: "schedule_run_skipped_dedup",
          details: {
            idempotency_key: idempotencyKey,
            original_run_id: duplicate.id,
            resulting_mission_id: duplicate.resulting_mission_id
          },
          now_iso: nowIso
        });
        return {
          schedule,
          run: this.rowToScheduleRun(skippedRunRow),
          mission_id: duplicate.resulting_mission_id,
          mission_status: null,
          instantiation_id: duplicate.playbook_instantiation_id
        };
      }
    }

    // 2. Merge default variables + payload mappings + explicit overrides
    const mergedVariables: Record<string, string | number | boolean> = {
      ...schedule.default_variables_json
    };
    if (input.payload) {
      for (const mapping of schedule.variable_mappings_json) {
        const extracted = extractSafePayloadPath(
          input.payload,
          mapping.payload_path
        );
        if (extracted !== undefined) {
          mergedVariables[mapping.variable_key] = extracted;
        } else if (mapping.fallback_value !== undefined) {
          mergedVariables[mapping.variable_key] = mapping.fallback_value;
        }
      }
    }
    if (input.override_variables) {
      for (const [k, v] of Object.entries(input.override_variables)) {
        mergedVariables[k] = v;
      }
    }

    // 3. Guardrail: Daily runs limit
    if (schedule.runs_today_count >= schedule.max_runs_per_day) {
      const blockedRunRow: StoredScheduleRunRow = {
        id: this.nextId("scr"),
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        playbook_id: schedule.playbook_id,
        playbook_version_id: null,
        playbook_instantiation_id: null,
        resulting_mission_id: null,
        trigger_source: triggerSource,
        idempotency_key: idempotencyKey,
        status: "blocked_daily_limit",
        resolved_variables_json: "{}",
        failure_reason: `Превышен дневной лимит запусков (${schedule.runs_today_count}/${schedule.max_runs_per_day}).`,
        estimated_budget: 0,
        initiated_by: principal.user_id,
        initiated_at: nowIso,
        completed_at: nowIso
      };
      this.store.insertScheduleRunRow(blockedRunRow);
      this.recordAuditEvent({
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        actor_id: principal.user_id,
        event_type: "schedule_guardrail_blocked",
        details: {
          guardrail: "max_runs_per_day",
          runs_today_count: schedule.runs_today_count,
          max_runs_per_day: schedule.max_runs_per_day
        },
        now_iso: nowIso
      });
      return {
        schedule,
        run: this.rowToScheduleRun(blockedRunRow),
        mission_id: null,
        mission_status: null,
        instantiation_id: null
      };
    }

    // 4. Guardrail: Max concurrent missions
    const activeConcurrent = this.countActiveConcurrentMissionsForSchedule(
      principal,
      schedule.id
    );
    if (activeConcurrent >= schedule.max_concurrent_missions) {
      const blockedRunRow: StoredScheduleRunRow = {
        id: this.nextId("scr"),
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        playbook_id: schedule.playbook_id,
        playbook_version_id: null,
        playbook_instantiation_id: null,
        resulting_mission_id: null,
        trigger_source: triggerSource,
        idempotency_key: idempotencyKey,
        status: "blocked_concurrency",
        resolved_variables_json: "{}",
        failure_reason: `Превышен лимит параллельных миссий расписания (${activeConcurrent}/${schedule.max_concurrent_missions}).`,
        estimated_budget: 0,
        initiated_by: principal.user_id,
        initiated_at: nowIso,
        completed_at: nowIso
      };
      this.store.insertScheduleRunRow(blockedRunRow);
      this.recordAuditEvent({
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        actor_id: principal.user_id,
        event_type: "schedule_guardrail_blocked",
        details: {
          guardrail: "max_concurrent_missions",
          active_concurrent: activeConcurrent,
          max_concurrent_missions: schedule.max_concurrent_missions
        },
        now_iso: nowIso
      });
      return {
        schedule,
        run: this.rowToScheduleRun(blockedRunRow),
        mission_id: null,
        mission_status: null,
        instantiation_id: null
      };
    }

    // 5. Preview Playbook & Check Daily Budget Guardrail
    try {
      const preview = this.playbooksService.previewInstantiation({
        principal,
        playbook_id: schedule.playbook_id,
        version_id: schedule.playbook_version_number ?? undefined,
        project_id: schedule.project_id,
        variables: mergedVariables,
        mission_title_override: schedule.mission_title_override ?? undefined
      });

      const projectedDailySpend = Number(
        (schedule.daily_budget_spent + preview.planned_budget).toFixed(2)
      );
      if (projectedDailySpend > schedule.daily_budget_limit) {
        const blockedRunRow: StoredScheduleRunRow = {
          id: this.nextId("scr"),
          schedule_id: schedule.id,
          tenant_id: schedule.tenant_id,
          project_id: schedule.project_id,
          playbook_id: schedule.playbook_id,
          playbook_version_id: preview.version_id,
          playbook_instantiation_id: null,
          resulting_mission_id: null,
          trigger_source: triggerSource,
          idempotency_key: idempotencyKey,
          status: "blocked_budget",
          resolved_variables_json: JSON.stringify(preview.sanitized_variables),
          failure_reason: `Превышен дневной бюджет расписания (${projectedDailySpend} > ${schedule.daily_budget_limit}).`,
          estimated_budget: preview.planned_budget,
          initiated_by: principal.user_id,
          initiated_at: nowIso,
          completed_at: nowIso
        };
        this.store.insertScheduleRunRow(blockedRunRow);
        this.recordAuditEvent({
          schedule_id: schedule.id,
          tenant_id: schedule.tenant_id,
          project_id: schedule.project_id,
          actor_id: principal.user_id,
          event_type: "schedule_guardrail_blocked",
          details: {
            guardrail: "daily_budget_limit",
            daily_budget_spent: schedule.daily_budget_spent,
            planned_budget: preview.planned_budget,
            daily_budget_limit: schedule.daily_budget_limit
          },
          now_iso: nowIso
        });
        return {
          schedule,
          run: this.rowToScheduleRun(blockedRunRow),
          mission_id: null,
          mission_status: null,
          instantiation_id: null
        };
      }

      // 6. Instantiate Playbook -> Mission Control Mission
      const instantiated = this.playbooksService.instantiatePlaybook({
        principal,
        playbook_id: schedule.playbook_id,
        version_id: schedule.playbook_version_number ?? undefined,
        project_id: schedule.project_id,
        variables: mergedVariables,
        mission_title_override: schedule.mission_title_override ?? undefined
      });

      let finalMission = instantiated.mission;
      if (schedule.auto_start_mission) {
        finalMission = this.missionControl.startMission({
          principal,
          mission_id: finalMission.id
        });
      }

      // Compute next run timestamp (or pause if one_time)
      const { nextRunAt } = this.computeNextRunTimestamp({
        trigger_type: schedule.trigger_type,
        cron_expression: schedule.cron_expression,
        interval_minutes: schedule.interval_minutes,
        one_time_run_at: schedule.one_time_run_at,
        reference_iso: nowIso
      });

      const nextStatus: ScheduleStatus =
        schedule.trigger_type === "one_time" ? "paused" : schedule.status;

      const updatedScheduleRow: StoredPlaybookScheduleRow = {
        ...row,
        runs_today_count: Number(row.runs_today_count) + 1,
        daily_budget_spent: projectedDailySpend,
        consecutive_failures_count: 0,
        status: nextStatus,
        disabled_reason:
          schedule.trigger_type === "one_time"
            ? "Однократный запуск выполнен"
            : null,
        last_run_at: nowIso,
        next_run_at: nextStatus === "active" ? nextRunAt : null,
        version: Number(row.version) + 1,
        updated_at: nowIso
      };
      this.store.upsertPlaybookScheduleRow(updatedScheduleRow);
      schedule = this.rowToSchedule(updatedScheduleRow);

      const successRunRow: StoredScheduleRunRow = {
        id: this.nextId("scr"),
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        playbook_id: schedule.playbook_id,
        playbook_version_id: instantiated.instantiation.playbook_version_id,
        playbook_instantiation_id: instantiated.instantiation.id,
        resulting_mission_id: finalMission.id,
        trigger_source: triggerSource,
        idempotency_key: idempotencyKey,
        status: "triggered",
        resolved_variables_json: JSON.stringify(preview.sanitized_variables),
        failure_reason: null,
        estimated_budget: preview.planned_budget,
        initiated_by: principal.user_id,
        initiated_at: nowIso,
        completed_at: nowIso
      };
      this.store.insertScheduleRunRow(successRunRow);

      this.recordAuditEvent({
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        actor_id: principal.user_id,
        event_type: "schedule_triggered",
        details: {
          run_id: successRunRow.id,
          trigger_source: triggerSource,
          resulting_mission_id: finalMission.id,
          mission_status: finalMission.status,
          estimated_budget: preview.planned_budget
        },
        now_iso: nowIso
      });

      return {
        schedule,
        run: this.rowToScheduleRun(successRunRow),
        mission_id: finalMission.id,
        mission_status: finalMission.status,
        instantiation_id: instantiated.instantiation.id
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newFailures = Number(row.consecutive_failures_count) + 1;
      const tripBreaker = newFailures >= Number(row.consecutive_failures_limit);

      const updatedScheduleRow: StoredPlaybookScheduleRow = {
        ...row,
        consecutive_failures_count: newFailures,
        status: tripBreaker ? "disabled_by_guardrail" : row.status,
        disabled_reason: tripBreaker
          ? `Автоматическое отключение предохранителем после ${newFailures} ошибок подряд: ${errorMessage}`
          : row.disabled_reason,
        next_run_at: tripBreaker ? null : row.next_run_at,
        last_run_at: nowIso,
        version: Number(row.version) + 1,
        updated_at: nowIso
      };
      this.store.upsertPlaybookScheduleRow(updatedScheduleRow);
      schedule = this.rowToSchedule(updatedScheduleRow);

      const failedRunRow: StoredScheduleRunRow = {
        id: this.nextId("scr"),
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        playbook_id: schedule.playbook_id,
        playbook_version_id: null,
        playbook_instantiation_id: null,
        resulting_mission_id: null,
        trigger_source: triggerSource,
        idempotency_key: idempotencyKey,
        status: "failed",
        resolved_variables_json: "{}",
        failure_reason: errorMessage,
        estimated_budget: 0,
        initiated_by: principal.user_id,
        initiated_at: nowIso,
        completed_at: nowIso
      };
      this.store.insertScheduleRunRow(failedRunRow);

      this.recordAuditEvent({
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        actor_id: principal.user_id,
        event_type: "schedule_run_failed",
        details: {
          run_id: failedRunRow.id,
          error: errorMessage,
          consecutive_failures_count: newFailures
        },
        now_iso: nowIso
      });

      if (tripBreaker) {
        this.recordAuditEvent({
          schedule_id: schedule.id,
          tenant_id: schedule.tenant_id,
          project_id: schedule.project_id,
          actor_id: principal.user_id,
          event_type: "schedule_circuit_breaker_tripped",
          details: {
            consecutive_failures_count: newFailures,
            consecutive_failures_limit: schedule.consecutive_failures_limit,
            reason: schedule.disabled_reason
          },
          now_iso: nowIso
        });
      }

      if (err instanceof PlaybookValidationError) {
        return {
          schedule,
          run: this.rowToScheduleRun(failedRunRow),
          mission_id: null,
          mission_status: null,
          instantiation_id: null
        };
      }
      throw err;
    }
  }

  /**
   * Authenticates and processes an incoming HMAC-SHA256 signed webhook trigger.
   */
  public receiveWebhookTrigger(
    input: WebhookTriggerInput
  ): ScheduleExecutionResult {
    const row = this.store.getPlaybookScheduleRow(input.schedule_id);
    if (!row) {
      throw new ScheduleNotFoundError(
        `Schedule '${input.schedule_id}' not found.`
      );
    }
    const schedule = this.rowToSchedule(row);
    if (schedule.trigger_type !== "webhook") {
      throw new ScheduleValidationError(
        `Schedule '${schedule.id}' does not accept webhook triggers (trigger_type is '${schedule.trigger_type}').`
      );
    }

    const { secret } = unsealWebhookSecret(row.webhook_secret_sha256);
    if (
      !secret ||
      !verifyWebhookSignature(input.raw_body, input.signature_header, secret)
    ) {
      throw new ScheduleWebhookSignatureError(
        `Invalid HMAC-SHA256 webhook signature for schedule '${schedule.id}'.`
      );
    }

    let parsedPayload: Record<string, unknown> = {};
    if (input.raw_body.trim().length > 0) {
      try {
        const parsed = JSON.parse(input.raw_body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsedPayload = parsed as Record<string, unknown>;
        }
      } catch {
        throw new ScheduleValidationError(
          "Webhook raw_body must be a valid JSON object."
        );
      }
    }

    const ownerPrincipal: TenantPrincipal = {
      user_id: schedule.owner_id,
      tenant_id: schedule.tenant_id,
      workspace_ids: ["ws_default"],
      role: "owner",
      mfa_verified: true,
      session_expires_at: Date.now() + 3600_000
    };

    const bodyHash = createHash("sha256")
      .update(input.raw_body, "utf8")
      .digest("hex")
      .slice(0, 16);

    return this.triggerScheduleNow({
      principal: ownerPrincipal,
      input: {
        schedule_id: schedule.id,
        tenant_id: schedule.tenant_id,
        project_id: schedule.project_id,
        actor_id: `webhook:${schedule.owner_id}`,
        trigger_source: "webhook",
        idempotency_key:
          input.idempotency_key?.trim() || `webhook:${schedule.id}:${bodyHash}`,
        payload: parsedPayload,
        now_iso: input.now_iso
      }
    });
  }

  /**
   * Evaluates all active event-driven schedules matching `event_topic` and `event_filter_json`.
   */
  public processEventTrigger(params: {
    principal: TenantPrincipal;
    input: SystemEventTriggerInput;
  }): ScheduleExecutionResult[] {
    const { principal, input } = params;
    this.assertPrincipalWriteAccess(principal);

    const rows = this.store.listPlaybookScheduleRows({
      tenant_id: principal.tenant_id,
      project_id: input.project_id,
      trigger_type: "event",
      status: "active",
      event_topic: input.event_topic
    });

    const results: ScheduleExecutionResult[] = [];
    for (const row of rows) {
      const schedule = this.rowToSchedule(row);
      const filters = schedule.event_filter_json;
      let matches = true;

      for (const [filterPath, expectedVal] of Object.entries(filters)) {
        const actualVal = extractSafePayloadPath(input.payload, filterPath);
        if (actualVal !== expectedVal) {
          matches = false;
          break;
        }
      }

      if (!matches) {
        continue;
      }

      const payloadDigest = createHash("sha256")
        .update(JSON.stringify(input.payload))
        .digest("hex")
        .slice(0, 16);

      const res = this.triggerScheduleNow({
        principal,
        input: {
          schedule_id: schedule.id,
          tenant_id: schedule.tenant_id,
          project_id: schedule.project_id,
          actor_id: input.actor_id,
          trigger_source: "event",
          idempotency_key:
            input.idempotency_key?.trim() ||
            `event:${schedule.id}:${input.event_topic}:${payloadDigest}`,
          payload: input.payload,
          now_iso: input.now_iso
        }
      });
      results.push(res);
    }

    return results;
  }

  /**
   * Evaluates all active cron/interval/one_time schedules whose `next_run_at <= now_iso`.
   */
  public evaluateDueSchedulesTick(params: {
    principal: TenantPrincipal;
    project_id?: string;
    now_iso?: string;
  }): ScheduleExecutionResult[] {
    const { principal } = params;
    this.assertPrincipalWriteAccess(principal);
    const nowIso = params.now_iso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    const rows = this.store.listPlaybookScheduleRows({
      tenant_id: principal.tenant_id,
      project_id: params.project_id,
      status: "active"
    });

    const results: ScheduleExecutionResult[] = [];
    for (const row of rows) {
      if (!row.next_run_at) continue;
      const nextMs = Date.parse(row.next_run_at);
      if (Number.isNaN(nextMs) || nextMs > nowMs) {
        continue;
      }

      const res = this.triggerScheduleNow({
        principal,
        input: {
          schedule_id: row.id,
          tenant_id: row.tenant_id,
          project_id: row.project_id,
          actor_id: principal.user_id,
          trigger_source: "cron_tick",
          idempotency_key: `tick:${row.id}:${row.next_run_at}`,
          now_iso: nowIso
        }
      });
      results.push(res);
    }

    return results;
  }
}
