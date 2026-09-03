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

type PolicyVerdictKind = "ALLOW" | "ALLOW_WITH_LIMITS" | "NEEDS_CONFIRMATION" | "DENY" | "PAUSE";

type PolicyDecisionTraceEvent = {
  decision_id: string;
  operation_id: string;
  project_id: string;
  actor_id: string;
  verdict: PolicyVerdictKind;
  capability_ids: string[];
  object_ids: string[];
  reasons: string[];
  policy_version: string;
  evaluated_at: string;
  created_at: string;
};

type PolicyDecisionTrace = {
  items: PolicyDecisionTraceEvent[];
  limit: number;
};

type PolicyRecoveryRequiredOperation = {
  operation_id: string;
  project_id: string;
  actor_id: string;
  recovery_status: "RECOVERY_REQUIRED";
  capability_ids: string[];
  object_ids: string[];
  reasons: string[];
  policy_version: string;
  reserved_at: string;
};

type PolicyRecoveryRequiredList = {
  items: PolicyRecoveryRequiredOperation[];
  limit: number;
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

type UsageSummary = {
  project_id: string;
  generated_at: string;
  attempts: {
    total: number;
    reserved: number;
    committed: number;
    failed: number;
    cancelled: number;
  };
  tokens: {
    committed_input: number;
    committed_output: number;
    reserved_upper_bound: number;
    unknown_committed_attempts: number;
  };
  costs: Array<{
    currency: "USD" | "RUB";
    committed_amount: number;
    reserved_amount: number;
  }>;
  unknown_committed_cost_attempts: number;
  unknown_reserved_cost_attempts: number;
};

type UsageLimit = {
  project_id: string;
  version: number;
  max_total_tokens: number | null;
  max_cost: { amount: number; currency: "USD" | "RUB" } | null;
  created_at: string;
  updated_at: string;
};

type UsageLimitPreview = {
  current_version: number;
  proposed_limit: UsageLimit;
  requires_step_up: boolean;
};

type CenterData = {
  profile: CapabilityProfile;
  confirmations: Confirmation[];
  decisionTrace: PolicyDecisionTrace;
  recoveryRequired: PolicyRecoveryRequiredList;
  usage: UsageSummary;
  usageLimit: UsageLimit;
  operations: OperationsStatus;
  projectStop: EmergencyStop | null;
};

type ProfilePreview = {
  current_version: number;
  proposed_profile: CapabilityProfile;
  requires_step_up: boolean;
};

type OverrideChange =
  | { kind: "ADDED"; next: CapabilityOverride }
  | { kind: "UPDATED"; current: CapabilityOverride; next: CapabilityOverride }
  | { kind: "REMOVED"; current: CapabilityOverride };

type ApiOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  headers?: Record<string, string>;
};

const LEVELS: AutonomyLevel[] = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"];
const PERMISSION_MODES: PermissionMode[] = ["DENY", "CONFIRM", "SCOPED", "AUTONOMOUS", "FULL"];

const VERDICT_LABELS: Record<PolicyVerdictKind, string> = {
  ALLOW: "Разрешено",
  ALLOW_WITH_LIMITS: "Разрешено с ограничениями",
  NEEDS_CONFIRMATION: "Нужно подтверждение",
  DENY: "Отклонено",
  PAUSE: "Приостановлено"
};

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

const dateTimeInput = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const integer = (value: number): string => new Intl.NumberFormat("ru-RU").format(value);

