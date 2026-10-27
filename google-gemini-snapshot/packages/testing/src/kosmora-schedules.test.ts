import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeNextCronRuns,
  extractSafePayloadPath,
  KosmoraEnterpriseSecurityEngine,
  KosmoraMissionControlService,
  KosmoraPlaybooksService,
  KosmoraRuntimeStore,
  KosmoraSchedulesService,
  ScheduleAccessDeniedError,
  ScheduleConcurrencyConflictError,
  ScheduleValidationError,
  ScheduleWebhookSignatureError,
  signWebhookPayload,
  validateCronExpression,
  verifyWebhookSignature,
  type TenantPrincipal
} from "@cosmora/core";
import {
  createKosmoraControlPlane,
  createKosmoraHttpServer
} from "../../../apps/api/src/kosmora-routes.js";
import KosmoraSchedulesPage, {
  buildSchedulesViewModel,
  KosmoraSchedulesPanel
} from "../../../apps/web/src/app/kosmora-workspace/schedules/page.js";

function makePrincipal(overrides?: Partial<TenantPrincipal>): TenantPrincipal {
  return {
    user_id: overrides?.user_id ?? "usr_sched_owner",
    tenant_id: overrides?.tenant_id ?? "tenant_sched_alpha",
    workspace_ids: overrides?.workspace_ids ?? ["ws_default"],
    role: overrides?.role ?? "owner",
    mfa_verified: overrides?.mfa_verified ?? true,
    session_expires_at: overrides?.session_expires_at ?? Date.now() + 3600_000
  };
}

let sharedHarness: ReturnType<typeof buildFreshHarness> | null = null;

function buildFreshHarness(dbPath = ":memory:") {
  const store = new KosmoraRuntimeStore(dbPath);
  const security = new KosmoraEnterpriseSecurityEngine();
  const missionControl = new KosmoraMissionControlService(store, security);
  const playbooks = new KosmoraPlaybooksService(store, security, missionControl);
  const schedules = new KosmoraSchedulesService(
    store,
    security,
    missionControl,
    playbooks
  );
  return { store, security, missionControl, playbooks, schedules };
}

function createSchedulesTestHarness(dbPath = ":memory:") {
  if (dbPath === ":memory:") {
    if (!sharedHarness) {
      sharedHarness = buildFreshHarness(":memory:");
    }
    return sharedHarness;
  }
  return buildFreshHarness(dbPath);
}

function collectTextFromReactNode(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectTextFromReactNode).join(" ");
  }
  if (typeof node === "object" && node !== null) {
    const rec = node as {
      type?: unknown;
      props?: Record<string, unknown>;
    };
    if (typeof rec.type === "function") {
      const rendered = (rec.type as (p: Record<string, unknown>) => unknown)(
        rec.props ?? {}
      );
      return collectTextFromReactNode(rendered);
    }
    if (rec.props && "children" in rec.props) {
      return collectTextFromReactNode(rec.props.children);
    }
  }
  return "";
}

