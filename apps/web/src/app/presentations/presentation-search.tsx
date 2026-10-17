"use client";
import { useMemo, useState } from "react";
import type { Deck } from "./model";
import { contentKey } from "./editor-history";
import { findText, replaceText, SEARCH_LIMIT, type TextField } from "./text-search";
import styles from "./presentations.module.css";
const names: Record<TextField, string> = {
  title: "Заголовок",
  body: "Основной текст",
  aside: "Вторая колонка",
  notes: "Заметки"
};
export function PresentationSearch({
  deck,
  selected,
  busy,
  onSelect,
  onReplace
}: {
  deck: Deck;
  selected: number;
  busy: boolean;
  onSelect: (slide: number, field: TextField, start: number, end: number) => void;
  onReplace: (deck: Deck) => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [currentOnly, setCurrentOnly] = useState(false);
  const [reviewed, setReviewed] = useState("");
  const [error, setError] = useState("");
  const options = useMemo(
    () => ({ query, caseSensitive, includeNotes, slide: currentOnly ? selected : null }),
    [query, caseSensitive, includeNotes, currentOnly, selected]
  );
  const found = useMemo(() => findText(deck, options), [deck, options]);
  const reviewKey = JSON.stringify([deck.id, contentKey(deck), options, replacement]);
  const preview = useMemo(() => {
    try {
      return { deck: replaceText(deck, options, replacement), error: "" };
    } catch (cause) {
      return { deck: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [deck, options, replacement]);
  const apply = (only?: number) => {
    if (busy || reviewed !== reviewKey) return;
    try {
      onReplace(replaceText(deck, options, replacement, only));
      setReviewed("");
      setError("");
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <details data-native-undo>
      <summary>Поиск и замена</summary>
      <fieldset disabled={busy} className={styles.editorFields}>
        <div className={styles.fields}>
          <label>
            Найти в слайдах
            <textarea
              rows={2}
              value={query}
              maxLength={SEARCH_LIMIT}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            Заменить на
            <textarea
              rows={2}
              value={replacement}
              maxLength={SEARCH_LIMIT}
              onChange={(event) => setReplacement(event.target.value)}
            />
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />{" "}
          Учитывать регистр
        </label>{" "}
        <label>
          <input
            type="checkbox"
            checked={includeNotes}
            onChange={(event) => setIncludeNotes(event.target.checked)}
          />{" "}
          Включить заметки докладчика
        </label>{" "}
        <label>
          <input
            type="checkbox"
            checked={currentOnly}
            onChange={(event) => setCurrentOnly(event.target.checked)}
          />{" "}
          Только выбранный слайд
        </label>
        <p role="status">
          {found.limited
            ? "Более 10 000 совпадений: уточните поиск."
            : `Совпадений: ${found.matches.length}`}
          . Поиск буквальный, включая скрытый текст второй колонки. Название презентации не
          меняется.
        </p>
        {(preview.error || error) && <p role="alert">{preview.error || error}</p>}
        <label>
          <input
            type="checkbox"
            checked={reviewed === reviewKey}
            onChange={(event) => setReviewed(event.target.checked ? reviewKey : "")}
            disabled={!found.matches.length || found.limited || !!preview.error}
          />{" "}
          Проверил замену «{query.slice(0, 80)}» на «{replacement.slice(0, 80)}»
          {(query.length > 80 || replacement.length > 80) && " (полный текст в полях выше)"}
        </label>
        <button
          type="button"
          onClick={() => apply()}
          disabled={
            reviewed !== reviewKey || !found.matches.length || found.limited || !!preview.error
          }
        >
          Заменить все ({found.matches.length})
        </button>
        <p>
          Замены меняют черновик. Их можно отменить одной правкой; для записи на сервер нажмите
          «Сохранить».
        </p>
        <ol>
          {found.matches.slice(0, 100).map((match, index) => {
            const value = deck.slides[match.slide]![match.field];
            return (
              <li key={`${match.slide}:${match.field}:${match.start}`}>
                <button
                  type="button"
                  onClick={() => onSelect(match.slide, match.field, match.start, match.end)}
                >
                  Слайд {match.slide + 1} · {names[match.field]} · {index + 1}
                </button>{" "}
                <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {match.start > 35 ? "…" : ""}
                  {value.slice(Math.max(0, match.start - 35), match.start)}
                  <mark>
                    {value.slice(match.start, Math.min(match.end, match.start + 120))}
                    {match.end - match.start > 120 ? "…" : ""}
                  </mark>
                  {value.slice(match.end, match.end + 35)}
                  {value.length > match.end + 35 ? "…" : ""}
                </span>{" "}
                <button
                  type="button"
                  disabled={reviewed !== reviewKey || found.limited}
                  onClick={() => apply(index)}
                >
                  Заменить совпадение {index + 1}
                </button>
              </li>
            );
          })}
        </ol>
        {found.matches.length > 100 && (
          <p>Показаны первые 100 совпадений. Замена всех охватит {found.matches.length}.</p>
        )}
      </fieldset>
    </details>
  );
}
