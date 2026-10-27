"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatTextAttachment } from "@cosmora/contracts/chat-attachments";
import type {
  ArtifactContextCandidate,
  ArtifactContextPreview,
  ArtifactContextSelection
} from "@cosmora/contracts/artifact-context";
import styles from "./project-context.module.css";

const errors: Record<string, string> = {
  ARTIFACT_CONTEXT_LIMIT:
    "Выбранный текст превышает лимит материала. Выберите меньший диапазон строк или столбцов.",
  ARTIFACT_CONTEXT_VERSION_CONFLICT:
    "Версия источника изменилась. Обновите список и проверьте источник заново.",
  ARTIFACT_CONTEXT_NOT_FOUND: "Источник или выбранная версия больше недоступны.",
  ARTIFACT_CONTEXT_CORRUPT: "Контрольная сумма источника не совпала. Снимок не подготовлен.",
  ARTIFACT_CONTEXT_EMPTY: "Источник пуст. Выберите другой материал.",
  ARTIFACT_CONTEXT_INVALID_SELECTION: "Проверьте границы диапазона и номера столбцов.",
  ARTIFACT_CONTEXT_INVALID_TEXT: "В источнике есть недопустимые для контекста управляющие символы."
};
const kinds = { canvas: "Canvas", table: "Таблица", work: "Work" };

