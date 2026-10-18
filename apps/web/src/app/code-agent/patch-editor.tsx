"use client";
import { useRef, useState } from "react";
import { codePatchRequest, type CodePatchPreview } from "./patch-client";
import { InlineDiff } from "../ui/inline-diff";

/** Reusable Code adapter; parsing always happens on the server's immutable snapshot. */
export function CodePatchEditor(props: {
  project: string;
  id: string;
  baseSha: string;
  snapshotDigest: string;
  proposalHash: string;
  initialDiff: string;
  disabled: boolean;
  onDirty: () => Promise<void>;
  onApply: (preview: CodePatchPreview) => void;
}) {
  const [text, setText] = useState(props.initialDiff),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CodePatchPreview | null>(null);
  const version = useRef(0);
  async function verify() {
    const captured = version.current;
    setBusy(true);
    setError(null);
    try {
      await props.onDirty();
      const result = await codePatchRequest<CodePatchPreview>(
        props.project,
        `/${encodeURIComponent(props.id)}/preview-diff`,
        {
          proposal_hash: props.proposalHash,
          base_sha: props.baseSha,
          snapshot_digest: props.snapshotDigest,
          diff: text
        }
      );
      if (version.current !== captured) return;
      setText(result.normalizedDiff);
      setPreview(result);
      props.onApply(result);
    } catch (e) {
      if (version.current === captured)
        setError(e instanceof Error ? e.message : "Патч не подтверждён.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details aria-label="Редактор unified diff">
      <summary>Редактировать минимальный diff</summary>
      <p>
        Проверка применяется к точному commit и снимку. Исправляются только количества строк hunk.
        Изменение diff отменяет прошлую проверку и согласие.
      </p>
      <label>
        Unified diff
        <textarea
          aria-label="Редактируемый unified diff"
          rows={10}
          spellCheck={false}
          value={text}
          disabled={props.disabled || busy}
          onChange={(e) => {
            version.current++;
            setText(e.target.value);
            setPreview(null);
            setError(null);
            void props
              .onDirty()
              .catch((e) =>
                setError(e instanceof Error ? e.message : "Не удалось отменить старую проверку.")
              );
          }}
        />
      </label>
      <button disabled={props.disabled || busy || !text} onClick={() => void verify()}>
        {busy ? "Проверяем применимость…" : "Проверить diff и перенести в выбранные изменения"}
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <p role="status">
            Diff применим. Исправлено заголовков: {preview.normalizations.length}. Новых модельных
            запросов не было.
          </p>
          <p>
            Снимок проверки: <code>{preview.resultDigest}</code>
          </p>
          <InlineDiff text={preview.normalizedDiff} label="Проверенный diff" />
        </>
      )}
    </details>
  );
}
