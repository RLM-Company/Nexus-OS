"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  formatEditorSelection,
  type EditorFormatCommand,
  type EditorSelection
} from "./editor-format";
import styles from "./editor-toolbar.module.css";

const tools: Array<{ command: EditorFormatCommand; label: string; glyph: string }> = [
  { command: "bold", label: "Жирный", glyph: "B" },
  { command: "italic", label: "Курсив", glyph: "I" },
  { command: "heading", label: "Заголовок", glyph: "H₂" },
  { command: "bullet", label: "Маркированный список", glyph: "•" },
  { command: "numbered", label: "Нумерованный список", glyph: "1." },
  { command: "quote", label: "Цитата", glyph: "“" },
  { command: "code", label: "Код", glyph: "</>" },
  { command: "link", label: "Ссылка", glyph: "↗" }
];

/** A one-tab-stop toolbar over a plain Markdown textarea; no HTML or rich-text state. */
export function EditorToolbar({
  textareaRef,
  value,
  markdown,
  disabled,
  maxBytes,
  onChange,
  onLimit
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  markdown: boolean;
  disabled: boolean;
  maxBytes: number;
  onChange: (value: string) => void;
  onLimit: () => void;
}) {
  const [focused, setFocused] = useState(0);
  const [undo, setUndo] = useState<{ before: EditorSelection; after: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const pendingFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    },
    []
  );
  const available = markdown && !disabled;
  const canUndo = available && undo?.after === value;
  const tabStop = focused === tools.length && !canUndo ? 0 : focused;
  const apply = (command: EditorFormatCommand | "undo") => {
    const textarea = textareaRef.current;
    if (!textarea || !available) return;
    const before = { content: value, start: textarea.selectionStart, end: textarea.selectionEnd };
    const result =
      command === "undo"
        ? canUndo && undo
          ? undo.before
          : null
        : formatEditorSelection(value, before.start, before.end, command, maxBytes);
    if (!result || new TextEncoder().encode(result.content).byteLength > maxBytes) {
      if (command !== "undo") onLimit();
      return;
    }
    const scrollTop = textarea.scrollTop;
    onChange(result.content);
    setUndo(command === "undo" ? null : { before, after: result.content });
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      // Do not focus a different document after navigation or a closed editor.
      if (
        !textarea.isConnected ||
        textareaRef.current !== textarea ||
        textarea.value !== result.content
      )
        return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(result.start, result.end);
      textarea.scrollTop = scrollTop;
    });
  };
  return (
    <div className={styles.shell}>
      <div
        className={styles.toolbar}
        ref={bar}
        role="toolbar"
        aria-label="Форматирование Markdown"
        aria-orientation="horizontal"
        onKeyDown={(event) => {
          if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
          const buttons = Array.from(
            bar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
          );
          if (!buttons.length) return;
          event.preventDefault();
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                  buttons.length;
          const next = buttons[index];
          next?.focus();
        }}
      >
        {tools.map((tool, index) => (
          <button
            key={tool.command}
            type="button"
            disabled={!available}
            aria-label={tool.label}
            title={tool.label}
            data-tool={tool.command}
            tabIndex={available && tabStop === index ? 0 : -1}
            onFocus={() => setFocused(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(tool.command)}
          >
            <span aria-hidden="true">{tool.glyph}</span>
          </button>
        ))}
        <span className={styles.separator} aria-hidden="true" />
        <button
          type="button"
          disabled={!canUndo}
          aria-label="Отменить форматирование"
          title="Отменить последнее форматирование"
          tabIndex={canUndo && focused === tools.length ? 0 : -1}
          onFocus={() => setFocused(tools.length)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply("undo")}
        >
          <span aria-hidden="true">↶</span>
        </button>
      </div>
      <span className={styles.hint}>{markdown ? "Markdown" : "Форматирование — в Markdown"}</span>
    </div>
  );
}
