import type { ReactNode } from "react";
import styles from "./activity-timeline.module.css";

export type ActivityTimelineItem = {
  id: string | number;
  at: string;
  title: string;
  detail?: ReactNode;
};

/** A trace of persisted events. It does not simulate spans or replay provider activity. */
export function ActivityTimeline({
  items,
  label,
  empty = "Событий пока нет."
}: {
  items: readonly ActivityTimelineItem[];
  label: string;
  empty?: string;
}) {
  if (!items.length) return <p className={styles.empty}>{empty}</p>;
  return (
    <ol className={styles.timeline} aria-label={label}>
      {items.map((item) => {
        const date = new Date(item.at);
        const validDate = Number.isFinite(date.getTime());
        return (
          <li key={item.id}>
            <span className={styles.dot} aria-hidden="true" />
            <div className={styles.content}>
              <strong>{item.title}</strong>
              {validDate && <time dateTime={item.at}>{date.toLocaleString("ru-RU")}</time>}
              {item.detail && <div className={styles.detail}>{item.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
