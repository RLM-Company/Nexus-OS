"use client";
import { useState } from "react";
import { draftKey, type Draft } from "./skill-model";
import {
  findSkillText,
  replaceSkillText,
  SKILL_FIELDS,
  SKILL_SEARCH_LIMIT,
  type SkillMatch,
  type SkillSearchOptions
} from "./skill-search";
import styles from "./skills.module.css";
export function SkillSearchPanel({
  draft,
  epoch,
  busy,
  onSelect,
  onApply
}: {
  draft: Draft;
  epoch: number;
  busy: boolean;
  onSelect: (match: SkillMatch) => void;
  onApply: (before: string, after: Draft, epoch: number) => void;
}) {
  const [options, setOptions] = useState<SkillSearchOptions>({
    query: "",
    caseSensitive: false,
    field: "instructions"
  });
  const [replacement, setReplacement] = useState("");
  const [selected, setSelected] = useState(0);
  const [prepared, setPrepared] = useState<{ key: string; draft: Draft; count: number } | null>(
    null
  );
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const found = findSkillText(draft, options);
  const index = Math.max(0, Math.min(selected, found.matches.length - 1));
  const key = JSON.stringify([epoch, draftKey(draft), options, replacement, index]);
  const preview = prepared?.key === key ? prepared : null;
  const change = (value: SkillSearchOptions) => {
    setOptions(value);
    setSelected(0);
    setPrepared(null);
    setReviewed(false);
    setError("");
  };
  const navigate = (next: number) => {
    if (!found.matches.length) return;
    const target = (next + found.matches.length) % found.matches.length;
    setSelected(target);
    setPrepared(null);
    setReviewed(false);
    onSelect(found.matches[target]!);
  };
  const prepare = (all: boolean) => {
    try {
      const after = replaceSkillText(draft, options, replacement, all ? undefined : index);
      setPrepared({ key, draft: after, count: all ? found.matches.length : 1 });
      setReviewed(false);
      setError("");
    } catch (cause) {
      setPrepared(null);
      setReviewed(false);
      setError(String(cause));
    }
  };
  return (
    <details className={styles.review}>
      <summary>Поиск и замена в Skill</summary>
      <section aria-label="Поиск и замена в Skill">
        <label>
          Найти в Skill
          <input
            disabled={busy}
            maxLength={SKILL_SEARCH_LIMIT}
            value={options.query}
            onChange={(event) => change({ ...options, query: event.target.value })}
          />
        </label>
        <label>
          Область поиска
          <select
            disabled={busy}
            value={options.field}
            onChange={(event) =>
              change({ ...options, field: event.target.value as SkillSearchOptions["field"] })
            }
          >
            <option value="all">Все поля</option>
            {SKILL_FIELDS.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.check}>
          <input
            disabled={busy}
            type="checkbox"
            checked={options.caseSensitive}
            onChange={(event) => change({ ...options, caseSensitive: event.target.checked })}
          />
          Учитывать регистр
        </label>
        <p aria-live="polite">
          {found.matches.length
            ? `${index + 1} из ${found.matches.length}${found.limited ? "+" : ""}`
            : "Совпадений нет"}
        </p>
        {found.limited && <p>Показаны первые 5000 совпадений. Для замены уточните поиск.</p>}
        <div className={styles.actions}>
          <button
            type="button"
            disabled={busy || !found.matches.length}
            onClick={() => navigate(index - 1)}
          >
            Предыдущее совпадение
          </button>
          <button
            type="button"
            disabled={busy || !found.matches.length}
            onClick={() => navigate(index + 1)}
          >
            Следующее совпадение
          </button>
          <button
            type="button"
            disabled={busy || !found.matches.length}
            onClick={() => navigate(index)}
          >
            Выделить совпадение
          </button>
        </div>
        <label>
          Заменить на
          <input
            disabled={busy}
            maxLength={SKILL_SEARCH_LIMIT}
            value={replacement}
            onChange={(event) => {
              setReplacement(event.target.value);
              setPrepared(null);
              setReviewed(false);
              setError("");
            }}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={busy || !found.matches.length || found.limited}
            onClick={() => prepare(false)}
          >
            Просмотреть замену одного
          </button>
          <button
            type="button"
            disabled={busy || !found.matches.length || found.limited}
            onClick={() => prepare(true)}
          >
            Просмотреть замену всех
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <section className={styles.comparison} aria-label="Предпросмотр замены Skill">
            <h3>Совпадений для замены: {preview.count}</h3>
            {SKILL_FIELDS.filter(({ key }) => draft[key] !== preview.draft[key]).map(
              ({ key, label }) => (
                <section key={key}>
                  <h4>{label}</h4>
                  <div>
                    <div>
                      <strong>Сейчас</strong>
                      <pre>{draft[key]}</pre>
                    </div>
                    <div>
                      <strong>После замены</strong>
                      <pre>{preview.draft[key]}</pre>
                    </div>
                  </div>
                </section>
              )
            )}
            <label className={styles.check}>
              <input
                disabled={busy}
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              Проверил замену Skill
            </label>
            <button
              type="button"
              disabled={busy || !reviewed || draftKey(draft) === draftKey(preview.draft)}
              onClick={() => {
                onApply(draftKey(draft), preview.draft, epoch);
                setPrepared(null);
                setReviewed(false);
              }}
            >
              Применить замену к черновику
            </button>
            <p>Меняется только черновик. Всю замену можно отменить одним действием.</p>
          </section>
        )}
      </section>
    </details>
  );
}
