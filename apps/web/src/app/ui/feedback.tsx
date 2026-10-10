import type { ReactNode } from "react";
import styles from "./feedback.module.css";

export function StatusPill({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <span className={styles.pill} role={busy ? "status" : undefined}>
      <span className={busy ? styles.spinner : styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

export function LoadingDots({ label, announce = false }: { label: string; announce?: boolean }) {
  return (
    <span className={styles.loading} role={announce ? "status" : undefined}>
      <span className={styles.dots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const bounded =
    value === null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value));
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={bounded ?? undefined}
    >
      <span
        className={bounded === null ? styles.indeterminate : styles.fill}
        style={bounded === null ? undefined : { width: `${bounded}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, label = "Загрузка" }: { lines?: number; label?: string }) {
  const count = Number.isFinite(lines) ? Math.max(1, Math.min(6, Math.floor(lines))) : 3;
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  );
}
