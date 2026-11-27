"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./personal-settings.module.css";

type Trigger = {
  id: string;
  project_id: string;
  workflow_id: string;
  definition_version: number;
  kind: "manual" | "event" | "schedule";
  status: "enabled" | "paused" | "cancelled";
  inputs: Record<string, string | number | boolean>;
  schedule?: {
    mode: "once" | "daily" | "weekdays" | "weekly";
    time_zone: string;
    local_time: string;
    due_at: string;
  };
  event?: { source: string; event_type: string; event_id: string };
  version: number;
};
type Run = {
  id: string;
  trigger_id: string;
  kind: string;
  status: string;
  definition_version: number;
  error_code?: string;
  error_reason?: string;
  confirmation_id?: string;
  external_action_id?: string;
  occurrence_key: string;
  version: number;
  created_at: string;
};
type Workflow = {
  id: string;
  name: string;
  version: number;
  parameters: { id: string; label: string }[];
};
type NextRun = { trigger_id: string; next_due_at: string | null };

const MODE_LABEL: Record<string, string> = {
  once: "Один раз",
  daily: "Каждый день",
  weekdays: "По будням",
  weekly: "Раз в неделю"
};
const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  claimed: "Захвачено сервером",
  awaiting_confirmation: "Ожидает подтверждения",
  running: "Выполняется",
  succeeded: "Успешно",
  failed: "Ошибка",
  cancelled: "Отменено",
  unknown_external: "Исход внешнего действия неизвестен"
};