describe("Kosmora Schedules & Triggers — Automated Playbook Execution Suite", () => {
  it("1. validates 5-field cron expressions and computes exact UTC next run timestamps", () => {
    const validWeekdays = validateCronExpression(
      "30 9 * * 1-5",
      "2026-10-26T08:00:00.000Z" // Monday
    );
    assert.equal(validWeekdays.valid, true);
    assert.equal(validWeekdays.normalized_expression, "30 9 * * 1-5");
    assert.equal(validWeekdays.next_runs_preview.length, 3);
    assert.equal(
      validWeekdays.next_runs_preview[0],
      "2026-10-26T09:30:00.000Z"
    );
    assert.equal(
      validWeekdays.next_runs_preview[1],
      "2026-10-27T09:30:00.000Z"
    );

    const stepRuns = computeNextCronRuns(
      "*/15 * * * *",
      "2026-10-26T10:02:00.000Z",
      3
    );
    assert.deepEqual(stepRuns, [
      "2026-10-26T10:15:00.000Z",
      "2026-10-26T10:30:00.000Z",
      "2026-10-26T10:45:00.000Z"
    ]);

    const invalid = validateCronExpression("65 25 * * *");
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.length > 0);
  });

  it("2. safely extracts nested payload paths and blocks prototype pollution segments", () => {
    const payload = {
      repository: {
        html_url: "https://github.com/nexus-os/kosmora",
        default_branch: "main"
      },
      release: {
        draft: false,
        commits_count: 12
      }
    };

    assert.equal(
      extractSafePayloadPath(payload, "repository.html_url"),
      "https://github.com/nexus-os/kosmora"
    );
    assert.equal(extractSafePayloadPath(payload, "release.draft"), false);
    assert.equal(extractSafePayloadPath(payload, "release.commits_count"), 12);
    assert.equal(
      extractSafePayloadPath(payload, "repository.missing_field"),
      undefined
    );

    assert.throws(
      () => extractSafePayloadPath(payload, "__proto__.polluted"),
      ScheduleValidationError
    );
    assert.throws(
      () => extractSafePayloadPath(payload, "repository.constructor.prototype"),
      ScheduleValidationError
    );
  });

  it("3. signs and verifies HMAC-SHA256 webhook payloads with timing-safe comparison", () => {
    const rawBody = JSON.stringify({ event: "push", ref: "refs/heads/main" });
    const secret = "whsec_test_secret_1234567890abcdef";
    const sig = signWebhookPayload(rawBody, secret);

    assert.ok(sig.startsWith("sha256="));
    assert.equal(verifyWebhookSignature(rawBody, sig, secret), true);
    assert.equal(
      verifyWebhookSignature(rawBody + " ", sig, secret),
      false
    );
    assert.equal(
      verifyWebhookSignature(rawBody, "sha256=deadbeef", secret),
      false
    );
  });

  it("4. creates cron, interval, one_time, webhook, and event schedules with optimistic concurrency", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const cronCreated = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_sched_1",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_market_research",
        title: "Будничный мониторинг рынка",
        trigger_type: "cron",
        cron_expression: "0 10 * * 1-5",
        default_variables_json: {
          project_name: "EdTech Platform",
          market: "EdTech",
          country: "Европа",
          deadline: "2026-11-30",
          budget: 25
        },
        now_iso: "2026-10-26T08:00:00.000Z"
      }
    });

    assert.equal(cronCreated.schedule.version, 1);
    assert.equal(
      cronCreated.schedule.next_run_at,
      "2026-10-26T10:00:00.000Z"
    );
    assert.equal(cronCreated.webhook_signing_secret, null);

    // Update schedule with matching expected_version
    const updated = schedules.updateSchedule({
      principal,
      input: {
        schedule_id: cronCreated.schedule.id,
        actor_id: principal.user_id,
        expected_version: 1,
        title: "Обновлённый мониторинг рынка",
        cron_expression: "30 11 * * 1-5",
        now_iso: "2026-10-26T08:00:00.000Z"
      }
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.title, "Обновлённый мониторинг рынка");
    assert.equal(updated.next_run_at, "2026-10-26T11:30:00.000Z");

    // Stale version update must throw ScheduleConcurrencyConflictError
    assert.throws(
      () =>
        schedules.updateSchedule({
          principal,
          input: {
            schedule_id: cronCreated.schedule.id,
            actor_id: principal.user_id,
            expected_version: 1,
            title: "Stale update"
          }
        }),
      ScheduleConcurrencyConflictError
    );
  });

  it("5. manually triggers a schedule, instantiates the Playbook into a real Mission Control mission, and auto-starts it", () => {
    const { schedules, missionControl } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const { schedule } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_sched_auto",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_market_research",
        title: "Автозапуск исследования рынка",
        trigger_type: "interval",
        interval_minutes: 60,
        auto_start_mission: true,
        default_variables_json: {
          project_name: "CyberSecurity AI",
          market: "EnterpriseAI",
          country: "США и ЕС",
          deadline: "2026-12-01",
          budget: 25
        },
        now_iso: "2026-10-26T12:00:00.000Z"
      }
    });

    const execRes = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: schedule.id,
        actor_id: principal.user_id,
        trigger_source: "manual",
        now_iso: "2026-10-26T12:05:00.000Z"
      }
    });

    assert.equal(execRes.run.status, "triggered");
    assert.ok(execRes.mission_id);
    assert.ok(execRes.instantiation_id);
    assert.equal(execRes.schedule.runs_today_count, 1);
    assert.ok(execRes.schedule.daily_budget_spent > 0);
    assert.equal(
      execRes.schedule.next_run_at,
      "2026-10-26T13:05:00.000Z"
    );

    const details = missionControl.getMissionDetails({
      principal,
      mission_id: execRes.mission_id!
    });
    // Because auto_start_mission=true, the mission ran autonomous tasks and reached waiting_for_review on final reviewer task
    assert.equal(details.mission.status, "waiting_for_review");
    assert.ok(details.tasks.length >= 4);
  });

  it("6. respects auto_start_mission=false by leaving the instantiated mission in 'ready' status", () => {
    const { schedules, missionControl } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const { schedule } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_sched_ready",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Создание миссии без автостарта",
        trigger_type: "interval",
        interval_minutes: 120,
        auto_start_mission: false,
        default_variables_json: {
          project_name: "kosmora-core",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "main",
          budget: 20
        }
      }
    });

    const execRes = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: schedule.id,
        actor_id: principal.user_id
      }
    });

    assert.equal(execRes.run.status, "triggered");
    assert.equal(execRes.mission_status, "ready");
    const details = missionControl.getMissionDetails({
      principal,
      mission_id: execRes.mission_id!
    });
    assert.equal(details.mission.status, "ready");
  });

  it("7. evaluates due cron and one_time schedules on tick and auto-pauses one_time schedules after execution", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const cronSch = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_tick",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_market_research",
        title: "Cron Tick Schedule",
        auto_start_mission: false,
        trigger_type: "cron",
        cron_expression: "0 9 * * *",
        default_variables_json: {
          project_name: "FinTech Hub",
          market: "FinTech",
          country: "LATAM",
          deadline: "2026-12-15",
          budget: 25
        },
        now_iso: "2026-10-26T08:00:00.000Z"
      }
    });

    const oneTimeSch = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_tick",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "One-Time Release Audit",
        auto_start_mission: false,
        trigger_type: "one_time",
        one_time_run_at: "2026-10-26T09:00:00.000Z",
        default_variables_json: {
          project_name: "kosmora-release",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "release/1.0",
          budget: 20
        },
        now_iso: "2026-10-26T08:00:00.000Z"
      }
    });

    // Tick at 08:30 -> neither is due
    const earlyTick = schedules.evaluateDueSchedulesTick({
      principal,
      project_id: "proj_tick",
      now_iso: "2026-10-26T08:30:00.000Z"
    });
    assert.equal(earlyTick.length, 0);

    // Tick at 09:00 -> both are due
    const dueTick = schedules.evaluateDueSchedulesTick({
      principal,
      project_id: "proj_tick",
      now_iso: "2026-10-26T09:00:00.000Z"
    });
    assert.equal(dueTick.length, 2);

    const updatedCron = schedules.getSchedule({
      principal,
      schedule_id: cronSch.schedule.id
    });
    assert.equal(updatedCron.status, "active");
    assert.equal(updatedCron.next_run_at, "2026-10-27T09:00:00.000Z");

    const updatedOneTime = schedules.getSchedule({
      principal,
      schedule_id: oneTimeSch.schedule.id
    });
    assert.equal(updatedOneTime.status, "paused");
    assert.equal(updatedOneTime.next_run_at, null);
  });

  it("8. processes HMAC-SHA256 signed webhooks, maps JSON payload paths to variables, redacts secrets, and rejects invalid signatures", () => {
    const { schedules, playbooks, missionControl } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const created = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_webhook",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_market_research",
        title: "CI/CD Webhook Trigger",
        trigger_type: "webhook",
        auto_start_mission: false,
        default_variables_json: {
          market: "EnterpriseAI",
          country: "Глобальный",
          deadline: "2026-12-10",
          budget: 25
        },
        variable_mappings_json: [
          {
            variable_key: "project_name",
            payload_path: "repository.name"
          },
          {
            variable_key: "source_url",
            payload_path: "repository.url",
            fallback_value: "https://github.com/nexus-os/kosmora"
          },
          {
            variable_key: "api_access_token",
            payload_path: "credentials.token"
          }
        ]
      }
    });

    assert.ok(created.webhook_signing_secret);
    assert.ok(created.schedule.webhook_secret_sha256);
    assert.equal(created.schedule.webhook_secret_sha256?.length, 64);

    const rawBody = JSON.stringify({
      repository: {
        name: "Kosmora Webhook Core",
        url: "https://github.com/nexus-os/kosmora-core"
      },
      credentials: { token: "super_secret_token_999" }
    });

    // Invalid signature must throw ScheduleWebhookSignatureError
    assert.throws(
      () =>
        schedules.receiveWebhookTrigger({
          schedule_id: created.schedule.id,
          signature_header: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
          raw_body: rawBody
        }),
      ScheduleWebhookSignatureError
    );

    // Valid signature triggers Playbook -> Mission instantiation
    const validSig = signWebhookPayload(
      rawBody,
      created.webhook_signing_secret!
    );
    const execRes = schedules.receiveWebhookTrigger({
      schedule_id: created.schedule.id,
      signature_header: validSig,
      raw_body: rawBody,
      idempotency_key: "wh_delivery_001"
    });

    assert.equal(execRes.run.status, "triggered");
    assert.equal(
      execRes.run.resolved_variables_json.project_name,
      "Kosmora Webhook Core"
    );
    assert.equal(
      execRes.run.resolved_variables_json.source_url,
      "https://github.com/nexus-os/kosmora-core"
    );
    // Secret variable MUST be redacted in stored ScheduleRun
    assert.equal(
      execRes.run.resolved_variables_json.api_access_token,
      "[REDACTED_SECRET]"
    );

    const missionDetails = missionControl.getMissionDetails({
      principal,
      mission_id: execRes.mission_id!
    });
    assert.equal(
      missionDetails.mission.title,
      "Исследование рынка EnterpriseAI для проекта Kosmora Webhook Core"
    );
  });

  it("9. rotates webhook signing secret and invalidates the old secret immediately", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const created = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_rotate",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Rotocorp Webhook",
        auto_start_mission: false,
        trigger_type: "webhook",
        default_variables_json: {
          project_name: "kosmora-core",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "main",
          budget: 20
        }
      }
    });

    const oldSecret = created.webhook_signing_secret!;
    const rotated = schedules.rotateWebhookSecret({
      principal,
      schedule_id: created.schedule.id
    });
    const newSecret = rotated.webhook_signing_secret!;
    assert.notEqual(oldSecret, newSecret);
    assert.notEqual(
      created.schedule.webhook_secret_sha256,
      rotated.schedule.webhook_secret_sha256
    );

    const rawBody = JSON.stringify({ ping: true });
    const oldSig = signWebhookPayload(rawBody, oldSecret);
    assert.throws(
      () =>
        schedules.receiveWebhookTrigger({
          schedule_id: created.schedule.id,
          signature_header: oldSig,
          raw_body: rawBody
        }),
      ScheduleWebhookSignatureError
    );

    const newSig = signWebhookPayload(rawBody, newSecret);
    const okRes = schedules.receiveWebhookTrigger({
      schedule_id: created.schedule.id,
      signature_header: newSig,
      raw_body: rawBody
    });
    assert.equal(okRes.run.status, "triggered");
  });

  it("10. matches system event triggers by event_topic and event_filter_json", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_events",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Триггер на критический алерт",
        auto_start_mission: false,
        trigger_type: "event",
        event_topic: "alert.triggered",
        event_filter_json: {
          "alert.severity": "critical",
          "alert.service": "payment-gateway"
        },
        default_variables_json: {
          project_name: "payments-gateway",
          repo_url: "https://github.com/nexus-os/payments",
          target_branch: "main",
          budget: 20
        }
      }
    });

    // Non-matching event filter -> 0 executions
    const ignored = schedules.processEventTrigger({
      principal,
      input: {
        tenant_id: principal.tenant_id,
        project_id: "proj_events",
        actor_id: principal.user_id,
        event_topic: "alert.triggered",
        payload: {
          alert: { severity: "low", service: "payment-gateway" }
        }
      }
    });
    assert.equal(ignored.length, 0);

    // Matching event filter -> 1 execution
    const matched = schedules.processEventTrigger({
      principal,
      input: {
        tenant_id: principal.tenant_id,
        project_id: "proj_events",
        actor_id: principal.user_id,
        event_topic: "alert.triggered",
        payload: {
          alert: { severity: "critical", service: "payment-gateway" }
        }
      }
    });
    assert.equal(matched.length, 1);
    assert.equal(matched[0]!.run.status, "triggered");
  });

  it("11. deduplicates repeated triggers with identical idempotency_key inside deduplication_window_seconds", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const { schedule } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_dedup",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Idempotent Schedule",
        auto_start_mission: false,
        trigger_type: "interval",
        interval_minutes: 60,
        deduplication_window_seconds: 300,
        default_variables_json: {
          project_name: "kosmora-core",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "main",
          budget: 20
        }
      }
    });

    const first = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: schedule.id,
        actor_id: principal.user_id,
        idempotency_key: "idem_key_alpha_1",
        now_iso: "2026-10-26T10:00:00.000Z"
      }
    });
    assert.equal(first.run.status, "triggered");

    // 60 seconds later with same idempotency_key -> skipped_dedup
    const second = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: schedule.id,
        actor_id: principal.user_id,
        idempotency_key: "idem_key_alpha_1",
        now_iso: "2026-10-26T10:01:00.000Z"
      }
    });
    assert.equal(second.run.status, "skipped_dedup");
    assert.equal(second.mission_id, first.mission_id);
    assert.equal(second.schedule.runs_today_count, 1);
  });

  it("12. enforces guardrails: max_runs_per_day, max_concurrent_missions, and daily_budget_limit", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    // 12a. max_runs_per_day = 1
    const { schedule: dailyLimitSch } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_guard",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Daily Limit Schedule",
        auto_start_mission: false,
        trigger_type: "interval",
        interval_minutes: 30,
        max_runs_per_day: 1,
        max_concurrent_missions: 5,
        daily_budget_limit: 100,
        default_variables_json: {
          project_name: "kosmora-core",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "main",
          budget: 20
        }
      }
    });

    const r1 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: dailyLimitSch.id,
        actor_id: principal.user_id,
        idempotency_key: "run_1"
      }
    });
    assert.equal(r1.run.status, "triggered");

    const r2 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: dailyLimitSch.id,
        actor_id: principal.user_id,
        idempotency_key: "run_2"
      }
    });
    assert.equal(r2.run.status, "blocked_daily_limit");
    assert.equal(r2.mission_id, null);

    // 12b. max_concurrent_missions = 1
    const { schedule: concSch } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_guard",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Concurrency Limit Schedule",
        auto_start_mission: false,
        trigger_type: "interval",
        interval_minutes: 30,
        max_runs_per_day: 10,
        max_concurrent_missions: 1,
        daily_budget_limit: 100,
        default_variables_json: {
          project_name: "kosmora-core",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "main",
          budget: 20
        }
      }
    });

    const c1 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: concSch.id,
        actor_id: principal.user_id,
        idempotency_key: "conc_1"
      }
    });
    assert.equal(c1.run.status, "triggered");

    const c2 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: concSch.id,
        actor_id: principal.user_id,
        idempotency_key: "conc_2"
      }
    });
    assert.equal(c2.run.status, "blocked_concurrency");
    assert.equal(c2.mission_id, null);

    // 12c. daily_budget_limit = 10 (planned_budget of repo_audit without deep_scan is 10.0, so 2nd run exceeds 10)
    const { schedule: budgetSch } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_guard",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Daily Budget Schedule",
        auto_start_mission: false,
        trigger_type: "interval",
        interval_minutes: 30,
        max_runs_per_day: 10,
        max_concurrent_missions: 10,
        daily_budget_limit: 20,
        default_variables_json: {
          project_name: "kosmora-core",
          repo_url: "https://github.com/nexus-os/kosmora",
          target_branch: "main",
          budget: 20
        }
      }
    });

    const b1 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: budgetSch.id,
        actor_id: principal.user_id,
        idempotency_key: "bud_1"
      }
    });
    assert.equal(b1.run.status, "triggered");

    const b2 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: budgetSch.id,
        actor_id: principal.user_id,
        idempotency_key: "bud_2"
      }
    });
    assert.equal(b2.run.status, "blocked_budget");
    assert.equal(b2.mission_id, null);
  });

  it("13. trips the circuit breaker (disabled_by_guardrail) after consecutive_failures_limit and recovers on resumeSchedule", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    // Missing required variable 'repo_url' in default_variables_json so instantiation fails validation
    const { schedule } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_cb",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Circuit Breaker Test Schedule",
        trigger_type: "interval",
        interval_minutes: 15,
        consecutive_failures_limit: 2,
        default_variables_json: {
          repo_url: "ftp://invalid-protocol-url"
        }
      }
    });

    const fail1 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: schedule.id,
        actor_id: principal.user_id,
        idempotency_key: "fail_1"
      }
    });
    assert.equal(fail1.run.status, "failed");
    assert.equal(fail1.schedule.consecutive_failures_count, 1);
    assert.equal(fail1.schedule.status, "active");

    const fail2 = schedules.triggerScheduleNow({
      principal,
      input: {
        schedule_id: schedule.id,
        actor_id: principal.user_id,
        idempotency_key: "fail_2"
      }
    });
    assert.equal(fail2.run.status, "failed");
    assert.equal(fail2.schedule.consecutive_failures_count, 2);
    assert.equal(fail2.schedule.status, "disabled_by_guardrail");
    assert.ok(fail2.schedule.disabled_reason?.includes("предохранителем"));

    // Subsequent trigger while disabled_by_guardrail is rejected
    assert.throws(
      () =>
        schedules.triggerScheduleNow({
          principal,
          input: {
            schedule_id: schedule.id,
            actor_id: principal.user_id,
            idempotency_key: "fail_3"
          }
        }),
      ScheduleValidationError
    );

    // Resume schedule resets status to 'active' and consecutive_failures_count to 0
    const resumed = schedules.resumeSchedule({
      principal,
      schedule_id: schedule.id
    });
    assert.equal(resumed.status, "active");
    assert.equal(resumed.consecutive_failures_count, 0);
    assert.equal(resumed.disabled_reason, null);
  });

  it("14. enforces RBAC (viewer role cannot create or trigger schedules) and cross-tenant isolation", () => {
    const { schedules } = createSchedulesTestHarness();
    const ownerA = makePrincipal({
      user_id: "usr_a",
      tenant_id: "tenant_a",
      role: "owner"
    });
    const viewerA = makePrincipal({
      user_id: "usr_viewer",
      tenant_id: "tenant_a",
      role: "viewer"
    });
    const ownerB = makePrincipal({
      user_id: "usr_b",
      tenant_id: "tenant_b",
      role: "owner"
    });

    const { schedule } = schedules.createSchedule({
      principal: ownerA,
      input: {
        project_id: "proj_rbac",
        owner_id: ownerA.user_id,
        playbook_id: "pbk_builtin_market_research",
        title: "Tenant A Schedule",
        trigger_type: "interval",
        interval_minutes: 60
      }
    });

    // Viewer cannot create or trigger
    assert.throws(
      () =>
        schedules.createSchedule({
          principal: viewerA,
          input: {
            project_id: "proj_rbac",
            owner_id: viewerA.user_id,
            playbook_id: "pbk_builtin_market_research",
            title: "Viewer Schedule",
            trigger_type: "interval",
            interval_minutes: 60
          }
        }),
      ScheduleAccessDeniedError
    );

    assert.throws(
      () =>
        schedules.triggerScheduleNow({
          principal: viewerA,
          input: {
            schedule_id: schedule.id,
            actor_id: viewerA.user_id
          }
        }),
      ScheduleAccessDeniedError
    );

    // Cross-tenant ownerB cannot read or trigger Tenant A schedule
    assert.throws(
      () =>
        schedules.getSchedule({
          principal: ownerB,
          schedule_id: schedule.id
        }),
      ScheduleAccessDeniedError
    );
  });

  it("15. persists schedules, runs, and audit events across SQLite store reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kosmora-sched-persist-"));
    const dbFile = join(tempDir, "schedules.db");

    try {
      const principal = makePrincipal();
      const h1 = createSchedulesTestHarness(dbFile);
      const created = h1.schedules.createSchedule({
        principal,
        input: {
          project_id: "proj_persist",
          owner_id: principal.user_id,
          playbook_id: "pbk_builtin_repository_audit",
          title: "Persistent Webhook Schedule",
          trigger_type: "webhook",
          auto_start_mission: false,
          default_variables_json: {
            project_name: "kosmora-persist",
            repo_url: "https://github.com/nexus-os/kosmora",
            target_branch: "main",
            budget: 20
          }
        }
      });
      const secret = created.webhook_signing_secret!;
      const schedId = created.schedule.id;
      h1.store.close();

      // Reopen on same SQLite file
      const h2 = createSchedulesTestHarness(dbFile);
      const rawBody = JSON.stringify({ action: "released" });
      const sig = signWebhookPayload(rawBody, secret);

      const execRes = h2.schedules.receiveWebhookTrigger({
        schedule_id: schedId,
        signature_header: sig,
        raw_body: rawBody
      });
      assert.equal(execRes.run.status, "triggered");

      const runs = h2.schedules.listScheduleRuns({
        principal,
        schedule_id: schedId
      });
      assert.equal(runs.length, 1);

      const audits = h2.schedules.listScheduleAuditEvents({
        principal,
        schedule_id: schedId
      });
      assert.ok(audits.length >= 2);
      h2.store.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("16. serves all /api/v1/schedules HTTP endpoints including unauthenticated HMAC webhook receiver", async () => {
    const ctx = createKosmoraControlPlane(":memory:");
    const server = createKosmoraHttpServer(ctx);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const token = ctx.security.issueSignedSessionToken({
        user_id: "usr_http_sched",
        tenant_id: "tenant_http_sched",
        workspace_ids: ["ws_default"],
        role: "owner",
        mfa_verified: true,
        session_expires_at: Date.now() + 3600_000
      }).token;
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      };

      // 1. Validate Cron via HTTP
      const cronRes = await fetch(`${baseUrl}/api/v1/schedules/validate-cron`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          cron_expression: "0 8 * * 1-5",
          reference_iso: "2026-10-26T06:00:00.000Z"
        })
      });
      assert.equal(cronRes.status, 200);
      const cronJson = (await cronRes.json()) as {
        valid: boolean;
        next_runs_preview: string[];
      };
      assert.equal(cronJson.valid, true);
      assert.equal(cronJson.next_runs_preview[0], "2026-10-26T08:00:00.000Z");

      // 2. Create Webhook Schedule via HTTP POST /api/v1/schedules
      const createRes = await fetch(`${baseUrl}/api/v1/schedules`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project_id: "proj_http_1",
          playbook_id: "pbk_builtin_repository_audit",
          title: "HTTP Webhook Audit Schedule",
        auto_start_mission: false,
          trigger_type: "webhook",
          default_variables_json: {
            project_name: "kosmora-http",
            target_branch: "main",
            budget: 20
          },
          variable_mappings_json: [
            {
              variable_key: "repo_url",
              payload_path: "repo.url",
              fallback_value: "https://github.com/nexus-os/kosmora"
            }
          ]
        })
      });
      assert.equal(createRes.status, 201);
      const createdBody = (await createRes.json()) as {
        schedule: { id: string; version: number };
        webhook_signing_secret: string;
      };
      const scheduleId = createdBody.schedule.id;
      const signingSecret = createdBody.webhook_signing_secret;
      assert.ok(signingSecret.startsWith("whsec_"));

      // 3. Trigger Webhook WITHOUT Bearer token using X-Kosmora-Signature-256
      const webhookPayload = JSON.stringify({
        repo: { url: "https://github.com/nexus-os/kosmora-api" }
      });
      const validSig = signWebhookPayload(webhookPayload, signingSecret);

      const whRes = await fetch(
        `${baseUrl}/api/v1/schedules/${scheduleId}/webhook`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kosmora-signature-256": validSig,
            "x-kosmora-idempotency-key": "http_wh_1"
          },
          body: webhookPayload
        }
      );
      assert.equal(whRes.status, 201);
      const whData = (await whRes.json()) as {
        run: { status: string };
        mission_id: string;
      };
      assert.equal(whData.run.status, "triggered");
      assert.ok(whData.mission_id);

      // 4. Reject invalid webhook signature with HTTP 401
      const badWhRes = await fetch(
        `${baseUrl}/api/v1/schedules/${scheduleId}/webhook`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kosmora-signature-256": "sha256=invalid"
          },
          body: webhookPayload
        }
      );
      assert.equal(badWhRes.status, 401);

      // 5. Pause & Resume via HTTP
      const pauseRes = await fetch(
        `${baseUrl}/api/v1/schedules/${scheduleId}/pause`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ reason: "Плановое окно обслуживания" })
        }
      );
      assert.equal(pauseRes.status, 200);
      const pausedJson = (await pauseRes.json()) as {
        schedule: { status: string };
      };
      assert.equal(pausedJson.schedule.status, "paused");

      const resumeRes = await fetch(
        `${baseUrl}/api/v1/schedules/${scheduleId}/resume`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ reset_daily_counters: true })
        }
      );
      assert.equal(resumeRes.status, 200);
      const resumedJson = (await resumeRes.json()) as {
        schedule: { status: string; runs_today_count: number };
      };
      assert.equal(resumedJson.schedule.status, "active");
      assert.equal(resumedJson.schedule.runs_today_count, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.store.close();
    }
  });

  it("17. renders monochrome Russian UI in active, empty, loading, error, and circuit_breaker states without forbidden colors", () => {
    const activeVm = buildSchedulesViewModel({ mode: "active" });
    const activeTree = KosmoraSchedulesPanel({ viewModel: activeVm });
    const activeText = collectTextFromReactNode(activeTree);

    assert.ok(
      activeText.includes("Расписания и автоматические триггеры плейбуков")
    );
    assert.ok(
      activeText.includes("Ежедневный мониторинг рынка ИИ-агентов")
    );
    assert.ok(activeText.includes("Предохранители и квоты расписания"));
    assert.ok(activeText.includes("msn_auto_market_01"));

    const cbVm = buildSchedulesViewModel({ mode: "circuit_breaker" });
    const cbText = collectTextFromReactNode(
      KosmoraSchedulesPanel({ viewModel: cbVm })
    );
    assert.ok(cbText.includes("ОТКЛЮЧЕНО ПРЕДОХРАНИТЕЛЕМ"));

    const emptyVm = buildSchedulesViewModel({ mode: "empty" });
    const emptyText = collectTextFromReactNode(
      KosmoraSchedulesPanel({ viewModel: emptyVm })
    );
    assert.ok(emptyText.includes("Нет настроенных расписаний и триггеров"));

    const pageTree = KosmoraSchedulesPage();
    const pageText = collectTextFromReactNode(pageTree);
    assert.ok(
      pageText.includes("Расписания и автоматические триггеры плейбуков")
    );
  });

  it("18. archives a schedule, clears next_run_at, and prevents subsequent edits or triggers", () => {
    const { schedules } = createSchedulesTestHarness();
    const principal = makePrincipal();

    const { schedule } = schedules.createSchedule({
      principal,
      input: {
        project_id: "proj_archive",
        owner_id: principal.user_id,
        playbook_id: "pbk_builtin_repository_audit",
        title: "Archivable Schedule",
        trigger_type: "cron",
        cron_expression: "0 12 * * *",
        auto_start_mission: false,
        now_iso: "2026-10-26T08:00:00.000Z"
      }
    });

    const archived = schedules.archiveSchedule({
      principal,
      schedule_id: schedule.id,
      now_iso: "2026-10-26T09:00:00.000Z"
    });
    assert.equal(archived.status, "archived");
    assert.equal(archived.next_run_at, null);
    assert.equal(archived.archived_at, "2026-10-26T09:00:00.000Z");

    assert.throws(
      () =>
        schedules.triggerScheduleNow({
          principal,
          input: {
            schedule_id: schedule.id,
            actor_id: principal.user_id
          }
        }),
      ScheduleValidationError
    );

    assert.throws(
      () =>
        schedules.updateSchedule({
          principal,
          input: {
            schedule_id: schedule.id,
            actor_id: principal.user_id,
            expected_version: archived.version,
            title: "Should fail"
          }
        }),
      ScheduleValidationError
    );
  });

  it("19. supports Sunday=7 normalization, comma lists, and step ranges in 5-field cron", () => {
    const res = validateCronExpression(
      "0,30 8-16/4 * * 0,7",
      "2026-10-25T07:00:00.000Z" // Sunday
    );
    assert.equal(res.valid, true);
    assert.deepEqual(res.next_runs_preview, [
      "2026-10-25T08:00:00.000Z",
      "2026-10-25T08:30:00.000Z",
      "2026-10-25T12:00:00.000Z"
    ]);
  });

  it("20. verifies strict monochrome palette constants in KosmoraSchedulesPanel", () => {
    const vm = buildSchedulesViewModel({ mode: "active" });
    assert.equal(vm.theme.background_primary, "#0A0A0A");
    assert.equal(vm.theme.surface_elevated, "#111111");
    assert.equal(vm.theme.border_subtle, "#262626");
    assert.equal(vm.theme.text_primary, "#FAFAFA");
    assert.equal(vm.theme.text_secondary, "#A3A3A3");
  });
});
