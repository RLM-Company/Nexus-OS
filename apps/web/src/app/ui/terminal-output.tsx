"use client";

import { useId, useState } from "react";
import { WindowDots } from "./code-window";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./terminal-output.module.css";

/** Displays only captured executor output; no simulated commands or generated animation. */
export function TerminalOutput({
  stdout = "",
  stderr = "",
  status,
  truncated = false
}: {
  stdout?: string | undefined;
  stderr?: string | undefined;
  status?: string;
  truncated?: boolean | undefined;
}) {
  const [filter, setFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useId();
  const value =
    filter === "stdout"
      ? stdout
      : filter === "stderr"
        ? stderr
        : [stdout, stderr].filter(Boolean).join("\n");
  const empty = !stdout && !stderr;
  const statuses: Record<string, string> = {
    passed: "Успешно",
    failed: "Ошибка",
    timed_out: "Лимит времени",
    cancelled: "Отменено",
    unavailable: "Недоступен",
    running: "Выполняется"
  };
  return (
    <section className={styles.terminal} aria-label="Вывод исполнителя">
      <div className={styles.header}>
        <WindowDots />
        <span className={styles.title}>
          <span aria-hidden="true">›_</span> Терминал
        </span>
        {status && <span className={styles.status}>{statuses[status] ?? status}</span>}
        <button
          type="button"
          aria-label="Копировать вывод"
          disabled={!value}
          onClick={() => {
            setFailed(false);
            if (!navigator.clipboard) {
              setFailed(true);
              return;
            }
            void navigator.clipboard.writeText(value).then(
              () => setCopied(value),
              () => setFailed(true)
            );
          }}
        >
          <WorkspaceIcon name={copied === value && value ? "check" : "copy"} />
        </button>
      </div>
      <div className={styles.filters} role="group" aria-label="Потоки вывода">
        {(
          [
            ["all", "Весь вывод"],
            ["stdout", "stdout"],
            ["stderr", "stderr"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            aria-controls={`${id}-output`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <span>{new TextEncoder().encode(value).byteLength.toLocaleString("ru-RU")} Б</span>
      </div>
      <div id={`${id}-output`} className={styles.output}>
        {empty ? (
          <p className={styles.empty}>Исполнитель не вернул вывод.</p>
        ) : (
          <>
            {filter !== "stderr" && stdout && (
              <div className={styles.stream}>
                <span className={styles.streamLabel}>stdout</span>
                <pre tabIndex={0} aria-label="Стандартный вывод">
                  {stdout}
                </pre>
              </div>
            )}
            {filter !== "stdout" && stderr && (
              <div className={`${styles.stream} ${styles.stderr}`}>
                <span className={styles.streamLabel}>stderr</span>
                <pre tabIndex={0} aria-label="Вывод ошибок">
                  {stderr}
                </pre>
              </div>
            )}
            {filter !== "all" && !value && <p className={styles.empty}>Поток {filter} пуст.</p>}
          </>
        )}
      </div>
      {(truncated || failed || (copied === value && value)) && (
        <p className={styles.notice} role={failed ? "alert" : "status"}>
          {failed
            ? "Не удалось скопировать. Выделите текст вручную."
            : truncated
              ? "Вывод ограничен сервером."
              : "Вывод скопирован."}
        </p>
      )}
    </section>
  );
}