const money = (amount: number, currency: "USD" | "RUB"): string =>
  `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: amount === 0 ? 0 : 2,
    maximumFractionDigits: 6
  }).format(amount)} ${currency}`;

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
  const [overrideEditorOpen, setOverrideEditorOpen] = useState(false);
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  const [overrideCapability, setOverrideCapability] = useState("");
  const [overrideMode, setOverrideMode] = useState<PermissionMode | "">("");
  const [overrideObjects, setOverrideObjects] = useState("");
  const [overridePurpose, setOverridePurpose] = useState("");
  const [overrideValidUntil, setOverrideValidUntil] = useState("");
  const [overrideRemainingUses, setOverrideRemainingUses] = useState("");
  const [limitTokens, setLimitTokens] = useState("");
  const [limitCost, setLimitCost] = useState("");
  const [limitCurrency, setLimitCurrency] = useState<"USD" | "RUB">("USD");
  const [limitPreview, setLimitPreview] = useState<UsageLimitPreview | null>(null);
  const [limitAcknowledged, setLimitAcknowledged] = useState(false);
  const [limitStepUpToken, setLimitStepUpToken] = useState("");
  const [limitPreviewing, setLimitPreviewing] = useState(false);
  const [limitApplying, setLimitApplying] = useState(false);
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
  const actionPending =
    previewing || applying || limitPreviewing || limitApplying || deciding || stopping;

  const load = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    setOverrideEditorOpen(false);
    setEditingOverrideId(null);
    setOverrideCapability("");
    setOverrideMode("");
    setOverrideObjects("");
    setOverridePurpose("");
    setOverrideValidUntil("");
    setOverrideRemainingUses("");
    setLimitPreview(null);
    setLimitAcknowledged(false);
    setLimitStepUpToken("");
    setSelectedConfirmationId(null);
    setDecisionReason("");
    setDecisionAcknowledged(false);
    setConfirmationStepUpToken("");
    setStopScope("project");
    setStopReason("");
    setStopAcknowledged(false);
    try {
      const [
        profileResponse,
        confirmationsResponse,
        decisionTrace,
        recoveryRequired,
        usage,
        usageLimitResponse,
        operations,
        projectStop
      ] = await Promise.all([
        api<{ profile: CapabilityProfile }>(
          `/api/v1/projects/${encodeURIComponent(id)}/autonomy-profile`
        ),
        api<{ items: Confirmation[] }>(`/api/v1/projects/${encodeURIComponent(id)}/confirmations`),
        api<PolicyDecisionTrace>(
          `/api/v1/projects/${encodeURIComponent(id)}/decision-trace?limit=50`
        ),
        api<PolicyRecoveryRequiredList>(
          `/api/v1/projects/${encodeURIComponent(id)}/recovery-required?limit=50`
        ),
        api<UsageSummary>(`/api/v1/projects/${encodeURIComponent(id)}/usage-summary`),
        api<{ limit: UsageLimit }>(`/api/v1/projects/${encodeURIComponent(id)}/usage-limit`),
        api<OperationsStatus>("/api/v1/operations/status"),
        api<EmergencyStop | null>(
          `/api/v1/operations/emergency-stop?project_id=${encodeURIComponent(id)}`
        )
      ]);
      setData({
        profile: profileResponse.profile,
        confirmations: confirmationsResponse.items,
        decisionTrace,
        recoveryRequired,
        usage,
        usageLimit: usageLimitResponse.limit,
        operations,
        projectStop
      });
      setLimitTokens(
        usageLimitResponse.limit.max_total_tokens === null
          ? ""
          : String(usageLimitResponse.limit.max_total_tokens)
      );
      setLimitCost(
        usageLimitResponse.limit.max_cost === null
          ? ""
          : String(usageLimitResponse.limit.max_cost.amount)
      );
      setLimitCurrency(usageLimitResponse.limit.max_cost?.currency ?? "USD");
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

  const overrideChanges = useMemo<OverrideChange[]>(() => {
    if (!data || !preview) return [];
    const current = new Map(
      data.profile.overrides.map((override) => [override.override_id, override])
    );
    const proposed = new Map(
      preview.proposed_profile.overrides.map((override) => [override.override_id, override])
    );
    const changes: OverrideChange[] = [];
    for (const next of preview.proposed_profile.overrides) {
      const existing = current.get(next.override_id);
      if (!existing) {
        changes.push({ kind: "ADDED", next });
      } else if (JSON.stringify(existing) !== JSON.stringify(next)) {
        changes.push({ kind: "UPDATED", current: existing, next });
      }
    }
    for (const existing of data.profile.overrides) {
      if (!proposed.has(existing.override_id)) changes.push({ kind: "REMOVED", current: existing });
    }
    return changes;
  }, [data, preview]);

  const resetOverrideEditor = (): void => {
    setOverrideEditorOpen(false);
    setEditingOverrideId(null);
    setOverrideCapability("");
    setOverrideMode("");
    setOverrideObjects("");
    setOverridePurpose("");
    setOverrideValidUntil("");
    setOverrideRemainingUses("");
  };

  const startNewOverride = (): void => {
    if (actionPending) return;
    setEditingOverrideId(null);
    setOverrideCapability("");
    setOverrideMode("");
    setOverrideObjects("");
    setOverridePurpose("");
    setOverrideValidUntil("");
    setOverrideRemainingUses("");
    setOverrideEditorOpen(true);
    setError(null);
  };

  const startEditingOverride = (override: CapabilityOverride): void => {
    if (actionPending) return;
    setEditingOverrideId(override.override_id);
    setOverrideCapability(override.capability_id);
    setOverrideMode(override.mode);
    setOverrideObjects(override.object_ids.join("\n"));
    setOverridePurpose(override.purpose);
    setOverrideValidUntil(dateTimeInput(override.valid_until));
    setOverrideRemainingUses(override.remaining_uses?.toString() ?? "");
    setOverrideEditorOpen(true);
    setError(null);
  };

  const previewOverrides = async (overrides: CapabilityOverride[]): Promise<void> => {
    if (!data || actionPending) return;
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
            base_level: data.profile.base_level,
            overrides,
            expected_version: data.profile.version
          }
        }
      );
      setPreview(nextPreview);
      resetOverrideEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось построить preview override");
    } finally {
      setPreviewing(false);
    }
  };

  const previewOverrideEditor = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!data || actionPending) return;
    const capability = data.profile.grants.find(
      (grant) => grant.capability_id === overrideCapability
    )?.capability_id;
    const objectIds = [...new Set(overrideObjects.split(/\r?\n/u).map((value) => value.trim()))]
      .filter(Boolean)
      .sort();
    const purpose = overridePurpose.trim();
    if (!capability || !overrideMode) {
      setError("Явно выберите capability и итоговый режим override");
      return;
    }
    if (objectIds.length === 0) {
      setError("Укажите хотя бы один точный object ID, по одному на строку");
      return;
    }
    if (!purpose) {
      setError("Укажите назначение точечного override");
      return;
    }
    let validUntil: string | null = null;
    if (overrideValidUntil) {
      const timestamp = new Date(overrideValidUntil).getTime();
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
        setError("Срок override должен быть корректным моментом в будущем");
        return;
      }
      validUntil = new Date(timestamp).toISOString();
    }
    let remainingUses: number | null = null;
    if (overrideRemainingUses) {
      if (!/^\d+$/u.test(overrideRemainingUses)) {
        setError("Число использований override должно быть целым числом от 1");
        return;
      }
      const parsed = Number(overrideRemainingUses);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        setError("Число использований override должно быть безопасным целым числом от 1");
        return;
      }
      remainingUses = parsed;
    }
    const existing = editingOverrideId
      ? data.profile.overrides.find((override) => override.override_id === editingOverrideId)
      : undefined;
    if (editingOverrideId && !existing) {
      setError("Редактируемый override уже отсутствует; перезагрузите профиль");
      return;
    }
    const next: CapabilityOverride = {
      override_id: existing?.override_id ?? `override-${crypto.randomUUID()}`,
      capability_id: capability,
      mode: overrideMode,
      object_ids: objectIds,
      purpose,
      valid_until: validUntil,
      remaining_uses: remainingUses
    };
    const overrides = existing
      ? data.profile.overrides.map((override) =>
          override.override_id === existing.override_id ? next : override
        )
      : [...data.profile.overrides, next];
    await previewOverrides(overrides);
  };

  const previewOverrideRemoval = async (overrideId: string): Promise<void> => {
    if (!data || actionPending) return;
    await previewOverrides(
      data.profile.overrides.filter((override) => override.override_id !== overrideId)
    );
  };

  const previewLevel = async (level: AutonomyLevel): Promise<void> => {
    if (!data || level === data.profile.base_level || actionPending) return;
    setPreviewing(true);
    setPreview(null);
    setAcknowledged(false);
    setStepUpToken("");
    resetOverrideEditor();
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
      setError("Для этого изменения профиля нужен одноразовый step-up токен");
      return;
    }
    const changedLevel = data.profile.base_level !== preview.proposed_profile.base_level;
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
      resetOverrideEditor();
      setNotice(
        changedLevel
          ? `Уровень автономии изменён на ${response.profile.base_level}; активна версия ${response.profile.version}.`
          : `Точечные overrides обновлены; активна версия профиля ${response.profile.version}.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось применить профиль полномочий");
    } finally {
      setStepUpToken("");
      setApplying(false);
    }
  };

  const resetLimitPreview = (): void => {
    setLimitPreview(null);
    setLimitAcknowledged(false);
    setLimitStepUpToken("");
  };

  const limitInput = (): {
    expected_version: number;
    max_total_tokens: number | null;
    max_cost: { amount: number; currency: "USD" | "RUB" } | null;
  } | null => {
    if (!data) return null;
    const tokenText = limitTokens.trim();
    const costText = limitCost.trim();
    if (tokenText && !/^\d+$/.test(tokenText)) {
      setError("Лимит токенов должен быть целым положительным числом");
      return null;
    }
    const maxTotalTokens = tokenText ? Number(tokenText) : null;
    if (maxTotalTokens !== null && (!Number.isSafeInteger(maxTotalTokens) || maxTotalTokens < 1)) {
      setError("Лимит токенов должен быть безопасным целым числом больше нуля");
      return null;
    }
    if (costText && !/^\d+(?:[.,]\d+)?$/.test(costText)) {
      setError("Лимит стоимости должен быть положительным числом");
      return null;
    }
    const maxCostAmount = costText ? Number(costText.replace(",", ".")) : null;
    if (maxCostAmount !== null && (!Number.isFinite(maxCostAmount) || maxCostAmount <= 0)) {
      setError("Лимит стоимости должен быть конечным числом больше нуля");
      return null;
    }
    return {
      expected_version: data.usageLimit.version,
      max_total_tokens: maxTotalTokens,
      max_cost: maxCostAmount === null ? null : { amount: maxCostAmount, currency: limitCurrency }
    };
  };

  const previewUsageLimit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!data || actionPending) return;
    setError(null);
    setNotice(null);
    resetLimitPreview();
    const input = limitInput();
    if (!input) return;
    setLimitPreviewing(true);
    try {
      const nextPreview = await api<UsageLimitPreview>(
        `/api/v1/projects/${encodeURIComponent(data.profile.project_id)}/usage-limit/preview`,
        { method: "POST", body: input }
      );
      setLimitPreview(nextPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось проверить hard limit");
    } finally {
      setLimitPreviewing(false);
    }
  };

  const applyUsageLimit = async (): Promise<void> => {
    if (!data || !limitPreview || !limitAcknowledged || actionPending) return;
    const token = limitStepUpToken.trim();
    if (limitPreview.requires_step_up && !token) {
      setError("Для расширения или снятия hard limit нужен одноразовый step-up токен");
      return;
    }
    setLimitApplying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api<{ limit: UsageLimit }>(
        `/api/v1/projects/${encodeURIComponent(data.profile.project_id)}/usage-limit`,
        {
          method: "PUT",
          ...(limitPreview.requires_step_up ? { headers: { "x-step-up-token": token } } : {}),
          body: {
            expected_version: limitPreview.current_version,
            max_total_tokens: limitPreview.proposed_limit.max_total_tokens,
            max_cost: limitPreview.proposed_limit.max_cost
          }
        }
      );
      setData((current) => (current ? { ...current, usageLimit: response.limit } : current));
      setLimitTokens(
        response.limit.max_total_tokens === null ? "" : String(response.limit.max_total_tokens)
      );
      setLimitCost(response.limit.max_cost === null ? "" : String(response.limit.max_cost.amount));
      setLimitCurrency(response.limit.max_cost?.currency ?? limitCurrency);
      resetLimitPreview();
      setNotice(`Hard limit проекта сохранён как версия ${response.limit.version}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось применить hard limit");
    } finally {
      setLimitStepUpToken("");
      setLimitApplying(false);
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
            Уровень A0–A6 и точечные object-scoped overrides изменяются только после серверного
            preview и явной проверки разницы. Ожидающие действия проходят отдельную проверку перед
            approve/reject, Policy Decision Trace объясняет решения без содержимого задач, а
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
                  <h2 id="authority-preview-title">
                    {data.profile.base_level === preview.proposed_profile.base_level
                      ? "Проверка точечного override"
                      : "Проверка перед изменением уровня"}
                  </h2>
                </div>
                <strong>
                  {data.profile.base_level === preview.proposed_profile.base_level
                    ? `overrides ${data.profile.overrides.length} → ${preview.proposed_profile.overrides.length}`
                    : `${data.profile.base_level} → ${preview.proposed_profile.base_level}`}
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

              {overrideChanges.length > 0 && (
                <div className={styles.overrideDiff} aria-label="Изменения точечных overrides">
                  <h3>Точные изменения overrides</h3>
                  <div>
                    {overrideChanges.map((change) => {
                      const before = change.kind === "ADDED" ? null : change.current;
                      const after = change.kind === "REMOVED" ? null : change.next;
                      const visible = after ?? before;
                      if (!visible) return null;
                      return (
                        <article
                          key={`${change.kind}-${visible.override_id}`}
                          data-change={change.kind}
                        >
                          <header>
                            <strong>
                              {change.kind === "ADDED"
                                ? "Добавление"
                                : change.kind === "UPDATED"
                                  ? "Изменение"
                                  : "Удаление"}
                            </strong>
                            <em>{visible.capability_id}</em>
                          </header>
                          <dl>
                            <div>
                              <dt>Режим</dt>
                              <dd>
                                {before?.mode ?? "—"} → {after?.mode ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Объекты</dt>
                              <dd>
                                {before?.object_ids.join(" · ") ?? "—"} →{" "}
                                {after?.object_ids.join(" · ") ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Назначение</dt>
                              <dd>
                                {before?.purpose ?? "—"} → {after?.purpose ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Срок</dt>
                              <dd>
                                {dateTime(before?.valid_until ?? null)} →{" "}
                                {dateTime(after?.valid_until ?? null)}
                              </dd>
                            </div>
                            <div>
                              <dt>Использования</dt>
                              <dd>
                                {before ? (before.remaining_uses ?? "без счётчика") : "—"} →{" "}
                                {after ? (after.remaining_uses ?? "без счётчика") : "—"}
                              </dd>
                            </div>
                          </dl>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className={styles.acknowledgement}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  Я проверил базовые полномочия, точные объекты, режим, назначение, срок и число
                  использований и хочу применить профиль.
                </span>
              </label>

              {preview.requires_step_up && (
                <label className={styles.stepUp}>
                  <span>Одноразовый step-up токен</span>
                  <input
                    type="password"
                    value={stepUpToken}
                    onChange={(event) => setStepUpToken(event.target.value)}
                    autoComplete="one-time-code"
                    placeholder="Требуется для расширения критических полномочий"
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
                  {applying
                    ? "Применяю…"
                    : data.profile.base_level === preview.proposed_profile.base_level
                      ? "Применить override"
                      : `Применить ${preview.proposed_profile.base_level}`}
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
                  <h2>Базовые полномочия</h2>
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

            <section className={styles.panel} aria-labelledby="point-overrides-title">
              <header>
                <div>
                  <span className={styles.eyebrow}>Overrides</span>
                  <h2 id="point-overrides-title">Точечные исключения</h2>
                </div>
                <span className={styles.meta}>{data.profile.overrides.length}</span>
              </header>
              <p className={styles.overrideBoundary}>
                Override действует только для явно перечисленных object IDs. Любое изменение сначала
                проходит серверный preview профиля и отдельное подтверждение владельца.
              </p>
              <div className={styles.cardList}>
                {data.profile.overrides.map((override) => (
                  <article key={override.override_id}>
                    <div className={styles.cardTop}>
                      <strong>{override.capability_id}</strong>
                      <em data-mode={override.mode}>{override.mode}</em>
                    </div>
                    <p>{override.purpose}</p>
                    <small>
                      objects {override.object_ids.join(" · ")} · использований{" "}
                      {override.remaining_uses ?? "без счётчика"} · до{" "}
                      {dateTime(override.valid_until)}
                    </small>
                    <div className={styles.overrideActions}>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => startEditingOverride(override)}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        data-action="remove"
                        disabled={actionPending}
                        onClick={() => void previewOverrideRemoval(override.override_id)}
                      >
                        Удалить через preview
                      </button>
                    </div>
                  </article>
                ))}
                {data.profile.overrides.length === 0 && (
                  <p className={styles.muted}>Точечных overrides сейчас нет.</p>
                )}
              </div>

              {!overrideEditorOpen && (
                <button
                  type="button"
                  className={styles.overrideEditorToggle}
                  disabled={actionPending || preview !== null}
                  onClick={startNewOverride}
                >
                  Добавить точечный override
                </button>
              )}

              {overrideEditorOpen && (
                <form
                  className={styles.overrideEditor}
                  onSubmit={(event) => void previewOverrideEditor(event)}
                >
                  <div className={styles.overrideEditorIntro}>
                    <strong>{editingOverrideId ? "Изменить override" : "Новый override"}</strong>
                    <span>Пустые значения не заменяются скрытыми defaults.</span>
                  </div>
                  <div className={styles.overrideFields}>
                    <label>
                      <span>Capability</span>
                      <select
                        aria-label="Capability override"
                        value={overrideCapability}
                        disabled={actionPending}
                        onChange={(event) => setOverrideCapability(event.target.value)}
                      >
                        <option value="">Выберите явно</option>
                        {data.profile.grants.map((grant) => (
                          <option key={grant.capability_id} value={grant.capability_id}>
                            {grant.capability_id} · base {grant.mode}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Итоговый режим</span>
                      <select
                        aria-label="Режим override"
                        value={overrideMode}
                        disabled={actionPending}
                        onChange={(event) =>
                          setOverrideMode(event.target.value as PermissionMode | "")
                        }
                      >
                        <option value="">Выберите явно</option>
                        {PERMISSION_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Действует до · необязательно</span>
                      <input
                        type="datetime-local"
                        aria-label="Срок override"
                        value={overrideValidUntil}
                        disabled={actionPending}
                        onChange={(event) => setOverrideValidUntil(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Число использований · необязательно</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        aria-label="Число использований override"
                        value={overrideRemainingUses}
                        disabled={actionPending}
                        onChange={(event) => setOverrideRemainingUses(event.target.value)}
                        placeholder="Без счётчика"
                      />
                    </label>
                    <label className={styles.overrideWide}>
                      <span>Точные object IDs · по одному на строку</span>
                      <textarea
                        aria-label="Object IDs override"
                        value={overrideObjects}
                        disabled={actionPending}
                        onChange={(event) => setOverrideObjects(event.target.value)}
                        placeholder="project-or-resource-id"
                      />
                    </label>
                    <label className={styles.overrideWide}>
                      <span>Назначение</span>
                      <textarea
                        aria-label="Назначение override"
                        value={overridePurpose}
                        disabled={actionPending}
                        maxLength={2000}
                        onChange={(event) => setOverridePurpose(event.target.value)}
                        placeholder="Почему именно этот режим нужен для этих объектов"
                      />
                    </label>
                  </div>
                  <p className={styles.overrideCounterBoundary}>
                    Пустое значение означает отсутствие счётчика. Конечное значение уменьшается
                    атомарно при reservation разрешённой операции; последнее использование удаляет
                    override, а replay не списывает использование повторно.
                  </p>
                  <div className={styles.overrideEditorActions}>
                    <button
                      type="submit"
                      disabled={
                        actionPending ||
                        !overrideCapability ||
                        !overrideMode ||
                        !overrideObjects.trim() ||
                        !overridePurpose.trim()
                      }
                    >
                      Проверить override
                    </button>
                    <button type="button" disabled={actionPending} onClick={resetOverrideEditor}>
                      Отменить
                    </button>
                  </div>
                </form>
              )}
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

          <section className={styles.decisionTrace} aria-labelledby="policy-decision-trace-title">
            <header>
              <div>
                <span className={styles.eyebrow}>Policy Decision Trace</span>
                <h2 id="policy-decision-trace-title">Почему Policy Runtime принял решение</h2>
              </div>
              <span className={styles.generated}>
                {data.decisionTrace.items.length} из последних {data.decisionTrace.limit}
              </span>
            </header>

            <p className={styles.traceBoundary}>
              Журнал показывает только actor, operation, capabilities, точные ссылки на объекты,
              verdict и причины Policy Runtime. Purpose, idempotency keys, request/result, prompts и
              секреты через этот API не выдаются.
            </p>

            <div className={styles.traceList}>
              {data.decisionTrace.items.map((decision) => (
                <article key={decision.decision_id} data-verdict={decision.verdict}>
                  <div className={styles.traceTop}>
                    <strong>{VERDICT_LABELS[decision.verdict]}</strong>
                    <em data-verdict={decision.verdict}>{decision.verdict}</em>
                  </div>
                  <p>{decision.reasons.join(" · ")}</p>
                  <dl className={styles.traceDetails}>
                    <div>
                      <dt>Capabilities</dt>
                      <dd>{decision.capability_ids.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Объекты</dt>
                      <dd>
                        {decision.object_ids.length > 0
                          ? decision.object_ids.join(" · ")
                          : "Без конкретного объекта"}
                      </dd>
                    </div>
                    <div>
                      <dt>Actor</dt>
                      <dd>{decision.actor_id}</dd>
                    </div>
                    <div>
                      <dt>Operation</dt>
                      <dd>{decision.operation_id}</dd>
                    </div>
                  </dl>
                  <small>
                    {dateTime(decision.created_at)} · policy {decision.policy_version}
                    {decision.evaluated_at === decision.created_at
                      ? ""
                      : ` · оценено ${dateTime(decision.evaluated_at)}`}
                  </small>
                </article>
              ))}
              {data.decisionTrace.items.length === 0 && (
                <p className={styles.muted}>
                  Policy Runtime ещё не записывал решений для этого проекта.
                </p>
              )}
            </div>
          </section>

          <section
            className={styles.recoveryPanel}
            aria-labelledby="policy-recovery-required-title"
          >
            <header>
              <div>
                <span className={styles.eyebrow}>Recovery boundary</span>
                <h2 id="policy-recovery-required-title">Операции, требующие сверки</h2>
              </div>
              <span className={styles.generated}>
                {data.recoveryRequired.items.length} из последних {data.recoveryRequired.limit}
              </span>
            </header>

            <p className={styles.recoveryBoundary}>
              Эти операции остались в RESERVED, поэтому внешний результат неизвестен. Control Center
              не повторяет, не возобновляет и не завершает их автоматически: владелец сначала
              сверяет результат во внешней системе. Purpose, idempotency key, request, result и
              секреты здесь не раскрываются.
            </p>

            <div className={styles.recoveryList}>
              {data.recoveryRequired.items.map((operation) => (
                <article key={operation.operation_id}>
                  <div className={styles.recoveryTop}>
                    <strong>Внешний результат неизвестен</strong>
                    <em>{operation.recovery_status}</em>
                  </div>
                  <p>{operation.reasons.join(" · ")}</p>
                  <dl className={styles.traceDetails}>
                    <div>
                      <dt>Capabilities</dt>
                      <dd>{operation.capability_ids.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Объекты</dt>
                      <dd>
                        {operation.object_ids.length > 0
                          ? operation.object_ids.join(" · ")
                          : "Без конкретного объекта"}
                      </dd>
                    </div>
                    <div>
                      <dt>Actor</dt>
                      <dd>{operation.actor_id}</dd>
                    </div>
                    <div>
                      <dt>Operation</dt>
                      <dd>{operation.operation_id}</dd>
                    </div>
                  </dl>
                  <small>
                    резерв {dateTime(operation.reserved_at)} · policy {operation.policy_version}
                  </small>
                </article>
              ))}
              {data.recoveryRequired.items.length === 0 && (
                <p className={styles.muted}>Незавершённых RESERVED-операций нет.</p>
              )}
            </div>
          </section>

          <section className={styles.usagePanel} aria-labelledby="project-usage-title">
            <header>
              <div>
                <span className={styles.eyebrow}>Usage Ledger</span>
                <h2 id="project-usage-title">Расходы и лимиты проекта</h2>
              </div>
              <span className={styles.generated}>снимок {dateTime(data.usage.generated_at)}</span>
            </header>

            <div className={styles.usageGrid}>
              <article>
                <span>Использовано токенов</span>
                <strong>
                  {integer(data.usage.tokens.committed_input + data.usage.tokens.committed_output)}
                </strong>
                <small>
                  вход {integer(data.usage.tokens.committed_input)} · выход{" "}
                  {integer(data.usage.tokens.committed_output)}
                </small>
              </article>
              <article>
                <span>Активный резерв</span>
                <strong>{integer(data.usage.tokens.reserved_upper_bound)}</strong>
                <small>верхняя граница токенов · {data.usage.attempts.reserved} попыток</small>
              </article>
              <article>
                <span>Попытки маршрута</span>
                <strong>
                  {data.usage.attempts.committed}/{data.usage.attempts.total}
                </strong>
                <small>
                  failed {data.usage.attempts.failed} · cancelled {data.usage.attempts.cancelled}
                </small>
              </article>
              <article
                data-limit={
                  data.usageLimit.max_total_tokens === null && data.usageLimit.max_cost === null
                    ? "unset"
                    : "active"
                }
              >
                <span>Hard limit проекта</span>
                <strong>
                  {data.usageLimit.max_total_tokens === null && data.usageLimit.max_cost === null
                    ? "НЕ НАСТРОЕН"
                    : `АКТИВЕН · v${data.usageLimit.version}`}
                </strong>
                <small>
                  токены{" "}
                  {data.usageLimit.max_total_tokens === null
                    ? "без потолка"
                    : integer(data.usageLimit.max_total_tokens)}{" "}
                  · стоимость{" "}
                  {data.usageLimit.max_cost === null
                    ? "без потолка"
                    : money(data.usageLimit.max_cost.amount, data.usageLimit.max_cost.currency)}
                </small>
              </article>
            </div>

            <div className={styles.usageCosts}>
              {data.usage.costs.map((cost) => (
                <article key={cost.currency}>
                  <span>{cost.currency}</span>
                  <strong>{money(cost.committed_amount, cost.currency)}</strong>
                  <small>активный резерв {money(cost.reserved_amount, cost.currency)}</small>
                </article>
              ))}
              {data.usage.costs.length === 0 && (
                <p className={styles.muted}>Подтверждённой стоимости пока нет.</p>
              )}
            </div>

            <form
              className={styles.limitControl}
              aria-labelledby="project-limit-control-title"
              onSubmit={(event) => void previewUsageLimit(event)}
            >
              <div className={styles.limitIntro}>
                <div>
                  <span className={styles.eyebrow}>Owner hard ceiling</span>
                  <h3 id="project-limit-control-title">Настроить накопительный hard limit</h3>
                </div>
                <span>limit v{data.usageLimit.version}</span>
              </div>

              <div className={styles.limitFields}>
                <label>
                  <span>Всего токенов</span>
                  <input
                    value={limitTokens}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Пусто — без лимита"
                    disabled={actionPending}
                    onChange={(event) => {
                      setLimitTokens(event.target.value);
                      resetLimitPreview();
                    }}
                  />
                </label>
                <label>
                  <span>Стоимость</span>
                  <input
                    value={limitCost}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Пусто — без лимита"
                    disabled={actionPending}
                    onChange={(event) => {
                      setLimitCost(event.target.value);
                      resetLimitPreview();
                    }}
                  />
                </label>
                <label>
                  <span>Валюта стоимости</span>
                  <select
                    value={limitCurrency}
                    disabled={actionPending || !limitCost.trim()}
                    onChange={(event) => {
                      setLimitCurrency(event.target.value as "USD" | "RUB");
                      resetLimitPreview();
                    }}
                  >
                    <option value="USD">USD</option>
                    <option value="RUB">RUB</option>
                  </select>
                </label>
              </div>

              <button className={styles.limitPreviewButton} disabled={actionPending}>
                {limitPreviewing ? "Проверяю…" : "Проверить hard limit"}
              </button>

              {limitPreview && (
                <section className={styles.limitPreview} aria-label="Preview hard limit проекта">
                  <div>
                    <strong>
                      Серверный preview · будущая v{limitPreview.proposed_limit.version}
                    </strong>
                    <span>
                      токены{" "}
                      {limitPreview.proposed_limit.max_total_tokens === null
                        ? "без потолка"
                        : integer(limitPreview.proposed_limit.max_total_tokens)}{" "}
                      · стоимость{" "}
                      {limitPreview.proposed_limit.max_cost === null
                        ? "без потолка"
                        : money(
                            limitPreview.proposed_limit.max_cost.amount,
                            limitPreview.proposed_limit.max_cost.currency
                          )}
                    </span>
                  </div>
                  <p>
                    {limitPreview.requires_step_up
                      ? "Изменение расширяет или снимает потолок и требует step-up."
                      : "Изменение не расширяет действующий потолок; step-up не требуется."}
                  </p>

                  <label className={styles.acknowledgement}>
                    <input
                      type="checkbox"
                      checked={limitAcknowledged}
                      onChange={(event) => setLimitAcknowledged(event.target.checked)}
                    />
                    <span>
                      Я проверил накопительный потолок и понимаю, что новые резервы сверх него будут
                      отклонены до обращения к провайдеру.
                    </span>
                  </label>

                  {limitPreview.requires_step_up && (
                    <label className={styles.stepUp}>
                      <span>Одноразовый step-up токен</span>
                      <input
                        type="password"
                        value={limitStepUpToken}
                        onChange={(event) => setLimitStepUpToken(event.target.value)}
                        autoComplete="one-time-code"
                        placeholder="Для расширения или снятия потолка"
                      />
                      <small>Токен не сохраняется и очищается после запроса.</small>
                    </label>
                  )}

                  <div className={styles.previewActions}>
                    <button
                      type="button"
                      className={styles.applyButton}
                      disabled={
                        !limitAcknowledged ||
                        actionPending ||
                        (limitPreview.requires_step_up && !limitStepUpToken.trim())
                      }
                      onClick={() => void applyUsageLimit()}
                    >
                      {limitApplying ? "Применяю…" : "Применить hard limit"}
                    </button>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      disabled={actionPending}
                      onClick={() => {
                        resetLimitPreview();
                        setError(null);
                      }}
                    >
                      Отменить preview
                    </button>
                  </div>
                </section>
              )}
            </form>

            <p className={styles.usageBoundary}>
              Hard limit проверяется атомарно по накопленным committed и активным reserved значениям
              до создания нового резерва. При включённом потолке неизвестные токены, цена или другая
              валюта закрывают маршрут без вызова провайдера. Автопополнения нет. Показаны только
              суммарные токены, статусы и стоимость в исходной валюте журнала. Провайдер, модель,
              Registry route, запросы и содержимое сообщений не выдаются.
              {data.usage.unknown_committed_cost_attempts > 0
                ? ` Стоимость не подтверждена для ${data.usage.unknown_committed_cost_attempts} завершённых попыток.`
                : ""}
              {data.usage.unknown_reserved_cost_attempts > 0
                ? ` Ещё ${data.usage.unknown_reserved_cost_attempts} активных резервов не имеют подтверждённой цены.`
                : ""}
              {data.usage.tokens.unknown_committed_attempts > 0
                ? ` Токены не подтверждены для ${data.usage.tokens.unknown_committed_attempts} завершённых попыток.`
                : ""}
            </p>
          </section>

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