async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/v1/automation${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => ({}))) as {
      error?: string | { code?: string };
    };
    const code = typeof value.error === "string" ? value.error : value.error?.code;
    throw new Error(code ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const localInput = () => {
  const at = new Date(Date.now() + 3_600_000);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function AutomationSettings() {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [kind, setKind] = useState<"manual" | "event" | "schedule">("manual");
  const [mode, setMode] = useState("daily");
  const [zone, setZone] = useState("Europe/Moscow");
  const [localTime, setLocalTime] = useState("09:00");
  const [due, setDue] = useState(localInput);
  const [source, setSource] = useState("harness3");
  const [eventType, setEventType] = useState("file.updated");
  const [eventId, setEventId] = useState("");
  const [inputs, setInputs] = useState("{}");
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [nextRuns, setNextRuns] = useState<NextRun[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<{ at: string; kind: string; reason: string }[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        api<{ items: Trigger[]; next_runs: NextRun[] }>("/triggers"),
        api<{ items: Run[] }>("/runs")
      ]);
      setTriggers(t.items);
      setNextRuns(t.next_runs ?? []);
      setRuns(r.items);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Автоматизации недоступны.");
    }
  }, []);

  useEffect(() => {
    void fetch("/api/v1/projects", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ items: [] })))
      .then((value: { items: { id: string; name: string }[] }) => {
        setProjects(value.items);
        if (value.items[0]) setProjectId(value.items[0].id);
      })
      .catch(() => undefined);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!projectId) return;
    void fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/workflows`, {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ items: [] })))
      .then((value: { items: Workflow[] }) => {
        setWorkflows(value.items);
        if (!value.items.some((w) => w.id === workflowId)) setWorkflowId(value.items[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, [projectId, workflowId]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await task();
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      if (!projectId || !workflowId) throw new Error("Выберите проект и сценарий.");
      const workflow = workflows.find((w) => w.id === workflowId)!;
      const parsed = JSON.parse(inputs) as Record<string, string | number | boolean>;
      const body: Record<string, unknown> = {
        client_request_id: crypto.randomUUID(),
        project_id: projectId,
        workflow_id: workflowId,
        definition_version: workflow.version,
        kind,
        inputs: parsed
      };
      if (kind === "schedule")
        body.schedule = {
          mode,
          time_zone: zone,
          local_time: localTime,
          due_at: new Date(due).toISOString(),
          enabled: true
        };
      if (kind === "event")
        body.event = {
          source,
          event_type: eventType,
          event_id: eventId || crypto.randomUUID(),
          bindings: parsed
        };
      await api("/triggers", body);
      setNotice("Триггер сохранён.");
    });

  const openRun = async (id: string) => {
    const value = await api<{ events: { at: string; kind: string; reason: string }[] }>(
      `/runs/${encodeURIComponent(id)}`
    );
    setEvents(value.events);
    setSelectedRun(runs.find((r) => r.id === id) ?? null);
  };

  return (
    <section id="automation-settings" aria-label="Повторяемые процедуры">
      <h2>Повторяемые процедуры</h2>
      <p className={styles.muted}>
        Сохраните сценарий Koswork и запускайте его вручную, по событию коннектора или по
        расписанию. Сервер выполняет процедуру явным тактом; модель не ожидает события в открытой
        вкладке. Ближайшее время показано с учётом часового пояса.
      </p>
      <div className={styles.scheduleForm}>
        <label>
          Проект
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сценарий
          <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · v{w.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Запуск
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="manual">Вручную</option>
            <option value="event">По событию</option>
            <option value="schedule">По расписанию</option>
          </select>
        </label>
        {kind === "schedule" && (
          <>
            <label>
              Повтор
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                {Object.entries(MODE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Часовой пояс
              <input value={zone} onChange={(e) => setZone(e.target.value)} />
            </label>
            <label>
              Местное время
              <input value={localTime} onChange={(e) => setLocalTime(e.target.value)} />
            </label>
            <label>
              Первый запуск
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </>
        )}
        {kind === "event" && (
          <>
            <label>
              Источник события
              <input value={source} onChange={(e) => setSource(e.target.value)} />
            </label>
            <label>
              Тип события
              <input value={eventType} onChange={(e) => setEventType(e.target.value)} />
            </label>
            <label>
              ID события
              <input value={eventId} onChange={(e) => setEventId(e.target.value)} />
            </label>
          </>
        )}
        <label className={styles.wide}>
          Входы процедуры (JSON)
          <textarea
            value={inputs}
            onChange={(e) => setInputs(e.target.value)}
            aria-label="Входы процедуры"
          />
        </label>
      </div>
      <div className={styles.scheduleActions}>
        <button type="button" disabled={busy} onClick={() => void create()}>
          Сохранить процедуру
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => api("/tick", {}))}>
          Серверный такт
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => api("/recover", {}))}>
          Восстановить после перезапуска
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}

      <h3>Триггеры</h3>
      {triggers.length === 0 ? (
        <p className={styles.muted}>Триггеров пока нет.</p>
      ) : (
        <ul className={styles.scheduleList}>
          {triggers.map((t) => (
            <li key={t.id}>
              <strong>
                {workflows.find((w) => w.id === t.workflow_id)?.name ?? t.workflow_id}
              </strong>
              <small>
                {t.kind} · {t.status} · v{t.definition_version}
                {t.schedule
                  ? ` · ${MODE_LABEL[t.schedule.mode]} ${t.schedule.local_time} (${t.schedule.time_zone})`
                  : ""}
              </small>
              {nextRuns.find((n) => n.trigger_id === t.id)?.next_due_at && (
                <small>
                  Ближайший запуск:{" "}
                  {new Date(
                    nextRuns.find((n) => n.trigger_id === t.id)!.next_due_at!
                  ).toLocaleString()}
                </small>
              )}
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api(`/triggers/${t.id}`, {
                        expected_version: t.version,
                        status: t.status === "enabled" ? "paused" : "enabled"
                      })
                    )
                  }
                >
                  {t.status === "enabled" ? "Пауза" : "Возобновить"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>История запусков</h3>
      {runs.length === 0 ? (
        <p className={styles.muted}>Запусков пока нет.</p>
      ) : (
        <ul className={styles.scheduleList}>
          {runs.map((r) => (
            <li key={r.id}>
              <strong>{STATUS_LABEL[r.status] ?? r.status}</strong>
              <small>
                v{r.definition_version} · {new Date(r.created_at).toLocaleString()} ·{" "}
                {r.occurrence_key}
              </small>
              {r.error_code && (
                <small>
                  Причина: {r.error_code} — {r.error_reason ?? ""}
                </small>
              )}
              <div>
                <button type="button" disabled={busy} onClick={() => void openRun(r.id)}>
                  Журнал
                </button>
                {r.status === "awaiting_confirmation" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/runs/${r.id}/control`, {
                          expected_version: r.version + 1,
                          action: "confirm"
                        })
                      )
                    }
                  >
                    Подтвердить внешнее действие
                  </button>
                )}
                {r.status === "unknown_external" && r.external_action_id && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/runs/${r.id}/control`, {
                            expected_version: r.version + 1,
                            action: "verify_external",
                            verified: true
                          })
                        )
                      }
                    >
                      Подтвердить проверку
                    </button>
                    <small>Повтор внешнего действия без проверки запрещён.</small>
                  </>
                )}
                {["queued", "running", "awaiting_confirmation"].includes(r.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/runs/${r.id}/control`, {
                          expected_version: r.version + 1,
                          action: "cancel"
                        })
                      )
                    }
                  >
                    Отменить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {selectedRun && (
        <div className={styles.entry} aria-label="Журнал запуска">
          <h4>Журнал {selectedRun.id.slice(0, 8)}</h4>
          {events.length === 0 ? (
            <p>Событий пока нет.</p>
          ) : (
            <ul>
              {events.map((e) => (
                <li key={e.at + e.kind}>
                  {new Date(e.at).toLocaleString()} · {e.kind} · {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
