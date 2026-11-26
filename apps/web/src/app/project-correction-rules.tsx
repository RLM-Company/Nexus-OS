"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkCorrectionRule } from "@cosmora/contracts";

type Proposal = { correction: string; instructions: string };

export function ProjectCorrectionRules({ projectId }: { projectId: string }) {
  const path = "/api/v1/projects/" + encodeURIComponent(projectId) + "/correction-rules";
  const [correction, setCorrection] = useState("");
  const [draft, setDraft] = useState<Proposal | null>(null);
  const [rules, setRules] = useState<WorkCorrectionRule[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ correction: string; id: string } | null>(null);
  const lock = useRef(false);
  const sequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const before = sequence.current;
    void fetch(path, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
    })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const value = (await response.json()) as { rules: WorkCorrectionRule[] };
        if (!controller.signal.aborted && before === sequence.current) setRules(value.rules);
      })
      .catch(() => {
        if (!controller.signal.aborted && before === sequence.current)
          setError("Не удалось загрузить правила проекта.");
      });
    return () => controller.abort();
  }, [path]);

  const apply = async (action: string, body: object) => {
    if (lock.current) return;
    lock.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      if (response.status === 409) {
        const updated = await fetch(path, {
          cache: "no-store",
          signal: AbortSignal.timeout(10000)
        });
        if (updated.ok) setRules(((await updated.json()) as { rules: WorkCorrectionRule[] }).rules);
        throw Error("Правило изменилось. Проверьте текущую версию.");
      }
      if (!response.ok) throw Error("Не удалось сохранить действие с правилом.");
      const value = (await response.json()) as {
        rule?: WorkCorrectionRule;
        draft?: { instructions: string };
      };
      if (action === "/propose" && value.draft) {
        setDraft({ correction, instructions: value.draft.instructions });
      } else if (value.rule) {
        const saved = value.rule;
        setRules((current) =>
          current.some((rule) => rule.id === saved.id) ? current : [...current, saved]
        );
        if (action === "/accept") {
          setCorrection("");
          setDraft(null);
          pending.current = null;
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const latest = new Map<string, WorkCorrectionRule>();
  for (const rule of rules)
    if ((latest.get(rule.name)?.version ?? 0) < rule.version) latest.set(rule.name, rule);

  return (
    <details>
      <summary>Правила следующих сравнений</summary>
      <p>
        Поддерживается отдельная строка доставки. Пожелания вне этого сценария сохраняются без
        автоматического применения.
      </p>
      <label className="proposal-history">
        Исправление для следующей задачи
        <textarea
          value={correction}
          maxLength={2000}
          disabled={busy}
          placeholder="Всегда показывай доставку отдельной строкой"
          onChange={(event) => {
            setCorrection(event.target.value);
            setDraft(null);
          }}
        />
      </label>
      <button
        type="button"
        disabled={busy || correction.trim().length < 2}
        onClick={() => void apply("/propose", { correction })}
      >
        Предложить правило
      </button>
      {draft && (
        <>
          <blockquote>{draft.instructions}</blockquote>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (pending.current?.correction !== draft.correction)
                pending.current = { correction: draft.correction, id: crypto.randomUUID() };
              void apply("/accept", {
                correction: draft.correction,
                client_request_id: pending.current.id
              });
            }}
          >
            Подтвердить правило
          </button>
        </>
      )}
      <ul>
        {[...latest.values()].map((rule) => (
          <li key={rule.id}>
            {rule.name} · версия {rule.version} · {rule.enabled ? "включено" : "отключено"}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void apply(
                  "/" + encodeURIComponent(rule.id) + (rule.enabled ? "/disable" : "/enable"),
                  { expected_version: rule.version }
                )
              }
            >
              {rule.enabled ? "Отключить правило" : "Включить правило"}
            </button>
            {rule.version > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void apply("/" + encodeURIComponent(rule.id) + "/rollback", {
                    expected_version: rule.version
                  })
                }
              >
                Восстановить прошлую версию
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
