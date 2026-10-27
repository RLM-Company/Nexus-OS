import React, { useState } from "react";
import {
  validateCronExpression,
  type PlaybookSchedule,
  type ScheduleAuditEvent,
  type ScheduleRun,
  type ScheduleStatus,
  type ScheduleTriggerType
} from "@cosmora/core";

export const KOSMORA_SCHEDULES_MONOCHROME_PALETTE = {
  background_primary: "#0A0A0A",
  surface_elevated: "#111111",
  border_subtle: "#262626",
  text_primary: "#FAFAFA",
  text_secondary: "#A3A3A3"
} as const;

export const TRIGGER_TYPE_LABELS_RU: Record<ScheduleTriggerType, string> = {
  cron: "CRON-РАСПИСАНИЕ",
  interval: "ИНТЕРВАЛ",
  one_time: "ОДНОКРАТНЫЙ ЗАПУСК",
  webhook: "ВЕБХУК (HMAC-SHA256)",
  event: "СИСТЕМНОЕ СОБЫТИЕ"
};

export const SCHEDULE_STATUS_LABELS_RU: Record<ScheduleStatus, string> = {
  active: "АКТИВНО",
  paused: "НА ПАУЗЕ",
  disabled_by_guardrail: "ОТКЛЮЧЕНО ПРЕДОХРАНИТЕЛЕМ",
  archived: "В АРХИВЕ"
};

export const RUN_STATUS_LABELS_RU: Record<string, string> = {
  triggered: "МИССИЯ СОЗДАНА",
  skipped_dedup: "ПРОПУЩЕНО (ДЕДУПЛИКАЦИЯ)",
  blocked_budget: "БЛОКИРОВКА: ДНЕВНОЙ БЮДЖЕТ",
  blocked_concurrency: "БЛОКИРОВКА: ПАРАЛЛЕЛЬНОСТЬ",
  blocked_daily_limit: "БЛОКИРОВКА: ДНЕВНОЙ ЛИМИТ",
  failed: "ОШИБКА ЗАПУСКА"
};

export interface SchedulesViewModel {
  theme: typeof KOSMORA_SCHEDULES_MONOCHROME_PALETTE;
  mode: "active" | "empty" | "loading" | "error" | "circuit_breaker";
  error_message: string | null;
  filter_tab:
    | "all"
    | "cron"
    | "interval"
    | "webhook"
    | "event"
    | "paused"
    | "guardrail";
  schedules: PlaybookSchedule[];
  selected_schedule: PlaybookSchedule | null;
  runs: ScheduleRun[];
  audit_events: ScheduleAuditEvent[];
  cron_preview: {
    expression: string;
    valid: boolean;
    next_runs: string[];
    errors: string[];
  };
}

