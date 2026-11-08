"use client";
import type { ChatTextAction } from "@cosmora/contracts";
import { useState } from "react";

export type KosmoraComposerActionsValue = {
  web_search: boolean;
  text_action: ChatTextAction | null;
};

const TEXT_ACTIONS: { kind: ChatTextAction["kind"]; label: string }[] = [
  { kind: "explain", label: "Объяснить тему" },
  { kind: "hint", label: "Дать подсказку" },
  { kind: "walkthrough", label: "Разобрать решение" },
  { kind: "check", label: "Проверить ответ" },
  { kind: "rewrite", label: "Переписать текст" }
];

/** Functional controls in the existing composer row. No layout/styling redesign. */
export function KosmoraComposerActions({
  disabled,
  value,
  onChange,
  selection
}: {
  disabled: boolean;
  value: KosmoraComposerActionsValue;
  onChange: (next: KosmoraComposerActionsValue) => void;
  selection: string;
}) {
  const [open, setOpen] = useState(false);
  const active = value.text_action?.kind;
  return (
    <div className="kosmora-composer-actions">
      <label className="kosmora-action-toggle">
        <input
          type="checkbox"
          checked={value.web_search}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, web_search: event.target.checked })}
        />
        Искать в интернете
      </label>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary aria-label="Действия с текстом">
          {active ? TEXT_ACTIONS.find((a) => a.kind === active)?.label : "Действие с текстом"}
        </summary>
        <ul>
          {TEXT_ACTIONS.map((action) => (
            <li key={action.kind}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={active === action.kind}
                onClick={() => {
                  const next: KosmoraComposerActionsValue = {
                    ...value,
                    text_action:
                      active === action.kind
                        ? null
                        : {
                            kind: action.kind,
                            ...(selection.trim()
                              ? { selection: selection.trim().slice(0, 50_000) }
                              : {}),
                            ...(action.kind === "rewrite" ? { tone: "нейтральный" } : {})
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
      </details>
    </div>
  );
}
