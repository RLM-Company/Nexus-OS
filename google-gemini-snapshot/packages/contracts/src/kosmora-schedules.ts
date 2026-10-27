/**
 * @cosmora/contracts — Kosmora Schedules & Triggers Contracts
 * Automated execution of published Playbooks into Mission Control missions via
 * Cron/Interval/One-Time schedules, HMAC-SHA256 signed Webhooks, and System Events,
 * with budget/concurrency/daily-run guardrails, idempotency deduplication, and circuit breakers.
 */

import type { MissionPriority } from "./kosmora-mission-control.js";

export const SCHEDULE_TRIGGER_TYPES = [
  "cron",
  "interval",
  "one_time",
  "webhook",
  "event"
] as const;

export type ScheduleTriggerType = (typeof SCHEDULE_TRIGGER_TYPES)[number];

export const SCHEDULE_STATUSES = [
  "active",
  "paused",
  "disabled_by_guardrail",
  "archived"
] as const;

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_RUN_SOURCES = [
  "cron_tick",
  "manual",
  "webhook",
  "event"
] as const;

export type ScheduleRunSource = (typeof SCHEDULE_RUN_SOURCES)[number];

export const SCHEDULE_RUN_STATUSES = [
  "triggered",
  "skipped_dedup",
  "blocked_budget",
  "blocked_concurrency",
  "blocked_daily_limit",
  "failed"
] as const;

export type ScheduleRunStatus = (typeof SCHEDULE_RUN_STATUSES)[number];

export const SCHEDULE_AUDIT_EVENT_TYPES = [
  "schedule_created",
  "schedule_updated",
  "schedule_paused",
  "schedule_resumed",
  "schedule_archived",
  "schedule_secret_rotated",
  "schedule_triggered",
  "schedule_run_skipped_dedup",
  "schedule_guardrail_blocked",
  "schedule_circuit_breaker_tripped",
  "schedule_run_failed"
] as const;

export type ScheduleAuditEventType = (typeof SCHEDULE_AUDIT_EVENT_TYPES)[number];

export const SCHEDULE_EVENT_TOPICS = [
  "mission.completed",
  "mission.failed",
  "artifact.created",
  "playbook.published",
  "repository.push",
  "alert.triggered"
] as const;

export type ScheduleEventTopic = (typeof SCHEDULE_EVENT_TOPICS)[number] | string;

export interface ScheduleVariableMapping {
  variable_key: string;
  payload_path: string;
  fallback_value?: string | number | boolean;
}

export interface PlaybookSchedule {
  id: string;
  tenant_id: string;
  project_id: string;
  owner_id: string;
  playbook_id: string;
  /** If null, uses the latest published version of `playbook_id` at trigger time */
  playbook_version_number: number | null;
  title: string;
  description: string;
  trigger_type: ScheduleTriggerType;
  cron_expression: string | null;
  interval_minutes: number | null;
  one_time_run_at: string | null;
  timezone: string;
  event_topic: ScheduleEventTopic | null;
  event_filter_json: Record<string, string | number | boolean>;
  webhook_secret_sha256: string | null;
  webhook_signing_secret_preview: string | null;
  default_variables_json: Record<string, string | number | boolean>;
  variable_mappings_json: ScheduleVariableMapping[];
  auto_start_mission: boolean;
  mission_priority?: MissionPriority;
  mission_title_override?: string | null;
  max_runs_per_day: number;
  runs_today_count: number;
  max_concurrent_missions: number;
  daily_budget_limit: number;
  daily_budget_spent: number;
  consecutive_failures_limit: number;
  consecutive_failures_count: number;
  deduplication_window_seconds: number;
  status: ScheduleStatus;
  disabled_reason: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  tenant_id: string;
  project_id: string;
  playbook_id: string;
  playbook_version_id: string | null;
  playbook_instantiation_id: string | null;
  resulting_mission_id: string | null;
  trigger_source: ScheduleRunSource;
  idempotency_key: string;
  status: ScheduleRunStatus;
  resolved_variables_json: Record<string, string | number | boolean>;
  failure_reason: string | null;
  estimated_budget: number;
  initiated_by: string;
  initiated_at: string;
  completed_at: string;
}

export interface ScheduleAuditEvent {
  id: string;
  schedule_id: string;
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_type: ScheduleAuditEventType;
  details_json: Record<string, unknown>;
  created_at: string;
}

export interface CreatePlaybookScheduleInput {
  tenant_id?: string;
  project_id: string;
  owner_id: string;
  playbook_id: string;
  playbook_version_number?: number | null;
  title: string;
  description?: string;
  trigger_type: ScheduleTriggerType;
  cron_expression?: string | null;
  interval_minutes?: number | null;
  one_time_run_at?: string | null;
  timezone?: string;
  event_topic?: ScheduleEventTopic | null;
  event_filter_json?: Record<string, string | number | boolean>;
  default_variables_json?: Record<string, string | number | boolean>;
  variable_mappings_json?: ScheduleVariableMapping[];
  auto_start_mission?: boolean;
  mission_priority?: MissionPriority;
  mission_title_override?: string | null;
  max_runs_per_day?: number;
  max_concurrent_missions?: number;
  daily_budget_limit?: number;
  consecutive_failures_limit?: number;
  deduplication_window_seconds?: number;
  now_iso?: string;
}

export interface CreatePlaybookScheduleResult {
  schedule: PlaybookSchedule;
  /** Returned only on creation or rotation for webhook triggers */
  webhook_signing_secret: string | null;
}

export interface UpdatePlaybookScheduleInput {
  schedule_id: string;
  tenant_id?: string;
  project_id?: string;
  actor_id: string;
  expected_version: number;
  title?: string;
  description?: string;
  playbook_version_number?: number | null;
  trigger_type?: ScheduleTriggerType;
  cron_expression?: string | null;
  interval_minutes?: number | null;
  one_time_run_at?: string | null;
  timezone?: string;
  event_topic?: ScheduleEventTopic | null;
  event_filter_json?: Record<string, string | number | boolean>;
  default_variables_json?: Record<string, string | number | boolean>;
  variable_mappings_json?: ScheduleVariableMapping[];
  auto_start_mission?: boolean;
  mission_priority?: MissionPriority;
  mission_title_override?: string | null;
  max_runs_per_day?: number;
  max_concurrent_missions?: number;
  daily_budget_limit?: number;
  consecutive_failures_limit?: number;
  deduplication_window_seconds?: number;
  now_iso?: string;
}

export interface TriggerScheduleInput {
  schedule_id: string;
  tenant_id?: string;
  project_id?: string;
  actor_id: string;
  trigger_source?: ScheduleRunSource;
  idempotency_key?: string;
  override_variables?: Record<string, string | number | boolean>;
  payload?: Record<string, unknown>;
  now_iso?: string;
}

export interface WebhookTriggerInput {
  schedule_id: string;
  signature_header: string;
  raw_body: string;
  idempotency_key?: string;
  now_iso?: string;
}

export interface SystemEventTriggerInput {
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_topic: ScheduleEventTopic;
  payload: Record<string, unknown>;
  idempotency_key?: string;
  now_iso?: string;
}

export interface ScheduleExecutionResult {
  schedule: PlaybookSchedule;
  run: ScheduleRun;
  mission_id: string | null;
  mission_status: string | null;
  instantiation_id: string | null;
}

export interface CronValidationResult {
  valid: boolean;
  errors: string[];
  normalized_expression: string | null;
  next_runs_preview: string[];
}