export function buildSchedulesViewModel(options?: {
  mode?: "active" | "empty" | "loading" | "error" | "circuit_breaker";
  error_message?: string;
  filter_tab?: SchedulesViewModel["filter_tab"];
  schedules?: PlaybookSchedule[];
  selected_schedule_id?: string;
  runs?: ScheduleRun[];
  audit_events?: ScheduleAuditEvent[];
  cron_expression?: string;
}): SchedulesViewModel {
  const mode = options?.mode ?? "active";
  const cronExpr = options?.cron_expression ?? "0 9 * * 1-5";
  const cronCheck = validateCronExpression(
    cronExpr,
    "2026-10-27T08:00:00.000Z"
  );

  const defaultSchedules: PlaybookSchedule[] =
    mode === "empty" || mode === "loading"
      ? []
      : [
          {
            id: "sch_daily_market_research",
            tenant_id: "tenant_default",
            project_id: "proj_default",
            owner_id: "usr_owner",
            playbook_id: "pbk_builtin_market_research",
            playbook_version_number: 1,
            title: "Ежедневный мониторинг рынка ИИ-агентов",
            description:
              "Автоматический запуск плейбука «Исследование рынка» по будням в 09:00 UTC с созданием миссии в Mission Control.",
            trigger_type: "cron",
            cron_expression: "0 9 * * 1-5",
            interval_minutes: null,
            one_time_run_at: null,
            timezone: "UTC",
            event_topic: null,
            event_filter_json: {},
            webhook_secret_sha256: null,
            webhook_signing_secret_preview: null,
            default_variables_json: {
              project_name: "Kosmora Enterprise AI",
              market: "EnterpriseAI",
              country: "Россия и СНГ",
              deadline: "2026-12-01",
              budget: 25
            },
            variable_mappings_json: [],
            auto_start_mission: true,
            mission_priority: "high",
            mission_title_override: null,
            max_runs_per_day: 5,
            runs_today_count: 2,
            max_concurrent_missions: 2,
            daily_budget_limit: 100,
            daily_budget_spent: 37,
            consecutive_failures_limit: 3,
            consecutive_failures_count: mode === "circuit_breaker" ? 3 : 0,
            deduplication_window_seconds: 300,
            status:
              mode === "circuit_breaker" ? "disabled_by_guardrail" : "active",
            disabled_reason:
              mode === "circuit_breaker"
                ? "Автоматическое отключение предохранителем после 3 ошибок подряд"
                : null,
            last_run_at: "2026-10-27T09:00:00.000Z",
            next_run_at:
              mode === "circuit_breaker"
                ? null
                : "2026-10-28T09:00:00.000Z",
            version: 2,
            created_at: "2026-10-26T10:00:00.000Z",
            updated_at: "2026-10-27T09:00:00.000Z",
            archived_at: null
          },
          {
            id: "sch_webhook_repo_audit",
            tenant_id: "tenant_default",
            project_id: "proj_default",
            owner_id: "usr_owner",
            playbook_id: "pbk_builtin_repository_audit",
            playbook_version_number: 1,
            title: "Аудит безопасности при релизном вебхуке",
            description:
              "Принимает подписанный HMAC-SHA256 вебхук от CI/CD и запускает плейбук «Аудит репозитория».",
            trigger_type: "webhook",
            cron_expression: null,
            interval_minutes: null,
            one_time_run_at: null,
            timezone: "UTC",
            event_topic: null,
            event_filter_json: {},
            webhook_secret_sha256:
              "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            webhook_signing_secret_preview: "whsec_8a91...4f2c",
            default_variables_json: {
              project_name: "nexus-os-core",
              target_branch: "main",
              budget: 20
            },
            variable_mappings_json: [
              {
                variable_key: "repo_url",
                payload_path: "repository.html_url",
                fallback_value: "https://github.com/nexus-os/kosmora"
              },
              {
                variable_key: "target_branch",
                payload_path: "release.target_commitish",
                fallback_value: "main"
              }
            ],
            auto_start_mission: true,
            mission_priority: "critical",
            mission_title_override: null,
            max_runs_per_day: 10,
            runs_today_count: 1,
            max_concurrent_missions: 3,
            daily_budget_limit: 120,
            daily_budget_spent: 16,
            consecutive_failures_limit: 3,
            consecutive_failures_count: 0,
            deduplication_window_seconds: 600,
            status: "active",
            disabled_reason: null,
            last_run_at: "2026-10-27T11:30:00.000Z",
            next_run_at: null,
            version: 1,
            created_at: "2026-10-26T12:00:00.000Z",
            updated_at: "2026-10-27T11:30:00.000Z",
            archived_at: null
          }
        ];

  const schedules = options?.schedules ?? defaultSchedules;
  const selected =
    schedules.find((s) => s.id === options?.selected_schedule_id) ??
    schedules[0] ??
    null;

  const defaultRuns: ScheduleRun[] =
    selected === null
      ? []
      : [
          {
            id: "scr_run_01",
            schedule_id: selected.id,
            tenant_id: selected.tenant_id,
            project_id: selected.project_id,
            playbook_id: selected.playbook_id,
            playbook_version_id: `${selected.playbook_id}_v1`,
            playbook_instantiation_id: "pbi_auto_01",
            resulting_mission_id: "msn_auto_market_01",
            trigger_source:
              selected.trigger_type === "webhook" ? "webhook" : "cron_tick",
            idempotency_key: `tick:${selected.id}:2026-10-27T09:00:00.000Z`,
            status: "triggered",
            resolved_variables_json: selected.default_variables_json,
            failure_reason: null,
            estimated_budget: 18.5,
            initiated_by: selected.owner_id,
            initiated_at: "2026-10-27T09:00:00.000Z",
            completed_at: "2026-10-27T09:00:01.000Z"
          },
          {
            id: "scr_run_02",
            schedule_id: selected.id,
            tenant_id: selected.tenant_id,
            project_id: selected.project_id,
            playbook_id: selected.playbook_id,
            playbook_version_id: `${selected.playbook_id}_v1`,
            playbook_instantiation_id: "pbi_auto_01",
            resulting_mission_id: "msn_auto_market_01",
            trigger_source: "webhook",
            idempotency_key: `tick:${selected.id}:2026-10-27T09:00:00.000Z`,
            status: "skipped_dedup",
            resolved_variables_json: selected.default_variables_json,
            failure_reason:
              "Повторный запрос отфильтрован окном идемпотентности (300 сек).",
            estimated_budget: 0,
            initiated_by: selected.owner_id,
            initiated_at: "2026-10-27T09:01:10.000Z",
            completed_at: "2026-10-27T09:01:10.000Z"
          }
        ];

  return {
    theme: KOSMORA_SCHEDULES_MONOCHROME_PALETTE,
    mode,
    error_message:
      mode === "error"
        ? options?.error_message ??
          "Не удалось загрузить расписания или выполнить триггер."
        : null,
    filter_tab: options?.filter_tab ?? "all",
    schedules,
    selected_schedule: selected,
    runs: options?.runs ?? defaultRuns,
    audit_events: options?.audit_events ?? [],
    cron_preview: {
      expression: cronExpr,
      valid: cronCheck.valid,
      next_runs: cronCheck.next_runs_preview,
      errors: cronCheck.errors
    }
  };
}

