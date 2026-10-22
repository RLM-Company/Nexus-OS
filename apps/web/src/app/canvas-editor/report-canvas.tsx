"use client";
import { useEffect, useRef, useState } from "react";
import {
  CANVAS_MAX_CONTENT_BYTES,
  CANVAS_MAX_TITLE_BYTES,
  canvasBytes,
  type CanvasFormat
} from "@cosmora/contracts/canvas-artifacts";
import { CanvasEditor, type CanvasSeed } from "./canvas-editor";
import styles from "./report-canvas.module.css";
type ReportCanvasProps = {
  projectId: string;
  title: string;
  format?: CanvasFormat;
  label?: string;
  disabled?: boolean;
} & (
  | { content: string; loadContent?: never }
  | { content?: never; loadContent: (signal: AbortSignal) => Promise<string> }
);
export function ReportCanvas({
  projectId,
  title,
  content,
  loadContent,
  format = "markdown",
  label = "Редактировать в Canvas",
  disabled = false
}: ReportCanvasProps) {
  const [seed, setSeed] = useState<CanvasSeed | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [visible, setVisible] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, []);
  useEffect(() => {
    if (visible && seed && !modal.current?.open) modal.current?.showModal();
  }, [visible, seed]);
  const open = async () => {
    if (opening || disabled || request.current) return;
    setError("");
    const controller = new AbortController();
    request.current = controller;
    setOpening(true);
    try {
      const text = loadContent ? await loadContent(controller.signal) : content;
      if (controller.signal.aborted || !alive.current) return;
      if (typeof text !== "string") throw new Error("Отчёт недоступен.");
      if (canvasBytes(text) > CANVAS_MAX_CONTENT_BYTES || text.includes("\0")) {
        throw new Error(
          "Документ не помещается в Canvas (512 КиБ). Сократите выборку или скачайте отчёт."
        );
      }
      const safeTitle = Array.from(
        // eslint-disable-next-line no-control-regex
        title.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "Анализ документов"
      ).reduce(
        (text, c) => (canvasBytes(text + c) <= CANVAS_MAX_TITLE_BYTES ? text + c : text),
        ""
      );
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(projectId + "\n" + format + "\n" + safeTitle + "\n" + text)
      );
      const storageId =
        "report-" +
        Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
      if (!alive.current || controller.signal.aborted) return;
      setSeed((current) =>
        current?.storageId === storageId
          ? current
          : { storageId, title: safeTitle, content: text, format }
      );
      setVisible(true);
    } catch (error) {
      if (alive.current && !controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Не удалось открыть Canvas. Исходный отчёт сохранён."
        );
    } finally {
      if (request.current === controller) request.current = null;
      if (alive.current) setOpening(false);
    }
  };
  return (
    <>
      <button ref={button} type="button" disabled={disabled || opening} onClick={() => void open()}>
        {opening ? "Открываю…" : label}
      </button>
      {error && <p role="alert">{error}</p>}
      <dialog
        ref={modal}
        className={styles.dialog}
        aria-labelledby={seed ? `report-${seed.storageId}` : undefined}
        onClose={() => {
          setVisible(false);
          button.current?.focus();
        }}
      >
        <header className={styles.header}>
          <div>
            <strong id={seed ? `report-${seed.storageId}` : undefined}>Документ в Canvas</strong>
            <p>Редактируемая копия с источниками. Исходные файлы и ответ сохраняются.</p>
          </div>
          <button
            type="button"
            aria-label="Закрыть документ Canvas"
            onClick={() => modal.current?.close()}
          >
            ×
          </button>
        </header>
        {seed && <CanvasEditor key={seed.storageId} projectId={projectId} initialDraft={seed} />}
      </dialog>
    </>
  );
}
