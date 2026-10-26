"use client";

import type { ReactNode } from "react";
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

export { ModelPicker } from "./model-picker";

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