export function KosmoraSchedulesPanel(props: {
  viewModel?: SchedulesViewModel;
}): React.ReactElement {
  const vm = props.viewModel ?? buildSchedulesViewModel();
  const { theme } = vm;

  const [activeFilter, setActiveFilter] = useState<
    SchedulesViewModel["filter_tab"]
  >(vm.filter_tab);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(
    vm.selected_schedule?.id ?? ""
  );
  const [newTitle, setNewTitle] = useState<string>(
    "Регулярный аудит безопасности репозитория"
  );
  const [newTriggerType, setNewTriggerType] =
    useState<ScheduleTriggerType>("cron");
  const [newCronExpr, setNewCronExpr] = useState<string>(
    vm.cron_preview.expression
  );

  const liveCronValidation = validateCronExpression(
    newCronExpr,
    "2026-10-27T08:00:00.000Z"
  );

  const selected =
    vm.schedules.find((s) => s.id === selectedScheduleId) ??
    vm.selected_schedule;

  return (
    <div
      style={{
        backgroundColor: theme.background_primary,
        color: theme.text_primary,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}
    >
      {/* Верхняя шапка и навигация */}
      <header
        style={{
          borderBottom: `1px solid ${theme.border_subtle}`,
          paddingBottom: "20px",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px"
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11px",
              color: theme.text_secondary,
              letterSpacing: "0.08em",
              textTransform: "uppercase"
            }}
          >
            NEXUS-OS / KOSMORA SCHEDULES & TRIGGERS
          </div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 600,
              margin: "6px 0 8px 0",
              color: theme.text_primary
            }}
          >
            Расписания и автоматические триггеры плейбуков
          </h1>
          <p
            style={{
              fontSize: "13px",
              color: theme.text_secondary,
              margin: 0
            }}
          >
            Автоматическое создание и запуск миссий Mission Control по Cron,
            интервалам, подписанным вебхукам HMAC-SHA256 и системным событиям с
            бюджетными предохранителями.
          </p>
        </div>

        <nav
          aria-label="Переходы по разделам Kosmora"
          style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}
        >
          <a
            href="/kosmora-workspace"
            style={{
              backgroundColor: theme.surface_elevated,
              color: theme.text_primary,
              border: `1px solid ${theme.border_subtle}`,
              padding: "8px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            Рабочее пространство
          </a>
          <a
            href="/kosmora-workspace/playbooks"
            style={{
              backgroundColor: theme.surface_elevated,
              color: theme.text_primary,
              border: `1px solid ${theme.border_subtle}`,
              padding: "8px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              textDecoration: "none"
            }}
          >
            Каталог плейбуков
          </a>
          <a
            href="/kosmora-workspace/missions"
            style={{
              backgroundColor: theme.text_primary,
              color: theme.background_primary,
              border: `1px solid ${theme.text_primary}`,
              padding: "8px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none"
            }}
          >
            Центр управления миссиями
          </a>
        </nav>
      </header>

      {/* Баннер ошибки или загрузки */}
      {vm.mode === "loading" && (
        <section
          aria-busy="true"
          style={{
            backgroundColor: theme.surface_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "24px"
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: 600 }}>
            Загрузка расписаний и состояния предохранителей...
          </div>
          <div
            style={{
              fontSize: "12px",
              color: theme.text_secondary,
              marginTop: "6px"
            }}
          >
            Синхронизация очереди Cron-тиков, истории вебхуков и лимитов
            бюджета.
          </div>
        </section>
      )}

      {vm.error_message && (
        <section
          role="alert"
          style={{
            backgroundColor: theme.surface_elevated,
            border: `1px solid ${theme.text_primary}`,
            borderRadius: "8px",
            padding: "16px 20px",
            marginBottom: "24px"
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 600 }}>
            Ошибка управления расписанием
          </div>
          <div
            style={{
              fontSize: "12px",
              color: theme.text_secondary,
              marginTop: "4px"
            }}
          >
            {vm.error_message}
          </div>
        </section>
      )}

      {/* Панель фильтров */}
      <section
        aria-label="Фильтры расписаний"
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          marginBottom: "24px"
        }}
      >
        {(
          [
            { key: "all", label: "Все расписания" },
            { key: "cron", label: "Cron" },
            { key: "interval", label: "Интервал" },
            { key: "webhook", label: "Вебхуки HMAC" },
            { key: "event", label: "События" },
            { key: "paused", label: "На паузе" },
            { key: "guardrail", label: "Сработал предохранитель" }
          ] as const
        ).map((tab) => {
          const isCurrent = activeFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveFilter(tab.key)}
              style={{
                backgroundColor: isCurrent
                  ? theme.text_primary
                  : theme.surface_elevated,
                color: isCurrent
                  ? theme.background_primary
                  : theme.text_primary,
                border: `1px solid ${
                  isCurrent ? theme.text_primary : theme.border_subtle
                }`,
                borderRadius: "6px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: isCurrent ? 600 : 400,
                cursor: "pointer"
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </section>

      {vm.schedules.length === 0 && vm.mode !== "loading" ? (
        <section
          style={{
            backgroundColor: theme.surface_elevated,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "8px",
            padding: "32px",
            textAlign: "center",
            marginBottom: "24px"
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 8px 0" }}>
            Нет настроенных расписаний и триггеров
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: theme.text_secondary,
              margin: 0
            }}
          >
            Создайте первое Cron-расписание, интервальный запуск или
            HMAC-вебхук в форме ниже, чтобы автоматически создавать миссии из
            опубликованных плейбуков.
          </p>
        </section>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(300px, 1fr) minmax(420px, 1.6fr)",
            gap: "24px",
            marginBottom: "28px"
          }}
        >
          {/* Левая колонка: список расписаний */}
          <section aria-label="Список расписаний">
            <h2
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginTop: 0,
                marginBottom: "12px"
              }}
            >
              Активные и приостановленные триггеры ({vm.schedules.length})
            </h2>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {vm.schedules.map((sch) => {
                const isSelected = selected?.id === sch.id;
                return (
                  <article
                    key={sch.id}
                    onClick={() => setSelectedScheduleId(sch.id)}
                    style={{
                      backgroundColor: theme.surface_elevated,
                      border: `1px solid ${
                        isSelected ? theme.text_primary : theme.border_subtle
                      }`,
                      borderRadius: "8px",
                      padding: "16px",
                      cursor: "pointer"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "8px"
                      }}
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "ui-monospace, monospace",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          border: `1px solid ${theme.border_subtle}`,
                          color: theme.text_secondary
                        }}
                      >
                        {TRIGGER_TYPE_LABELS_RU[sch.trigger_type]}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontFamily: "ui-monospace, monospace",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          backgroundColor:
                            sch.status === "active"
                              ? theme.text_primary
                              : theme.background_primary,
                          color:
                            sch.status === "active"
                              ? theme.background_primary
                              : theme.text_primary,
                          border: `1px solid ${theme.text_primary}`,
                          fontWeight: 600
                        }}
                      >
                        {SCHEDULE_STATUS_LABELS_RU[sch.status]}
                      </span>
                    </div>

                    <h3
                      style={{
                        fontSize: "15px",
                        fontWeight: 600,
                        margin: "0 0 6px 0"
                      }}
                    >
                      {sch.title}
                    </h3>
                    <p
                      style={{
                        fontSize: "12px",
                        color: theme.text_secondary,
                        margin: "0 0 12px 0"
                      }}
                    >
                      {sch.description}
                    </p>

                    <div
                      style={{
                        fontSize: "11px",
                        color: theme.text_secondary,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "6px",
                        borderTop: `1px solid ${theme.border_subtle}`,
                        paddingTop: "10px"
                      }}
                    >
                      <div>
                        Плейбук:{" "}
                        <strong style={{ color: theme.text_primary }}>
                          {sch.playbook_id}
                        </strong>{" "}
                        (v{sch.playbook_version_number ?? "latest"})
                      </div>
                      <div>
                        Бюджет за день:{" "}
                        <strong style={{ color: theme.text_primary }}>
                          {sch.daily_budget_spent} / {sch.daily_budget_limit}{" "}
                          у.е.
                        </strong>
                      </div>
                      <div>
                        Запусков сегодня:{" "}
                        <strong style={{ color: theme.text_primary }}>
                          {sch.runs_today_count} / {sch.max_runs_per_day}
                        </strong>
                      </div>
                      <div>
                        Следующий запуск:{" "}
                        <strong style={{ color: theme.text_primary }}>
                          {sch.next_run_at ?? "По событию / вебхуку"}
                        </strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Правая колонка: детали выбранного расписания, предохранители и история запусков */}
          {selected && (
            <section
              aria-label="Детали расписания и предохранители"
              style={{ display: "flex", flexDirection: "column", gap: "20px" }}
            >
              <article
                style={{
                  backgroundColor: theme.surface_elevated,
                  border: `1px solid ${theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "20px"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "12px",
                    flexWrap: "wrap",
                    marginBottom: "16px"
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "11px",
                        fontFamily: "ui-monospace, monospace",
                        color: theme.text_secondary
                      }}
                    >
                      ID: {selected.id} • Версия конфигурации v{selected.version}
                    </div>
                    <h2
                      style={{
                        fontSize: "18px",
                        fontWeight: 600,
                        margin: "4px 0"
                      }}
                    >
                      {selected.title}
                    </h2>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={{
                        backgroundColor: theme.text_primary,
                        color: theme.background_primary,
                        border: `1px solid ${theme.text_primary}`,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Запустить сейчас
                    </button>
                    <button
                      type="button"
                      style={{
                        backgroundColor: theme.background_primary,
                        color: theme.text_primary,
                        border: `1px solid ${theme.border_subtle}`,
                        borderRadius: "6px",
                        padding: "6px 12px",
                        fontSize: "12px",
                        cursor: "pointer"
                      }}
                    >
                      {selected.status === "active"
                        ? "Поставить на паузу"
                        : "Возобновить и сбросить предохранитель"}
                    </button>
                    {selected.trigger_type === "webhook" && (
                      <button
                        type="button"
                        style={{
                          backgroundColor: theme.background_primary,
                          color: theme.text_primary,
                          border: `1px solid ${theme.border_subtle}`,
                          borderRadius: "6px",
                          padding: "6px 12px",
                          fontSize: "12px",
                          cursor: "pointer"
                        }}
                      >
                        Ротация секрета HMAC
                      </button>
                    )}
                  </div>
                </div>

                {selected.disabled_reason && (
                  <div
                    role="status"
                    style={{
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.text_primary}`,
                      borderRadius: "6px",
                      padding: "12px",
                      marginBottom: "16px",
                      fontSize: "12px"
                    }}
                  >
                    <strong>Статус предохранителя:</strong>{" "}
                    {selected.disabled_reason}
                  </div>
                )}

                {/* Панель предохранителей (Guardrails) */}
                <h3
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    marginTop: 0,
                    marginBottom: "10px"
                  }}
                >
                  Предохранители и квоты расписания (Guardrails & Circuit
                  Breaker)
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "12px",
                    marginBottom: "16px"
                  }}
                >
                  <div
                    style={{
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.border_subtle}`,
                      borderRadius: "6px",
                      padding: "12px"
                    }}
                  >
                    <div
                      style={{ fontSize: "11px", color: theme.text_secondary }}
                    >
                      Дневной лимит запусков
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: 600,
                        marginTop: "4px"
                      }}
                    >
                      {selected.runs_today_count} / {selected.max_runs_per_day}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.border_subtle}`,
                      borderRadius: "6px",
                      padding: "12px"
                    }}
                  >
                    <div
                      style={{ fontSize: "11px", color: theme.text_secondary }}
                    >
                      Дневной бюджет расписания
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: 600,
                        marginTop: "4px"
                      }}
                    >
                      {selected.daily_budget_spent} /{" "}
                      {selected.daily_budget_limit} у.е.
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.border_subtle}`,
                      borderRadius: "6px",
                      padding: "12px"
                    }}
                  >
                    <div
                      style={{ fontSize: "11px", color: theme.text_secondary }}
                    >
                      Макс. параллельных миссий
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: 600,
                        marginTop: "4px"
                      }}
                    >
                      до {selected.max_concurrent_missions} активных
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: theme.background_primary,
                      border: `1px solid ${theme.border_subtle}`,
                      borderRadius: "6px",
                      padding: "12px"
                    }}
                  >
                    <div
                      style={{ fontSize: "11px", color: theme.text_secondary }}
                    >
                      Предохранитель ошибок подряд
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: 600,
                        marginTop: "4px"
                      }}
                    >
                      {selected.consecutive_failures_count} /{" "}
                      {selected.consecutive_failures_limit}
                    </div>
                  </div>
                </div>

                {/* Специфика триггера: Cron или Webhook HMAC */}
                <div
                  style={{
                    backgroundColor: theme.background_primary,
                    border: `1px solid ${theme.border_subtle}`,
                    borderRadius: "6px",
                    padding: "12px",
                    fontSize: "12px"
                  }}
                >
                  {selected.trigger_type === "cron" && (
                    <div>
                      <strong>Cron-выражение:</strong>{" "}
                      <code>{selected.cron_expression}</code> (Часовой пояс:{" "}
                      {selected.timezone}) • Автостарт миссии:{" "}
                      {selected.auto_start_mission ? "Включён" : "Только Ready"}
                    </div>
                  )}
                  {selected.trigger_type === "webhook" && (
                    <div>
                      <div>
                        <strong>Эндпоинт вебхука:</strong>{" "}
                        <code>
                          POST /api/v1/schedules/{selected.id}/webhook
                        </code>
                      </div>
                      <div style={{ marginTop: "4px" }}>
                        <strong>Заголовок подписи:</strong>{" "}
                        <code>X-Kosmora-Signature-256: sha256=&lt;hmac&gt;</code>{" "}
                        • Превью ключа:{" "}
                        <code>{selected.webhook_signing_secret_preview}</code> •
                        SHA-256 отпечаток:{" "}
                        <code>
                          {selected.webhook_secret_sha256?.slice(0, 16)}...
                        </code>
                      </div>
                    </div>
                  )}
                  {selected.variable_mappings_json.length > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      <strong>
                        Маппинг JSON-полей полезной нагрузки в переменные
                        плейбука:
                      </strong>
                      <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                        {selected.variable_mappings_json.map((m) => (
                          <li key={m.variable_key}>
                            <code>{m.payload_path}</code> →{" "}
                            <code>{`{{${m.variable_key}}}`}</code> (по
                            умолчанию: <code>{String(m.fallback_value ?? "—")}</code>
                            )
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </article>

              {/* История запусков */}
              <article
                style={{
                  backgroundColor: theme.surface_elevated,
                  border: `1px solid ${theme.border_subtle}`,
                  borderRadius: "8px",
                  padding: "20px"
                }}
              >
                <h3
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    marginTop: 0,
                    marginBottom: "12px"
                  }}
                >
                  История срабатываний и созданные миссии ({vm.runs.length})
                </h3>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "12px"
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: `1px solid ${theme.border_subtle}`,
                        textAlign: "left",
                        color: theme.text_secondary
                      }}
                    >
                      <th style={{ padding: "8px 6px" }}>Время (UTC)</th>
                      <th style={{ padding: "8px 6px" }}>Источник</th>
                      <th style={{ padding: "8px 6px" }}>Статус</th>
                      <th style={{ padding: "8px 6px" }}>Бюджет</th>
                      <th style={{ padding: "8px 6px" }}>Миссия Mission Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.runs.map((run) => (
                      <tr
                        key={run.id}
                        style={{
                          borderBottom: `1px solid ${theme.border_subtle}`
                        }}
                      >
                        <td
                          style={{
                            padding: "8px 6px",
                            fontFamily: "ui-monospace, monospace"
                          }}
                        >
                          {run.initiated_at}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {run.trigger_source}
                        </td>
                        <td style={{ padding: "8px 6px", fontWeight: 600 }}>
                          {RUN_STATUS_LABELS_RU[run.status] ?? run.status}
                          {run.failure_reason && (
                            <div
                              style={{
                                fontSize: "11px",
                                fontWeight: 400,
                                color: theme.text_secondary
                              }}
                            >
                              {run.failure_reason}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {run.estimated_budget} у.е.
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {run.resulting_mission_id ? (
                            <a
                              href={`/kosmora-workspace/missions?mission_id=${encodeURIComponent(
                                run.resulting_mission_id
                              )}`}
                              style={{
                                color: theme.text_primary,
                                textDecoration: "underline",
                                fontFamily: "ui-monospace, monospace"
                              }}
                            >
                              {run.resulting_mission_id}
                            </a>
                          ) : (
                            <span style={{ color: theme.text_secondary }}>
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            </section>
          )}
        </div>
      )}

      {/* Мастер создания нового расписания / триггера с валидатором Cron */}
      <section
        aria-label="Создание нового расписания или триггера"
        style={{
          backgroundColor: theme.surface_elevated,
          border: `1px solid ${theme.border_subtle}`,
          borderRadius: "8px",
          padding: "20px"
        }}
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginTop: 0,
            marginBottom: "12px"
          }}
        >
          Создать новое расписание или триггер плейбука
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            marginBottom: "14px"
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
            Название расписания
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{
                backgroundColor: theme.background_primary,
                color: theme.text_primary,
                border: `1px solid ${theme.border_subtle}`,
                borderRadius: "4px",
                padding: "8px"
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
            Тип триггера
            <select
              value={newTriggerType}
              onChange={(e) =>
                setNewTriggerType(e.target.value as ScheduleTriggerType)
              }
              style={{
                backgroundColor: theme.background_primary,
                color: theme.text_primary,
                border: `1px solid ${theme.border_subtle}`,
                borderRadius: "4px",
                padding: "8px"
              }}
            >
              <option value="cron">Cron-расписание (5 полей)</option>
              <option value="interval">Интервал (в минутах)</option>
              <option value="one_time">Однократный запуск по времени</option>
              <option value="webhook">Подписанный вебхук (HMAC-SHA256)</option>
              <option value="event">Системное событие Kosmora</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
            Cron-выражение (UTC)
            <input
              type="text"
              value={newCronExpr}
              onChange={(e) => setNewCronExpr(e.target.value)}
              style={{
                backgroundColor: theme.background_primary,
                color: theme.text_primary,
                border: `1px solid ${theme.border_subtle}`,
                borderRadius: "4px",
                padding: "8px",
                fontFamily: "ui-monospace, monospace"
              }}
            />
          </label>
        </div>

        <div
          style={{
            backgroundColor: theme.background_primary,
            border: `1px solid ${theme.border_subtle}`,
            borderRadius: "6px",
            padding: "10px 12px",
            fontSize: "12px",
            color: theme.text_secondary
          }}
        >
          {liveCronValidation.valid ? (
            <span>
              Ближайшие расчётные запуски (UTC):{" "}
              <strong style={{ color: theme.text_primary }}>
                {liveCronValidation.next_runs_preview.join(" → ")}
              </strong>
            </span>
          ) : (
            <span style={{ color: theme.text_primary }}>
              Ошибка синтаксиса Cron: {liveCronValidation.errors.join("; ")}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
