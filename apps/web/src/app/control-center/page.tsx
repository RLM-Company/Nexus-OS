"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./control-center.module.css";

type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
type PermissionMode = "DENY" | "CONFIRM" | "SCOPED" | "AUTONOMOUS" | "FULL";
type ConfirmationStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";

type CapabilityGrant = {
  capability_id: string;
  mode: PermissionMode;
  scope: string[];
  conditions: string[];
};

type CapabilityOverride = {
  override_id: string;
  capability_id: string;
  mode: PermissionMode;
  object_ids: string[];
  purpose: string;
  valid_until: string | null;
  remaining_uses: number | null;
};

type CapabilityProfile = {
  profile_id: string;
  project_id: string;
  base_level: AutonomyLevel;
  grants: CapabilityGrant[];
  overrides: CapabilityOverride[];
  version: number;
  issued_at: string;
};

type Confirmation = {
  confirmation_id: string;
  project_id: string;
  operation_id: string;
  actor_id: string;
  intent: {
    capability_ids: string[];
    object_ids: string[];
    purpose: string;
  };
  verdict: {
    verdict: string;
    reasons: string[];
  };
  status: ConfirmationStatus;
  requires_step_up: boolean;
  requested_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
};

type EmergencyStop = {
  scope: "process" | "project";
  project_id: string | null;
  active: true;
  reason: string;
  activated_at: string;
  activated_by: string;
};

type OperationsStatus = {
  generated_at: string;
  active_runs: number;
  process_stop: EmergencyStop | null;
  active_project_stops: number;
  metrics: {
    runs_started: number;
    runs_completed: number;
    runs_failed: number;
    runs_cancelled: number;
    route_attempts: number;
    route_failures: Record<string, number>;
    last_failure_at: string | null;
  };
  alerts: Array<{
    code: string;
    severity: "warning" | "critical";
    message: string;
  }>;
};

type CenterData = {
  profile: CapabilityProfile;
  confirmations: Confirmation[];
  operations: OperationsStatus;
};

type ProfilePreview = {
  current_version: number;
  proposed_profile: CapabilityProfile;
  requires_step_up: boolean;
};

type ApiOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  headers?: Record<string, string>;
};

const LEVELS: AutonomyLevel[] = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"];

