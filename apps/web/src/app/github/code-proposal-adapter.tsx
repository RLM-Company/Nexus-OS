"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { codePatchRequest } from "../code-agent/patch-client";

/** Legacy /github enters the SAME Code validation/check/review flow; no direct publish route. */
export function LegacyCodeProposalAdapter(props: {
  project: string;
  branch: string;
  baseSha: string;
  disabled: boolean;
}) {
  const [diff, setDiff] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [run, setRun] = useState<{ id: string; project: string; identity: string } | null>(null),
    [draftIdentity, setDraftIdentity] = useState<string | null>(null),
    [auto, setAuto] = useState(false);
  const flight = useRef(false);
  const scope = useRef(0),
    identity = `${props.project}:${props.branch}:${props.baseSha}`;
  const stale = !!diff && draftIdentity !== null && draftIdentity !== identity;
  const current = useRef(identity);
  if (current.current !== identity) {
    current.current = identity;
    scope.current++;
  }
  async function submit() {
    if (flight.current || stale) return;
    flight.current = true;
    const at = scope.current,
      project = props.project;
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const result = await codePatchRequest<{ id: string }>(project, "/import-diff", {
        task: "Проверить импортированный текстовый патч",
        base_branch: props.branch,
        base_sha: props.baseSha,
        diff,
        ...(auto ? { auto_check: { check: "syntax", approve: true } } : {})
      });
      if (scope.current === at) setRun({ id: result.id, project, identity });
    } catch (e) {
      if (scope.current === at) setError(e instanceof Error ? e.message : "Импорт не подтверждён.");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <details aria-label="Импорт Code diff из GitHub workspace">
      <summary>Проверить текстовый Code-патч</summary>
      <p>
        Импорт без нового обращения к модели. Патч будет проверен на текущей базе; просмотр и
        подтверждение публикации проходят в Code.
      </p>
      <label>
        Unified diff
        <textarea
          rows={6}
          spellCheck={false}
          value={diff}
          disabled={props.disabled || busy}
          onChange={(e) => {
            if (!diff || !e.target.value) setDraftIdentity(identity);
            setDiff(e.target.value);
            setRun(null);
            setError(null);
          }}
        />
      </label>
      {stale && (
        <p role="alert">
          База или проект изменились. Diff сохранён, импорт заблокирован до подтверждения нового
          снимка.{" "}
          <button
            disabled={busy || props.disabled}
            onClick={() => {
              setDraftIdentity(identity);
              setRun(null);
            }}
          >
            Подтвердить новую базу для этого diff
          </button>
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={auto}
          disabled={props.disabled || busy}
          onChange={(e) => setAuto(e.target.checked)}
        />{" "}
        Разрешаю автоматически проверить синтаксис этого снимка в изолированном исполнителе
      </label>
      <button
        disabled={props.disabled || busy || !props.project || !props.baseSha || !diff || stale}
        onClick={() => void submit()}
      >
        Импортировать и проверить применимость
      </button>
      {error && <p role="alert">{error}</p>}
      {run && run.identity === identity && (
        <p>
          <Link
            href={`/code-agent?project=${encodeURIComponent(run.project)}&run=${encodeURIComponent(run.id)}`}
          >
            Открыть точный diff, проверку и review в Code
          </Link>
        </p>
      )}
    </details>
  );
}
