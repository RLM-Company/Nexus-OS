"use client";
import { projectWorkTimeline, type WorkTimelineSource } from "@cosmora/core";
import styles from "./work-timeline-card.module.css";

/** Compact owner-facing card for a Work run. Renders the pure projection of
 * state/events without changing the chat shell, composer or sidebar. The card
 * is intentionally self-contained so the owner can choose its mount point. */
export function WorkTimelineCard({ work, title }: { work: WorkTimelineSource; title?: string }) {
  const timeline = projectWorkTimeline(work);
  return (
    <section
      className={styles.card}
      data-progress={timeline.progress}
      aria-label={title ?? "План и таймер работы"}
    >
      <header>
        <strong>{title ?? timeline.title}</strong>
        <span className={styles.progress}>{timeline.progress}</span>
      </header>
      {timeline.error_code && <p role="alert">Ошибка: {timeline.error_code}</p>}
      <p className={styles.meta}>Запросов модели: {timeline.model_requests}</p>
      <ol>
        {timeline.steps.map((step) => (
          <li key={step.sequence} data-kind={step.kind}>
            <time dateTime={step.at}>{new Date(step.at).toLocaleTimeString()}</time>{" "}
            <span>{step.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
