"use client";

import styles from "./version-timeline.module.css";

export type VersionStatus = "saved" | "current" | "draft" | "conflict";
export type TimelineVersion = {
  id: string;
  label: string;
  createdAt: string;
  /** The host may provide a display date in the owner's time zone. */
  timeLabel?: string;
  author?: string;
  detail?: string;
  status?: VersionStatus;
  linesAdded?: number;
  linesRemoved?: number;
};
export type VersionTimelineProps = {
  versions: readonly TimelineVersion[];
  selectedId?: string;
  onSelect?: (versionId: string) => void;
  /** Host owns permissions, confirmation and restore-as-new behavior. */
  onRequestRestore?: (versionId: string) => void;
  restoringId?: string;
  emptyText?: string;
};
const STATUS: Record<VersionStatus, string> = {
  saved: "Сохранена",
  current: "Текущая",
  draft: "Черновик",
  conflict: "Конфликт"
};
const count = (value: number) =>
  Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER) : 0;

export function VersionDiffBadge({
  added = 0,
  removed = 0
}: {
  added?: number | undefined;
  removed?: number | undefined;
}) {
  return (
    <span
      className={styles.diff}
      aria-label={`Добавлено ${count(added)} строк, удалено ${count(removed)} строк`}
    >
      <span>+{count(added)}</span>
      <span>−{count(removed)}</span>
    </span>
  );
}

/** View-only primitive; renders actions only when the host implements them. */
export function VersionTimeline({
  versions,
  selectedId,
  onSelect,
  onRequestRestore,
  restoringId,
  emptyText = "Версий пока нет"
}: VersionTimelineProps) {
  if (!versions.length) return <p className={styles.empty}>{emptyText}</p>;
  return (
    <ol className={styles.timeline} aria-label="История версий">
      {versions.map((version) => {
        const selected = version.id === selectedId;
        const date = new Date(version.createdAt);
        const validTime = Number.isFinite(date.getTime());
        // Deterministic SSR/client fallback; no host/browser time-zone disagreement.
        const time =
          version.timeLabel ??
          (validTime
            ? date
                .toISOString()
                .replace("T", " ")
                .replace(/\.\d{3}Z$/, " UTC")
            : version.createdAt);
        return (
          <li key={version.id} className={`${styles.version} ${selected ? styles.selected : ""}`}>
            <span className={styles.node} aria-hidden="true" />
            <div className={styles.info}>
              {onSelect ? (
                <button
                  className={styles.select}
                  type="button"
                  onClick={() => onSelect(version.id)}
                  aria-current={selected ? "true" : undefined}
                >
                  {version.label}
                </button>
              ) : (
                <strong>{version.label}</strong>
              )}
              <div className={styles.meta}>
                <time dateTime={validTime ? date.toISOString() : undefined}>{time}</time>
                {version.author && <span>{version.author}</span>}
                {version.status && <span className={styles.tag}>{STATUS[version.status]}</span>}
              </div>
              {version.detail && <p>{version.detail}</p>}
              {(version.linesAdded !== undefined || version.linesRemoved !== undefined) && (
                <VersionDiffBadge added={version.linesAdded} removed={version.linesRemoved} />
              )}
            </div>
            {onRequestRestore && version.status !== "current" && (
              <button
                type="button"
                className={styles.restore}
                onClick={() => onRequestRestore(version.id)}
                disabled={Boolean(restoringId)}
                aria-label={`Запросить восстановление версии ${version.label}`}
              >
                {restoringId === version.id ? "Восстановление…" : "Восстановить"}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
