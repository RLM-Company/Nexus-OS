"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./kosmora-controls.module.css";

export function Switch({
  checked,
  onChange,
  disabled,
  children
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={styles.switchLabel}>
      <input
        className={styles.switchInput}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span />
      </span>
      <span>{children}</span>
    </label>
  );
}

export function ShiningText({ children }: { children: ReactNode }) {
  return <span className={styles.shining}>{children}</span>;
}

export function SystemMessage({
  children,
  kind = "error",
  action
}: {
  children: ReactNode;
  kind?: "error" | "warning" | "info" | "success";
  action?: ReactNode;
}) {
  return (
    <div
      className={styles.systemMessage}
      data-kind={kind}
      role={kind === "error" ? "alert" : "status"}
    >
      <WorkspaceIcon name={kind === "success" ? "check" : kind === "info" ? "chats" : "shield"} />
      <div>
        <strong>
          {
            {
              error: "Не удалось завершить действие",
              warning: "Требуется внимание",
              info: "Информация",
              success: "Готово"
            }[kind]
          }
        </strong>
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function VoiceOrb({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={styles.voiceState} role="status">
      <span className={styles.orb} data-active={active || undefined} aria-hidden="true" />
      <span>{active ? <ShiningText>{label}</ShiningText> : label}</span>
    </div>
  );
}

/** Reads and writes the existing account preference; no speculative models or reasoning levels. */
export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  type Preferences = Record<string, unknown> & {
    version: number;
    preferred_provider: string | null;
    preferred_model: string | null;
  };
  type Route = { provider: string; model: string; capabilities: { streaming?: boolean } };
  const [data, setData] = useState<{ settings: Preferences; available_models: Route[] } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);
  const id = useId();
  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/v1/personal-settings", {
          cache: "no-store",
          signal: abort.signal
        });
        if (!response.ok) throw new Error();
        const next = (await response.json()) as NonNullable<typeof data>;
        if (!abort.signal.aborted) setData(next);
      } catch {
        /* The default server route remains available when settings are offline. */
      }
    };
    void refresh();
    const outside = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      abort.abort();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  const select = async (route: Route | null) => {
    if (!data || busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      // Fetch the latest version so changing a model cannot overwrite a just-saved Relay setting.
      const current = await fetch("/api/v1/personal-settings", { cache: "no-store" });
      if (!current.ok) throw new Error();
      const latest = (await current.json()) as NonNullable<typeof data>;
      const settings = latest.settings;
      const response = await fetch("/api/v1/personal-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version: settings.version,
          relay_enabled: settings.relay_enabled,
          response_language: settings.response_language,
          optimize_for: settings.optimize_for,
          chat_style: settings.chat_style,
          max_total_tokens: settings.max_total_tokens,
          preferred_provider: route?.provider ?? null,
          preferred_model: route?.model ?? null
        })
      });
      if (!response.ok) throw new Error();
      const saved = (await response.json()) as { settings: Preferences };
      setData({ ...latest, settings: saved.settings });
      if (menu.current) menu.current.open = false;
    } catch {
      setError("Модель не изменена. Повторите выбор.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className={styles.modelPicker} ref={menu}>
      <summary
        aria-label="Выбор модели"
        aria-controls={id}
        onClick={(event) => {
          if (disabled || busy) event.preventDefault();
        }}
        aria-disabled={disabled || busy}
      >
        <span className={styles.modelBall} aria-hidden="true" />
        <span>{busy ? "Сохраняю…" : (data?.settings.preferred_model ?? "Модель")}</span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div id={id} className={styles.modelMenu}>
        <strong>Модель для новых запросов</strong>
        <button
          type="button"
          disabled={!data || disabled || busy}
          aria-pressed={!data?.settings.preferred_model}
          onClick={() => void select(null)}
        >
          По умолчанию
        </button>
        {data?.available_models
          .filter((route) => route.capabilities.streaming)
          .map((route) => (
            <button
              type="button"
              key={`${route.provider}/${route.model}`}
              disabled={disabled || busy}
              aria-pressed={
                data.settings.preferred_provider === route.provider &&
                data.settings.preferred_model === route.model
              }
              onClick={() => void select(route)}
            >
              <span>
                {route.model}
                <small>{route.provider}</small>
              </span>
              {data.settings.preferred_model === route.model && <WorkspaceIcon name="check" />}
            </button>
          ))}
        {!data && <p>Настройки пока недоступны. Используется модель сервера.</p>}
        {error && <p role="alert">{error}</p>}
        <a href="/personal-settings">Все настройки модели</a>
      </div>
    </details>
  );
}

export type PipelineStep = {
  id: string;
  title: string;
  status: string;
  detail?: string | undefined;
};
export function AgentPipeline({ steps }: { steps: PipelineStep[] }) {
  const labels: Record<string, string> = {
    pending: "Ожидает",
    ready: "В очереди",
    running: "Выполняется",
    waiting: "Ожидает решения",
    completed: "Готово",
    skipped: "Не требуется",
    failed: "Ошибка",
    cancelled: "Отменено"
  };
  return (
    <ol className={styles.pipeline} aria-label="Задачи и зависимости">
      {steps.map((step, index) => (
        <li key={step.id} data-state={step.status}>
          <span className={styles.stepNode} aria-hidden="true">
            {step.status === "completed" ? <WorkspaceIcon name="check" /> : index + 1}
          </span>
          <div>
            <strong>{step.title}</strong>
            <small>
              {step.status === "running" ? (
                <ShiningText>{labels[step.status]}</ShiningText>
              ) : (
                (labels[step.status] ?? step.status)
              )}
            </small>
            {step.detail && <p>{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export type PricingPlan = {
  id: string;
  name: string;
  price: string;
  description: string;
  features: string[];
  highlighted?: boolean;
};
/** Future billing surface accepts real configured plans only, with no invented prices or checkout. */
export function PricingTable({
  plans,
  onSelect
}: {
  plans: PricingPlan[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className={styles.pricing}>
      {plans.length === 0 ? (
        <p>Тарифы ещё не опубликованы.</p>
      ) : (
        plans.map((plan) => (
          <article key={plan.id} data-highlighted={plan.highlighted || undefined}>
            <h3>{plan.name}</h3>
            <strong>{plan.price}</strong>
            <p>{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <WorkspaceIcon name="check" />
                  {feature}
                </li>
              ))}
            </ul>
            <button type="button" disabled={!onSelect} onClick={() => onSelect?.(plan.id)}>
              Выбрать {plan.name}
            </button>
          </article>
        ))
      )}
    </div>
  );
}
