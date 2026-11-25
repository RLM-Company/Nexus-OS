"use client";
import type { ChatTextAction } from "@cosmora/contracts";
import { useState, type RefObject } from "react";

export type KosmoraComposerActionsValue = {
  web_search: boolean;
  text_action: ChatTextAction | null;
};

export const MAX_REWRITE_SELECTION = 8000;

const TEXT_ACTIONS: { kind: ChatTextAction["kind"]; label: string }[] = [
  { kind: "explain", label: "Объяснить тему" },
  { kind: "hint", label: "Дать подсказку" },
  { kind: "walkthrough", label: "Разобрать решение" },
  { kind: "check", label: "Проверить ответ" },
  { kind: "rewrite", label: "Переписать текст" }
];

/**
 * Functional controls in the existing composer row. Uses a plain button + a
 * conditionally rendered menu: a native <details>/<summary> expands to the full
 * row width and intercepts pointer events on the neighbouring send/stop buttons.
 */
export function KosmoraComposerActions({
  disabled,
  value,
  onChange,
  composerRef
}: {
  disabled: boolean;
  value: KosmoraComposerActionsValue;
  onChange: (next: KosmoraComposerActionsValue) => void;
  /** Read the live selection only when an action is chosen, not on every cursor move. */
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const active = value.text_action?.kind;
  return (
    <div
      className="kosmora-composer-actions"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <label className="kosmora-action-toggle">
        <input
          type="checkbox"
          checked={value.web_search}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, web_search: event.target.checked })}
        />
        Искать в интернете
      </label>
      <button
        type="button"
        className="kosmora-actions-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {active ? TEXT_ACTIONS.find((a) => a.kind === active)?.label : "Действие с текстом"}
      </button>
      {selectionError && <span role="alert">{selectionError}</span>}
      {value.text_action?.kind === "rewrite" && (
        <div aria-label="Параметры новой версии" role="group">
          <label>
            Тон
            <select
              aria-label="Тон"
              value={value.text_action.tone ?? "нейтральный"}
              disabled={disabled}
              onChange={(event) => {
                if (value.text_action?.kind === "rewrite")
                  onChange({
                    ...value,
                    text_action: { ...value.text_action, tone: event.target.value }
                  });
              }}
            >
              <option value="нейтральный">Нейтральный</option>
              <option value="деловой">Деловой</option>
              <option value="дружелюбный">Дружелюбный</option>
            </select>
          </label>
          <label>
            Объём
            <select
              aria-label="Объём"
              value={value.text_action.length ?? "same"}
              disabled={disabled}
              onChange={(event) => {
                const length = event.target.value;
                if (
                  value.text_action?.kind === "rewrite" &&
                  (length === "shorter" || length === "same" || length === "longer")
                )
                  onChange({ ...value, text_action: { ...value.text_action, length } });
              }}
            >
              <option value="same">Тот же</option>
              <option value="shorter">Короче</option>
              <option value="longer">Подробнее</option>
            </select>
          </label>
        </div>
      )}
      {open && (
        <ul className="kosmora-actions-menu" role="menu">
          {TEXT_ACTIONS.map((action) => (
            <li key={action.kind}>
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                aria-pressed={active === action.kind}
                onClick={() => {
                  const area = composerRef.current;
                  const selection = area
                    ? area.value.slice(area.selectionStart, area.selectionEnd)
                    : "";
                  setSelectionError("");
                  if (action.kind === "rewrite" && active !== "rewrite") {
                    if (!selection.trim() || selection.length > MAX_REWRITE_SELECTION) {
                      setSelectionError(
                        selection.trim()
                          ? "Сократите выделение до 8 000 символов."
                          : "Выделите фрагмент текста в поле ввода."
                      );
                      setOpen(false);
                      area?.focus();
                      return;
                    }
                  }
                  const next: KosmoraComposerActionsValue = {
                    ...value,
                    text_action:
                      active === action.kind
                        ? null
                        : {
                            kind: action.kind,
                            ...(selection.trim()
                              ? {
                                  selection:
                                    action.kind === "rewrite"
                                      ? selection
                                      : selection.trim().slice(0, 50_000)
                                }
                              : {}),
                            ...(action.kind === "rewrite"
                              ? { tone: "нейтральный", length: "same" }
                              : {})
                          }
                  };
                  onChange(next);
                  setOpen(false);
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
