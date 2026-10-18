"use client";
import type { RefObject } from "react";
import { CANVAS_MAX_CONTENT_BYTES, canvasBytes } from "@cosmora/contracts/canvas-artifacts";
import { editMarkdown, type MarkdownAction } from "./markdown-edit";
import styles from "./markdown-toolbar.module.css";
export function MarkdownToolbar({
  editor,
  value,
  disabled,
  onChange,
  onError
}: {
  editor: RefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
  onError: (text: string) => void;
}) {
  const apply = (action: MarkdownAction) => {
    const area = editor.current;
    if (!area || disabled) return;
    const next = editMarkdown(value, area.selectionStart, area.selectionEnd, action);
    if (canvasBytes(next.text) > CANVAS_MAX_CONTENT_BYTES) {
      onError("Достигнут лимит 512 КиБ для текста.");
      return;
    }
    onChange(next.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next.start, next.end);
    });
  };
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Форматирование Markdown">
      {(
        [
          ["bold", "Жирный", <b key="b">B</b>],
          ["italic", "Курсив", <i key="i">I</i>],
          ["heading", "Заголовок", "H2"],
          ["quote", "Цитата", "❞"],
          ["list", "Список", "☷"],
          ["code", "Фрагмент кода", "‹/›"]
        ] as const
      ).map(([action, label, icon]) => (
        <button
          key={action}
          type="button"
          disabled={disabled}
          aria-label={label}
          title={label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply(action)}
        >
          {icon}
        </button>
      ))}
      <span>Markdown</span>
    </div>
  );
}
