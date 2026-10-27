"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CANVAS_MAX_CONTENT_BYTES, canvasBytes } from "@cosmora/contracts/canvas-artifacts";
import { MAX_SEARCH_MATCHES, searchText, replaceMatches, type TextMatch } from "./text-search";
import styles from "./canvas-search.module.css";

function reveal(area: HTMLTextAreaElement, match: TextMatch) {
  area.focus();
  area.setSelectionRange(match.start, match.end);
  const css = getComputedStyle(area);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    boxSizing: "border-box",
    width: `${area.clientWidth}px`,
    font: css.font,
    lineHeight: css.lineHeight,
    letterSpacing: css.letterSpacing,
    padding: css.padding,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word"
  });
  mirror.textContent = area.value.slice(0, match.start);
  const caret = document.createElement("span");
  caret.textContent = "\u200b";
  mirror.append(caret);
  document.body.append(mirror);
  area.scrollTop = Math.max(0, caret.offsetTop - area.clientHeight / 2);
  mirror.remove();
}
export function CanvasSearch({
  editor,
  value,
  disabled,
  onChange,
  onError
}: {
  editor: RefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  onChange: (content: string) => void;
  onError: (message: string) => void;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [exact, setExact] = useState(false);
  const [active, setActive] = useState(0);
  const [last, setLast] = useState<{ before: string; after: string; count: number } | null>(null);
  const [notice, setNotice] = useState("");
  const deferred = useDeferredValue(query);
  const result = useMemo(() => searchText(value, deferred, exact), [value, deferred, exact]);
  const current = Math.min(active, Math.max(0, result.matches.length - 1));
  const pending = deferred !== query;
  const changing = useRef(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !["f", "h"].includes(event.key.toLowerCase()))
        return;
      if (
        event.target !== editor.current &&
        !(event.target instanceof Node && panel.current?.contains(event.target))
      )
        return;
      event.preventDefault();
      if (panel.current) panel.current.open = true;
      search.current?.focus();
      search.current?.select();
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [editor]);
  useEffect(() => {
    changing.current = false;
  }, [value]);
  const navigate = (index: number) => {
    if (!result.matches.length || pending || disabled) return;
    const next = (index + result.matches.length) % result.matches.length;
    setActive(next);
    if (editor.current) reveal(editor.current, result.matches[next]!);
  };
  const replace = (all: boolean) => {
    if (disabled || pending || !result.matches.length || (all && result.capped) || changing.current)
      return;
    const matches = all ? result.matches : [result.matches[current]!];
    const after = replaceMatches(value, matches, replacement);
    if (after.includes("\0") || canvasBytes(after) > CANVAS_MAX_CONTENT_BYTES) {
      onError("Замена не применена: текст содержит нулевой символ или превышает 512 КиБ.");
      return;
    }
    if (after === value) {
      setNotice("Текст не изменился.");
      return;
    }
    changing.current = true;
    setLast({ before: value, after, count: matches.length });
    setNotice(`Заменено: ${matches.length}. Изменения пока в черновике.`);
    setActive(0);
    onChange(after);
  };
  return (
    <details
      ref={panel}
      className={styles.search}
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          panel.current.open = false;
          editor.current?.focus();
        }
      }}
    >
      <summary>Поиск и замена</summary>
      <div className={styles.fields}>
        <label>
          Найти
          <input
            ref={search}
            value={query}
            maxLength={2000}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setNotice("");
            }}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                navigate(current + (event.shiftKey ? -1 : 1));
              }
            }}
          />
        </label>
        <label>
          Заменить на
          <input
            value={replacement}
            maxLength={100_000}
            onChange={(event) => setReplacement(event.target.value)}
            disabled={disabled}
          />
        </label>
      </div>
      <div className={styles.controls}>
        <label className={styles.case}>
          <input
            type="checkbox"
            checked={exact}
            onChange={(event) => {
              setExact(event.target.checked);
              setActive(0);
            }}
            disabled={disabled}
          />
          Учитывать регистр
        </label>
        <span role="status">
          {pending
            ? "Поиск…"
            : result.capped
              ? `Более ${MAX_SEARCH_MATCHES.toLocaleString("ru-RU")} совпадений — уточните поиск`
              : query
                ? `Совпадений: ${result.matches.length}${result.matches.length ? ` · ${current + 1}` : ""}`
                : "Введите текст для поиска"}
        </span>
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          disabled={disabled || pending || !result.matches.length}
          onClick={() => navigate(current - 1)}
          aria-label="Предыдущее совпадение"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={disabled || pending || !result.matches.length}
          onClick={() => navigate(current + 1)}
          aria-label="Следующее совпадение"
        >
          ↓
        </button>
        <button
          type="button"
          disabled={disabled || pending || !result.matches.length}
          onClick={() => replace(false)}
        >
          Заменить совпадение
        </button>
        <button
          type="button"
          disabled={disabled || pending || !result.matches.length || result.capped}
          onClick={() => replace(true)}
        >
          Заменить все
        </button>
        <button
          type="button"
          disabled={disabled || !last || value !== last.after}
          onClick={() => {
            if (last && value === last.after) {
              onChange(last.before);
              setNotice(`Отменена замена ${last.count} совпадений.`);
            }
          }}
        >
          Отменить замену
        </button>
        <button
          type="button"
          disabled={disabled || !last || value !== last.before}
          onClick={() => {
            if (last && value === last.before) {
              onChange(last.after);
              setNotice(`Повторена замена ${last.count} совпадений.`);
            }
          }}
        >
          Повторить замену
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