export function ProjectArtifactPicker({
  projectId,
  disabled,
  onAdd
}: {
  projectId: string;
  disabled: boolean;
  onAdd: (attachment: ChatTextAttachment) => boolean;
}) {
  const [items, setItems] = useState<ArtifactContextCandidate[]>([]);
  const [choice, setChoice] = useState("");
  const [mode, setMode] = useState<"full" | "range">("full");
  const [from, setFrom] = useState("1"),
    [to, setTo] = useState("20");
  const [columns, setColumns] = useState("1,2");
  const [preview, setPreview] = useState<ArtifactContextPreview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const action = useRef(false);
  const epoch = useRef(0);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/materials/artifacts`;
  const selected = items.find((item) => `${item.kind}:${item.id}` === choice);
  async function request<T>(url: string, body?: unknown) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) throw new DOMException("Project changed", "AbortError");
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          })
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      const code = value?.error?.code ?? "";
      throw new Error(errors[code] ?? "Не удалось прочитать источники проекта.");
    }
    const value = (await response.json()) as T;
    signal.throwIfAborted();
    return value;
  }
  const refresh = async () => {
    if (action.current) return;
    action.current = true;
    const sequence = ++epoch.current,
      scope = controller.current;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const listing = await request<{ items: ArtifactContextCandidate[] }>(base);
      if (scope !== controller.current || scope?.signal.aborted || sequence !== epoch.current)
        return;
      setItems(listing.items);
    } catch (e) {
      if (scope === controller.current && !scope?.signal.aborted && sequence === epoch.current)
        setError(e instanceof Error ? e.message : "Ошибка источников");
    } finally {
      if (sequence === epoch.current && scope === controller.current && !scope?.signal.aborted) {
        action.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    const scope = new AbortController();
    controller.current = scope;
    action.current = false;
    setItems([]);
    setChoice("");
    setPreview(null);
    void refresh();
    return () => {
      scope.abort();
      epoch.current++;
      action.current = false;
    };
  }, [projectId]);
  const read = async () => {
    if (action.current || !selected) return;
    let selection: ArtifactContextSelection = { kind: "full" };
    if (mode === "range") {
      const start = Number(from),
        end = Number(to);
      const projected = columns.split(",").map((text) => Number(text.trim()));
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 1 ||
        end < start ||
        (selected.kind === "table" &&
          (new Set(projected).size !== projected.length ||
            projected.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100)))
      ) {
        setError("Введите целые номера диапазона и уникальные номера столбцов через запятую.");
        return;
      }
      selection =
        selected.kind === "table"
          ? { kind: "rows", from: start, to: end, columns: projected }
          : { kind: "lines", from: start, to: end };
    }
    action.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    const sequence = ++epoch.current,
      scope = controller.current;
    try {
      const { kind, id, version, sha256 } = selected;
      const result = await request<ArtifactContextPreview>(base + "/preview", {
        source: { kind, id, version, sha256 },
        selection
      });
      if (sequence === epoch.current && scope === controller.current && !scope?.signal.aborted)
        setPreview(result);
    } catch (e) {
      if (sequence === epoch.current && scope === controller.current && !scope?.signal.aborted)
        setError(e instanceof Error ? e.message : "Ошибка предпросмотра");
    } finally {
      if (sequence === epoch.current && scope === controller.current && !scope?.signal.aborted) {
        action.current = false;
        setBusy(false);
      }
    }
  };
  const changed = () => {
    setPreview(null);
    setError("");
  };
  return (
    <section className={styles.artifactPicker} aria-label="Сохранённые источники проекта">
      <h3>Из Canvas, таблиц и Work</h3>
      <p>
        Выберите полный текст или явный фрагмент. Снимок сначала добавится в форму; сохраните
        материалы отдельной кнопкой.
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        Источник
        <select
          aria-label="Сохранённый источник"
          value={choice}
          disabled={disabled || busy}
          onChange={(e) => {
            setChoice(e.target.value);
            changed();
          }}
        >
          <option value="">Выберите источник</option>
          {items.map((item) => (
            <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
              {kinds[item.kind]} · {item.title} · v{item.version}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={disabled || busy} onClick={() => void refresh()}>
        Обновить источники
      </button>
      {selected && (
        <>
          <p>
            {selected.bytes.toLocaleString("ru-RU")} байт · SHA-256:{" "}
            <code className={styles.sourceHash}>{selected.sha256}</code>
          </p>
          <label>
            Объём
            <select
              aria-label="Объём источника"
              value={mode}
              disabled={disabled || busy}
              onChange={(e) => {
                setMode(e.target.value as "full" | "range");
                changed();
              }}
            >
              <option value="full">Полный источник</option>
              <option value="range">
                Диапазон {selected.kind === "table" ? "строк таблицы" : "строк текста"}
              </option>
            </select>
          </label>
          {mode === "range" && (
            <div className={styles.artifactRange}>
              <label>
                От строки
                <input
                  aria-label="От строки источника"
                  type="number"
                  min="1"
                  value={from}
                  disabled={disabled || busy}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    changed();
                  }}
                />
              </label>
              <label>
                До строки
                <input
                  aria-label="До строки источника"
                  type="number"
                  min="1"
                  value={to}
                  disabled={disabled || busy}
                  onChange={(e) => {
                    setTo(e.target.value);
                    changed();
                  }}
                />
              </label>
              {selected.kind === "table" && (
                <label>
                  Столбцы, начиная с 1
                  <input
                    aria-label="Столбцы источника"
                    value={columns}
                    disabled={disabled || busy}
                    onChange={(e) => {
                      setColumns(e.target.value);
                      changed();
                    }}
                  />
                </label>
              )}
            </div>
          )}
          <button type="button" disabled={disabled || busy} onClick={() => void read()}>
            Подготовить снимок
          </button>
        </>
      )}
      {!busy && !items.length && (
        <p>Сохранённых документов, таблиц и завершённых файлов Work пока нет.</p>
      )}
      {busy && <p role="status">Читаем источник…</p>}
      {preview && (
        <div className={styles.artifactPreview}>
          <strong>
            {preview.complete ? "Полный снимок" : "Частичный снимок"} · {preview.selected_units} из{" "}
            {preview.total_units} строк
          </strong>
          <p>
            Версия {preview.source.version}. Показанный текст не будет обновляться вслед за
            источником.
          </p>
          <pre aria-label="Текст снимка материала">{preview.attachment.content}</pre>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              if (onAdd(preview.attachment)) setPreview(null);
            }}
          >
            Добавить снимок в материалы
          </button>
        </div>
      )}
    </section>
  );
}
