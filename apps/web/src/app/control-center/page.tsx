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
  challenge_nonce: string;
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
  projectStop: EmergencyStop | null;
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
  const [selectedConfirmationId, setSelectedConfirmationId] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionAcknowledged, setDecisionAcknowledged] = useState(false);
  const [confirmationStepUpToken, setConfirmationStepUpToken] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [stopScope, setStopScope] = useState<"project" | "process">("project");
  const [stopReason, setStopReason] = useState("");
  const [stopAcknowledged, setStopAcknowledged] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionPending = previewing || applying || deciding || stopping;

  const load = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    setSelectedConfirmationId(null);
    setDecisionReason("");
    setDecisionAcknowledged(false);
    setConfirmationStepUpToken("");
    setStopScope("project");
    setStopReason("");
    setStopAcknowledged(false);
    try {
      const [profileResponse, confirmationsResponse, operations, projectStop] = await Promise.all([
        api<{ profile: CapabilityProfile }>(
          `/api/v1/projects/${encodeURIComponent(id)}/autonomy-profile`
        ),
        api<{ items: Confirmation[] }>(`/api/v1/projects/${encodeURIComponent(id)}/confirmations`),
        api<OperationsStatus>("/api/v1/operations/status"),
        api<EmergencyStop | null>(
          `/api/v1/operations/emergency-stop?project_id=${encodeURIComponent(id)}`
        )
      ]);
      setData({
        profile: profileResponse.profile,
        confirmations: confirmationsResponse.items,
        operations,
        projectStop
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
    if (actionPending) return;
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
  const selectedConfirmation = useMemo(
    () =>
      pendingConfirmations.find((item) => item.confirmation_id === selectedConfirmationId) ?? null,
    [pendingConfirmations, selectedConfirmationId]
  );
  const selectedStop =
    data?.operations.process_stop ?? (stopScope === "project" ? data?.projectStop : null);

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
    if (!data || level === data.profile.base_level || actionPending) return;
    setPreviewing(true);
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    setSelectedConfirmationId(null);
    setDecisionReason("");
    setDecisionAcknowledged(false);
    setConfirmationStepUpToken("");
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
    if (!data || !preview || !acknowledged || actionPending) return;
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

  const reviewConfirmation = (confirmationId: string): void => {
    if (actionPending) return;
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    setSelectedConfirmationId(confirmationId);
    setDecisionReason("");
    setDecisionAcknowledged(false);
    setConfirmationStepUpToken("");
    setNotice(null);
    setError(null);
  };

  const decideConfirmation = async (decision: "approve" | "reject"): Promise<void> => {
    if (!selectedConfirmation || !decisionAcknowledged || actionPending) return;
    const reason = decisionReason.trim();
    const token = confirmationStepUpToken.trim();
    if (decision === "reject" && !reason) {
      setError("Для отклонения укажите причину");
      return;
    }
    if (decision === "approve" && selectedConfirmation.requires_step_up && !token) {
      setError("Для критического одобрения нужен одноразовый step-up токен");
      return;
    }
    setDeciding(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api<Confirmation>(
        `/api/v1/confirmations/${encodeURIComponent(selectedConfirmation.confirmation_id)}/${decision}`,
        {
          method: "POST",
          ...(decision === "approve" && selectedConfirmation.requires_step_up
            ? { headers: { "x-step-up-token": token } }
            : {}),
          body: {
            challenge_nonce: selectedConfirmation.challenge_nonce,
            ...(reason ? { reason } : {})
          }
        }
      );
      setData((current) =>
        current
          ? {
              ...current,
              confirmations: current.confirmations.map((item) =>
                item.confirmation_id === updated.confirmation_id ? updated : item
              )
            }
          : current
      );
      setSelectedConfirmationId(null);
      setDecisionReason("");
      setDecisionAcknowledged(false);
      setNotice(
        decision === "approve"
          ? "Действие одобрено; решение сохранено Policy Runtime."
          : "Действие отклонено; причина сохранена в истории."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить решение владельца");
    } finally {
      setConfirmationStepUpToken("");
      setDeciding(false);
    }
  };

  const selectStopScope = (scope: "project" | "process"): void => {
    if (actionPending || scope === stopScope) return;
    setStopScope(scope);
    setStopReason("");
    setStopAcknowledged(false);
    setNotice(null);
    setError(null);
  };

  const activateEmergencyStop = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!data || actionPending || selectedStop) return;
    const reason = stopReason.trim();
    if (!reason) {
      setError("Укажите причину аварийной остановки");
      return;
    }
    if (!stopAcknowledged) {
      setError("Подтвердите, что вы понимаете область и эффект остановки");
      return;
    }

    setStopping(true);
    setError(null);
    setNotice(null);
    try {
      const activated = await api<EmergencyStop>("/api/v1/operations/emergency-stop", {
        method: "POST",
        body: {
          scope: stopScope,
          ...(stopScope === "project" ? { project_id: data.profile.project_id } : {}),
          reason
        }
      });
      const operations = await api<OperationsStatus>("/api/v1/operations/status");
      setData((current) =>
        current
          ? {
              ...current,
              operations,
              projectStop: activated.scope === "project" ? activated : current.projectStop
            }
          : current
      );
      setStopReason("");
      setStopAcknowledged(false);
      setNotice(
        activated.scope === "process"
          ? "Process emergency stop активирован. Все runs остановлены; возобновление через UI недоступно."
          : "Project emergency stop активирован. Runs проекта остановлены; возобновление через UI недоступно."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось активировать emergency stop");
    } finally {
      setStopping(false);
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
          <i /> Guarded owner actions
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
            разницы. Ожидающие действия проходят отдельную проверку перед approve/reject, а
            emergency stop можно активировать для проекта или всего процесса без скрытого resume.
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
            <button disabled={!draftProjectId.trim() || loading || actionPending}>
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
                  actionPending
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
                    !acknowledged ||
                    actionPending ||
                    (preview.requires_step_up && !stepUpToken.trim())
                  }
                  onClick={() => void applyPreview()}
                >
                  {applying ? "Применяю…" : `Применить ${preview.proposed_profile.base_level}`}
                </button>
                <button
                  type="button"
                  className={styles.cancelButton}
                  disabled={actionPending}
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
                    <dl className={styles.confirmationDetails}>
                      <div>
                        <dt>Действие</dt>
                        <dd>{confirmation.intent.capability_ids.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt>Цель / объект</dt>
                        <dd>
                          {confirmation.intent.object_ids.length > 0
                            ? confirmation.intent.object_ids.join(" · ")
                            : "Без конкретного объекта"}
                        </dd>
                      </div>
                      <div>
                        <dt>Риск</dt>
                        <dd>{confirmation.verdict.reasons.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt>Ожидаемый эффект</dt>
                        <dd>{confirmation.intent.purpose}</dd>
                      </div>
                      <div>
                        <dt>Срок решения</dt>
                        <dd>{dateTime(confirmation.expires_at)}</dd>
                      </div>
                    </dl>

                    {selectedConfirmationId !== confirmation.confirmation_id ? (
                      <button
                        type="button"
                        className={styles.reviewButton}
                        disabled={actionPending}
                        onClick={() => reviewConfirmation(confirmation.confirmation_id)}
                      >
                        Рассмотреть
                      </button>
                    ) : (
                      <section
                        className={styles.decisionPanel}
                        aria-label={`Решение по операции ${confirmation.operation_id}`}
                      >
                        <p>
                          {confirmation.requires_step_up
                            ? "Критическое одобрение требует step-up. Отклонение остаётся доступно без него."
                            : "Решение будет записано от текущей сессии владельца."}
                        </p>
                        <label className={styles.decisionReason}>
                          <span>Комментарий владельца</span>
                          <textarea
                            value={decisionReason}
                            onChange={(event) => setDecisionReason(event.target.value)}
                            maxLength={2000}
                            placeholder="Обязателен для отклонения"
                          />
                        </label>
                        <label className={styles.acknowledgement}>
                          <input
                            type="checkbox"
                            checked={decisionAcknowledged}
                            onChange={(event) => setDecisionAcknowledged(event.target.checked)}
                          />
                          <span>Я проверил действие, цель, объекты, риск и срок.</span>
                        </label>

                        {confirmation.requires_step_up && (
                          <label className={styles.stepUp}>
                            <span>Одноразовый step-up токен для одобрения</span>
                            <input
                              type="password"
                              value={confirmationStepUpToken}
                              onChange={(event) => setConfirmationStepUpToken(event.target.value)}
                              autoComplete="one-time-code"
                              placeholder="Для кнопки «Одобрить»"
                            />
                            <small>Токен не нужен для отказа и очищается после запроса.</small>
                          </label>
                        )}

                        <div className={styles.decisionActions}>
                          <button
                            type="button"
                            className={styles.approveButton}
                            disabled={
                              !decisionAcknowledged ||
                              actionPending ||
                              (confirmation.requires_step_up && !confirmationStepUpToken.trim())
                            }
                            onClick={() => void decideConfirmation("approve")}
                          >
                            {deciding ? "Сохраняю…" : "Одобрить"}
                          </button>
                          <button
                            type="button"
                            className={styles.rejectButton}
                            disabled={
                              !decisionAcknowledged || !decisionReason.trim() || actionPending
                            }
                            onClick={() => void decideConfirmation("reject")}
                          >
                            Отклонить
                          </button>
                          <button
                            type="button"
                            className={styles.cancelButton}
                            disabled={actionPending}
                            onClick={() => {
                              setSelectedConfirmationId(null);
                              setDecisionReason("");
                              setDecisionAcknowledged(false);
                              setConfirmationStepUpToken("");
                              setError(null);
                            }}
                          >
                            Закрыть
                          </button>
                        </div>
                      </section>
                    )}
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
                    <p>
                      {confirmation.decision_reason ?? confirmation.verdict.reasons.join(" · ")}
                    </p>
                    <small>
                      решение {dateTime(confirmation.decided_at)} · {confirmation.decided_by ?? "—"}
                    </small>
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

            <form
              className={styles.stopControl}
              aria-labelledby="emergency-stop-title"
              onSubmit={(event) => void activateEmergencyStop(event)}
            >
              <div className={styles.stopIntro}>
                <div>
                  <span className={styles.eyebrow}>Owner safety action</span>
                  <h3 id="emergency-stop-title">Активировать emergency stop</h3>
                  <p>
                    Остановка применяется сервером и сохраняется после рестарта. Она не выдаёт новых
                    полномочий, поэтому step-up не требуется.
                  </p>
                </div>
                <div
                  className={styles.stopScope}
                  role="group"
                  aria-label="Область аварийной остановки"
                >
                  <button
                    type="button"
                    aria-pressed={stopScope === "project"}
                    disabled={loading || actionPending}
                    onClick={() => selectStopScope("project")}
                  >
                    Только выбранный проект
                  </button>
                  <button
                    type="button"
                    aria-pressed={stopScope === "process"}
                    disabled={loading || actionPending}
                    onClick={() => selectStopScope("process")}
                  >
                    Весь процесс
                  </button>
                </div>
              </div>

              <div className={styles.stopImpact}>
                <strong>
                  {stopScope === "project"
                    ? `Проект ${shortId(data.profile.project_id)}`
                    : "Все проекты и активные runs"}
                </strong>
                <span>
                  {stopScope === "project"
                    ? "Будут прерваны активные и заблокированы новые runs только этого проекта."
                    : "Будут прерваны активные и заблокированы новые runs всего API-процесса."}
                </span>
              </div>

              {selectedStop ? (
                <div className={styles.activeStop}>
                  <strong>
                    {selectedStop.scope === "process"
                      ? "Process emergency stop уже активен"
                      : "Project emergency stop уже активен"}
                  </strong>
                  <span>{selectedStop.reason}</span>
                  <small>
                    {dateTime(selectedStop.activated_at)} · {selectedStop.activated_by}
                  </small>
                </div>
              ) : (
                <>
                  <label className={styles.stopReason}>
                    <span>Причина аварийной остановки</span>
                    <textarea
                      value={stopReason}
                      onChange={(event) => setStopReason(event.target.value)}
                      minLength={1}
                      maxLength={500}
                      required
                      placeholder="Что произошло и почему выполнение нужно остановить"
                    />
                    <small>{stopReason.length}/500 · причина попадёт в аварийный аудит</small>
                  </label>

                  <label className={styles.stopAcknowledgement}>
                    <input
                      type="checkbox"
                      checked={stopAcknowledged}
                      onChange={(event) => setStopAcknowledged(event.target.checked)}
                    />
                    <span>
                      {stopScope === "project"
                        ? "Я понимаю: новые и активные runs этого проекта будут остановлены."
                        : "Я понимаю: новые и активные runs всех проектов будут остановлены."}
                    </span>
                  </label>

                  <button
                    type="submit"
                    className={styles.stopButton}
                    disabled={!stopReason.trim() || !stopAcknowledged || loading || actionPending}
                  >
                    {stopping
                      ? "Активирую…"
                      : stopScope === "project"
                        ? "Активировать stop проекта"
                        : "Активировать stop процесса"}
                  </button>
                </>
              )}

              <p className={styles.noResume}>
                В Control Center нет кнопки resume. Снятие остановки остаётся отдельным аудируемым
                операторским действием.
              </p>
            </form>

            <div className={styles.operationGrid}>
              <article data-stop={data.operations.process_stop ? "active" : "clear"}>
                <span>Process emergency stop</span>
                <strong>{data.operations.process_stop ? "ACTIVE" : "CLEAR"}</strong>
                <small>
                  {data.operations.process_stop?.reason ??
                    "Глобальная аварийная остановка не активна"}
                </small>
              </article>
              <article data-stop={data.projectStop ? "active" : "clear"}>
                <span>Selected project stop</span>
                <strong>{data.projectStop ? "ACTIVE" : "CLEAR"}</strong>
                <small>
                  {data.projectStop?.reason ?? "Остановка выбранного проекта не активна"}
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
