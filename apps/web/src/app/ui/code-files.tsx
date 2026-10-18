"use client";
import { useId, useRef, useState } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./code-files.module.css";
import { CodeText } from "./code-text";

export function CodeFiles({ files }: { files: { name: string; content: string }[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);
  const id = useId();
  const file = files.find((entry) => entry.name === selected) ?? files[0];
  if (!file) return null;
  const index = files.indexOf(file);
  return (
    <section className={styles.panel} aria-label="Предпросмотр файлов результата">
      <div className={styles.toolbar}>
        <div ref={tabs} role="tablist" aria-label="Файлы результата" className={styles.tabs}>
          {files.map((entry, i) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-controls={`${id}-panel`}
              aria-selected={entry === file}
              tabIndex={entry === file ? 0 : -1}
              onClick={() => {
                setSelected(entry.name);
                setCopied(false);
                setFailed(false);
              }}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? files.length - 1
                      : (i + (event.key === "ArrowRight" ? 1 : -1) + files.length) % files.length;
                setSelected(files[next]!.name);
                setCopied(false);
                setFailed(false);
                tabs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
              }}
            >
              <WorkspaceIcon name="files" />
              {entry.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Копировать содержимое файла"
          onClick={() => {
            if (!navigator.clipboard) {
              setFailed(true);
              return;
            }
            void navigator.clipboard.writeText(file.content).then(
              () => {
                setCopied(true);
                setFailed(false);
              },
              () => setFailed(true)
            );
          }}
        >
          <WorkspaceIcon name={copied ? "check" : "copy"} />
          <span>{copied ? "Скопировано" : "Копировать"}</span>
        </button>
      </div>
      {failed && <p role="alert">Не удалось скопировать. Выделите текст вручную.</p>}
      <pre
        className={styles.code}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${index}`}
        tabIndex={0}
      >
        <code>
          <CodeText text={file.content} language={file.name.split(".").at(-1) ?? "txt"} />
        </code>
      </pre>
    </section>
  );
}