const api = async <T,>(url: string, options: ApiOptions = {}): Promise<T> => {
  const headers =
    options.body === undefined
      ? options.headers
      : { "content-type": "application/json", ...options.headers };
  const response = await fetch(url, {
    cache: "no-store",
    method: options.method ?? "GET",
    ...(headers ? { headers } : {}),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) ?? "null" })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Cosmora API returned ${response.status}`);
  }
  return (await response.json()) as T;
};

const shortId = (value: string): string => (value.length > 18 ? `${value.slice(0, 15)}…` : value);

const dateTime = (value: string | null): string => {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export default function ControlCenterPage() {
  const [projectId, setProjectId] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [stepUpToken, setStepUpToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    try {
      const [profileResponse, confirmationsResponse, operations] = await Promise.all([
        api<{ profile: CapabilityProfile }>(
          `/api/v1/projects/${encodeURIComponent(id)}/autonomy-profile`
        ),
        api<{ items: Confirmation[] }>(`/api/v1/projects/${encodeURIComponent(id)}/confirmations`),
        api<OperationsStatus>("/api/v1/operations/status")
      ]);
      setData({
        profile: profileResponse.profile,
        confirmations: confirmationsResponse.items,
        operations
      });
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить Control Center");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("project")?.trim() ?? "";
    setProjectId(id);
    setDraftProjectId(id);
    if (id) void load(id);
  }, [load]);

  const openProject = (event: FormEvent): void => {
    event.preventDefault();
    if (previewing || applying) return;
    const id = draftProjectId.trim();
    if (!id) return;
    window.history.replaceState(null, "", `/control-center?project=${encodeURIComponent(id)}`);
    setProjectId(id);
    void load(id);
  };

  const pendingConfirmations = useMemo(
    () => data?.confirmations.filter((item) => item.status === "PENDING") ?? [],
    [data]
  );
  const confirmationHistory = useMemo(
    () => data?.confirmations.filter((item) => item.status !== "PENDING") ?? [],
    [data]
  );

  const profileChanges = useMemo(() => {
    if (!data || !preview) return [];
    const currentModes = new Map(
      data.profile.grants.map((grant) => [grant.capability_id, grant.mode] as const)
    );
    return preview.proposed_profile.grants.flatMap((grant) => {
      const from = currentModes.get(grant.capability_id);
      return from && from !== grant.mode
        ? [{ capability_id: grant.capability_id, from, to: grant.mode }]
        : [];
    });
  }, [data, preview]);

  const previewLevel = async (level: AutonomyLevel): Promise<void> => {
    if (!data || level === data.profile.base_level || previewing || applying) return;
    setPreviewing(true);
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    setNotice(null);
    setError(null);
    try {
      const nextPreview = await api<ProfilePreview>(
        `/api/v1/projects/${encodeURIComponent(data.profile.project_id)}/autonomy-profile/preview`,
        {
          method: "POST",
          body: {
            base_level: level,
            overrides: data.profile.overrides,
            expected_version: data.profile.version
          }
        }
      );
      setPreview(nextPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось построить preview полномочий");
    } finally {
      setPreviewing(false);
    }
  };

  const applyPreview = async (): Promise<void> => {
    if (!data || !preview || !acknowledged || applying) return;
    const token = stepUpToken.trim();
    if (preview.requires_step_up && !token) {
      setError("Для этого уровня нужен одноразовый step-up токен");
      return;
    }
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api<{ profile: CapabilityProfile }>(
        `/api/v1/projects/${encodeURIComponent(data.profile.project_id)}/autonomy-profile`,
        {
          method: "PUT",
          ...(preview.requires_step_up ? { headers: { "x-step-up-token": token } } : {}),
          body: {
            base_level: preview.proposed_profile.base_level,
            overrides: preview.proposed_profile.overrides,
            expected_version: preview.current_version
          }
        }
      );
      setData((current) => (current ? { ...current, profile: response.profile } : current));
      setPreview(null);
      setAcknowledged(false);
      setNotice(
        `Уровень автономии изменён на ${response.profile.base_level}; активна версия ${response.profile.version}.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось применить профиль полномочий");
    } finally {
      setStepUpToken("");
      setApplying(false);
    }
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.orbit} aria-hidden="true" />
          <div>
            <span>Cosmora</span>
            <strong>Autonomy Control Center</strong>
          </div>
        </div>
        <div className={styles.readOnly}>
          <i /> Preview before apply
        </div>
        <Link href="/" className={styles.back}>
          ← Рабочая область
        </Link>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Policy Runtime</span>
          <h1>Полномочия, подтверждения и аварийное состояние — в одном месте</h1>
          <p>
            Уровень A0–A6 теперь можно изменить только после серверного preview и явной проверки
            разницы. Подтверждения и emergency stop в этом блоке по-прежнему доступны только для
            просмотра.
          </p>
        </div>
        <form className={styles.projectForm} onSubmit={openProject}>
          <label htmlFor="control-project-id">ID проекта</label>
          <div>
            <input
              id="control-project-id"
              value={draftProjectId}
              onChange={(event) => setDraftProjectId(event.target.value)}
              placeholder="project-id"
              autoComplete="off"
            />
            <button disabled={!draftProjectId.trim() || loading || previewing || applying}>
              {loading ? "Загрузка…" : "Открыть"}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {!projectId ? (
        <section className={styles.emptyState}>
          <span>CONTROL PLANE</span>
          <h2>Выберите проект</h2>
          <p>
            Профиль автономности и подтверждения всегда загружаются в границах выбранного проекта.
          </p>
        </section>
      ) : data ? (
        <>
          <section className={styles.metrics} aria-label="Сводка автономности">
            <article>
              <span>Уровень</span>
              <strong>{data.profile.base_level}</strong>
              <small>profile v{data.profile.version}</small>
            </article>
            <article>
              <span>Capabilities</span>
              <strong>{data.profile.grants.length}</strong>
              <small>канонический профиль</small>
            </article>
            <article>
              <span>Ожидают решения</span>
              <strong>{pendingConfirmations.length}</strong>
              <small>confirmation cards</small>
            </article>
            <article>
              <span>Активные runs</span>
              <strong>{data.operations.active_runs}</strong>
              <small>{data.operations.active_project_stops} project stop</small>
            </article>
          </section>

          <section className={styles.levelStrip} aria-label="Шкала автономности A0–A6">
            {LEVELS.map((level) => (
              <button
                type="button"
                key={level}
                data-active={level === data.profile.base_level}
                data-selected={level === preview?.proposed_profile.base_level}
                aria-label={`Выбрать уровень ${level}`}
                aria-pressed={
                  level === data.profile.base_level ||
                  level === preview?.proposed_profile.base_level
                }
                disabled={
                  level === data.profile.base_level ||
                  level === preview?.proposed_profile.base_level ||
                  loading ||
                  previewing ||
                  applying
                }
                onClick={() => void previewLevel(level)}
              >
                <strong>{level}</strong>
                <span>
                  {level === data.profile.base_level
                    ? "текущий"
                    : level === preview?.proposed_profile.base_level
                      ? "preview"
                      : "выбрать"}
                </span>
              </button>
            ))}
          </section>

          {previewing && (
            <p className={styles.previewing} role="status">
              Рассчитываю точную разницу полномочий…
            </p>
          )}

          {preview && (
            <section className={styles.changePreview} aria-labelledby="authority-preview-title">
              <header>
                <div>
                  <span className={styles.eyebrow}>Authority diff</span>
                  <h2 id="authority-preview-title">Проверка перед изменением уровня</h2>
                </div>
                <strong>
                  {data.profile.base_level} → {preview.proposed_profile.base_level}
                </strong>
              </header>
              <p className={styles.previewExplanation}>
                Preview рассчитан сервером для profile v{preview.current_version}. Профиль ещё не
                изменён.
              </p>
              <div className={styles.diffList} aria-label="Изменения полномочий">
                {profileChanges.map((change) => (
                  <article key={change.capability_id}>
                    <span>{change.capability_id}</span>
                    <div>
                      <em data-mode={change.from}>{change.from}</em>
                      <b aria-hidden="true">→</b>
                      <em data-mode={change.to}>{change.to}</em>
                    </div>
                  </article>
                ))}
                {profileChanges.length === 0 && (
                  <p className={styles.muted}>Эффективные режимы capabilities не изменятся.</p>
                )}
              </div>

              <label className={styles.acknowledgement}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>Я проверил изменения полномочий и хочу применить их.</span>
              </label>

              {preview.requires_step_up && (
                <label className={styles.stepUp}>
                  <span>Одноразовый step-up токен</span>
                  <input
                    type="password"
                    value={stepUpToken}
                    onChange={(event) => setStepUpToken(event.target.value)}
                    autoComplete="one-time-code"
                    placeholder="Требуется для полного доступа"
                  />
                  <small>Токен не сохраняется и очищается сразу после запроса.</small>
                </label>
              )}

              <div className={styles.previewActions}>
                <button
                  type="button"
                  className={styles.applyButton}
                  disabled={
                    !acknowledged || applying || (preview.requires_step_up && !stepUpToken.trim())
                  }
                  onClick={() => void applyPreview()}
                >
                  {applying ? "Применяю…" : `Применить ${preview.proposed_profile.base_level}`}
                </button>
                <button
                  type="button"
                  className={styles.cancelButton}
                  disabled={applying}
                  onClick={() => {
                    setPreview(null);
                    setAcknowledged(false);
                    setStepUpToken("");
                    setError(null);
                  }}
                >
                  Отменить
                </button>
              </div>
            </section>
          )}

          <div className={styles.grid}>
            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Capability profile</span>
                  <h2>Фактические полномочия</h2>
                </div>
                <span className={styles.meta}>{shortId(data.profile.profile_id)}</span>
              </header>
              <div className={styles.capabilityList}>
                {data.profile.grants.map((grant) => (
                  <article key={grant.capability_id}>
                    <div>
                      <strong>{grant.capability_id}</strong>
                      <small>
                        scope {grant.scope.length} · conditions {grant.conditions.length}
                      </small>
                    </div>
                    <em data-mode={grant.mode}>{grant.mode}</em>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Overrides</span>
                  <h2>Точечные исключения</h2>
                </div>
                <span className={styles.meta}>{data.profile.overrides.length}</span>
              </header>
              <div className={styles.cardList}>
                {data.profile.overrides.map((override) => (
                  <article key={override.override_id}>
                    <div className={styles.cardTop}>
                      <strong>{override.capability_id}</strong>
                      <em data-mode={override.mode}>{override.mode}</em>
                    </div>
                    <p>{override.purpose}</p>
                    <small>
                      objects {override.object_ids.length} · uses {override.remaining_uses ?? "∞"} ·
                      до {dateTime(override.valid_until)}
                    </small>
                  </article>
                ))}
                {data.profile.overrides.length === 0 && (
                  <p className={styles.muted}>Точечных overrides сейчас нет.</p>
                )}
              </div>
            </section>
          </div>

          <div className={styles.grid}>
            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Confirmations</span>
                  <h2>Ожидают решения владельца</h2>
                </div>
                <span className={styles.meta}>{pendingConfirmations.length}</span>
              </header>
              <div className={styles.cardList}>
                {pendingConfirmations.map((confirmation) => (
                  <article key={confirmation.confirmation_id}>
                    <div className={styles.cardTop}>
                      <strong>{confirmation.intent.purpose}</strong>
                      <em data-status={confirmation.status}>{confirmation.status}</em>
                    </div>
                    <p>{confirmation.intent.capability_ids.join(" · ")}</p>
                    <small>
                      {confirmation.requires_step_up ? "step-up required" : "session approval"} ·
                      expires {dateTime(confirmation.expires_at)}
                    </small>
                  </article>
                ))}
                {pendingConfirmations.length === 0 && (
                  <p className={styles.muted}>Нет ожидающих подтверждений.</p>
                )}
              </div>
            </section>

            <section className={styles.panel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>History</span>
                  <h2>Завершённые подтверждения</h2>
                </div>
                <span className={styles.meta}>{confirmationHistory.length}</span>
              </header>
              <div className={styles.cardList}>
                {confirmationHistory.slice(0, 8).map((confirmation) => (
                  <article key={confirmation.confirmation_id}>
                    <div className={styles.cardTop}>
                      <strong>{confirmation.intent.purpose}</strong>
                      <em data-status={confirmation.status}>{confirmation.status}</em>
                    </div>
                    <p>{confirmation.verdict.reasons.join(" · ")}</p>
                    <small>решение {dateTime(confirmation.decided_at)}</small>
                  </article>
                ))}
                {confirmationHistory.length === 0 && (
                  <p className={styles.muted}>История подтверждений пока пуста.</p>
                )}
              </div>
            </section>
          </div>

          <section className={styles.operations}>
            <header>
              <div>
                <span className={styles.eyebrow}>Runtime operations</span>
                <h2>Аварийный контур и метрики</h2>
              </div>
              <span className={styles.generated}>
                снимок {dateTime(data.operations.generated_at)}
              </span>
            </header>

            <div className={styles.operationGrid}>
              <article data-stop={data.operations.process_stop ? "active" : "clear"}>
                <span>Process emergency stop</span>
                <strong>{data.operations.process_stop ? "ACTIVE" : "CLEAR"}</strong>
                <small>
                  {data.operations.process_stop?.reason ??
                    "Глобальная аварийная остановка не активна"}
                </small>
              </article>
              <article>
                <span>Runs</span>
                <strong>
                  {data.operations.metrics.runs_completed}/{data.operations.metrics.runs_started}
                </strong>
                <small>
                  failed {data.operations.metrics.runs_failed} · cancelled{" "}
                  {data.operations.metrics.runs_cancelled}
                </small>
              </article>
              <article>
                <span>Route attempts</span>
                <strong>{data.operations.metrics.route_attempts}</strong>
                <small>last failure {dateTime(data.operations.metrics.last_failure_at)}</small>
              </article>
            </div>

            <div className={styles.alerts}>
              {data.operations.alerts.map((alert) => (
                <article key={`${alert.code}:${alert.message}`} data-severity={alert.severity}>
                  <strong>{alert.code}</strong>
                  <span>{alert.message}</span>
                </article>
              ))}
              {data.operations.alerts.length === 0 && (
                <p className={styles.muted}>Активных runtime-alerts нет.</p>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className={styles.emptyState}>
          <span>LOADING</span>
          <h2>{loading ? "Загружаю состояние…" : "Данных пока нет"}</h2>
        </section>
      )}
    </main>
  );
}
