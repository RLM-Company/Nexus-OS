"use client";
import { useEffect, useRef, useState } from "react";
import type { OfficeOperation, OfficeCursor } from "@cosmora/contracts";
import { OfficeRangeEditor } from "./office-range-editor";
import { officeCellValue, type RangeType } from "./office-range";
import { OfficePlanEditor } from "./office-plan-editor";
import {
  removeOfficeOperation,
  officeTargetAfterRemoval,
  replaceOfficeOperation,
  validateEditableOfficePlan
} from "./office-plan";
type View = {
  version: string;
  cursor?: OfficeCursor;
  next_cursor?: OfficeCursor | null;
  total_targets?: number;
  targets_excerpt_only?: boolean;
  targets: Array<{
    id: string;
    text?: string;
    name?: string;
    cells?: Array<{
      address: string;
      type: string;
      text: string;
      formula: string | null;
      cached_value: string | null;
    }>;
    cells_excerpt_only?: boolean;
    total_cells?: number;
    cells_offset?: number;
    text_offset?: number;
    total_text_utf16?: number;
    text_excerpt_only?: boolean;
  }>;
  representation: { limitations: string[] };
};
type Preview = {
  version: string;
  sha256: string;
  source_version: string;
  diff: Array<{
    kind: string;
    target?: string;
    address?: string;
    name?: string;
    before: unknown;
    after: unknown;
  }>;
  expires: number;
  preview_token: string;
};
async function request<T>(mode: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/document-workspace/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store"
  });
  if (!response.ok)
    throw Error(
      response.status === 409
        ? "Версия или preview изменились. Откройте файл заново."
        : "Операция отклонена: неподдерживаемый объект, файл, размер или доступ."
    );
  return (await response.json()) as T;
}
function displayValue(value: unknown): string {
  if (value === null) return "(пусто)";
  if (typeof value === "object" && value && "formula" in value)
    return (
      "Формула без вычисления: " +
      (typeof value.formula === "string" ? value.formula : "(неподдержано)")
    );
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "(неподдерживаемое значение)";
}
export function OfficeDocumentWorkspace() {
  const [source, setSource] = useState<{ name: string; bytes: string } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [pageHistory, setPageHistory] = useState<OfficeCursor[]>([]);
  const [operations, setOperations] = useState<OfficeOperation[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [address, setAddress] = useState("A1");
  const [valueType, setValueType] = useState<RangeType>("string");
  const [sheetName, setSheetName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{
    url: string;
    name: string;
    version: string;
    source_version: string;
    sha256: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cancel = () => {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
    setError("");
  };
  const reset = () => {
    cancel();
    setPreview(null);
    setOperations([]);
    setEditingIndex(null);
    setResult(null);
    setError("");
  };
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result]
  );
  const run = async (fn: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const n = ++generation.current;
    const current = () => !controller.signal.aborted && generation.current === n;
    setBusy(true);
    setError("");
    try {
      await fn(controller.signal, current);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Ошибка документа");
    } finally {
      if (current()) setBusy(false);
    }
  };
  const existingSheets = source?.name.toLowerCase().endsWith(".xlsx")
    ? (view?.total_targets ?? view?.targets.length ?? 0)
    : 0;
  const invalidatePlan = () => {
    cancel();
    setPreview(null);
    setResult(null);
  };
  const applyPlan = (next: OfficeOperation[]) => {
    validateEditableOfficePlan(next, existingSheets);
    invalidatePlan();
    setOperations(next);
    setEditingIndex(null);
  };
  const queue = (op: OfficeOperation) => {
    try {
      if (editingIndex !== null)
        throw Error("Сначала сохраните или отмените редактирование правки.");
      applyPlan([...operations, op]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "План отклонён");
      return;
    }
  };
  const selectableTargets = [
    ...(view?.targets ?? []),
    ...operations
      .filter((op) => op.kind === "add_sheet")
      .map((op, i) => ({
        id: `sheet:${(view?.total_targets ?? view?.targets.length ?? 0) + i + 1}`,
        name: op.name
      }))
  ];
  const loadPage = (cursor: OfficeCursor, previous: boolean) => {
    if (!source || !view) return;
    void run(async (signal, current) => {
      const opened = await request<View>(
        "inspect",
        { ...source, cursor, expected_version: view.version },
        signal
      );
      if (current()) {
        setPageHistory(
          previous
            ? pageHistory.slice(0, -1)
            : [...pageHistory, view.cursor ?? { target_offset: 0, content_offset: 0 }]
        );
        setView(opened);
        setTarget(opened.targets[0]?.id ?? "");
        setPreview(null);
      }
    });
  };
  const xlsx = source?.name.toLowerCase().endsWith(".xlsx");
  return (
    <section aria-label="Рабочие документы Koswork">
      <h3>Рабочие документы Koswork</h3>
      <p>
        DOCX, XLSX, PPTX до 2 МиБ. Выбранный файл отправляется серверу для безопасного разбора.
        Сохраняется новая копия; исходник остаётся у вас.
      </p>
      <label>
        Открыть Office{" "}
        <input
          type="file"
          accept=".docx,.xlsx,.pptx"
          disabled={busy}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            reset();
            setView(null);
            setSource(null);
            setPageHistory([]);
            if (!file) return;
            void run(async (signal, current) => {
              if (file.size > 2 * 1024 * 1024) throw Error("Максимум 2 МиБ");
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = "";
              for (let i = 0; i < bytes.length; i += 8192)
                binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              const selected = { name: file.name, bytes: btoa(binary) };
              const opened = await request<View>("inspect", selected, signal);
              if (current()) {
                setSource(selected);
                setView(opened);
                setTarget(opened.targets[0]?.id ?? "");
              }
            });
          }}
        />
      </label>
      {view && source && (
        <>
          <p>
            {source.name} · {view.version}
          </p>
          {view.total_targets === 0 && (
            <p>
              Нет поддерживаемых текстовых объектов для редактирования. Изображения и другие
              нетекстовые элементы могут присутствовать.
            </p>
          )}
          <p>
            Текстовое представление. Визуальная корректность не проверена; формулы не вычисляются.
            Экспорт относится к выбранному снимку файла.
          </p>
          {(view.next_cursor || pageHistory.length > 0) && (
            <nav aria-label="Страницы Office">
              <button
                type="button"
                disabled={busy || !pageHistory.length}
                onClick={() => {
                  const cursor = pageHistory.at(-1);
                  if (cursor) loadPage(cursor, true);
                }}
              >
                Предыдущая часть
              </button>
              <button
                type="button"
                disabled={busy || !view.next_cursor}
                onClick={() => {
                  if (view.next_cursor) loadPage(view.next_cursor, false);
                }}
              >
                Следующая часть
              </button>
              <p>
                Часть {pageHistory.length + 1}. Всего объектов: {view.total_targets}.
              </p>
            </nav>
          )}
          <details>
            <summary>Содержимое и адреса</summary>
            {view.targets.map((item) => (
              <article key={item.id}>
                <h4>
                  {item.id}
                  {item.name ? ` · ${item.name}` : ""}
                </h4>
                {item.cells ? (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>Ячейка</th>
                          <th>Тип</th>
                          <th>Значение</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.cells.map((cell) => (
                          <tr key={cell.address}>
                            <td>{cell.address}</td>
                            <td>
                              {(
                                {
                                  n: "Число",
                                  b: "Логическое",
                                  inlineStr: "Текст",
                                  s: "Текст",
                                  str: "Текст",
                                  d: "Дата",
                                  e: "Ошибка"
                                } as Record<string, string>
                              )[cell.type] ?? cell.type}
                            </td>
                            <td>
                              {cell.formula !== null
                                ? `Формула: ${cell.formula}; сохранённое значение: ${cell.cached_value ?? "отсутствует"} (не вычислен здесь)`
                                : cell.text}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {item.cells_excerpt_only && (
                      <p>
                        Показаны ячейки {(item.cells_offset ?? 0) + 1}–
                        {(item.cells_offset ?? 0) + item.cells.length} из {item.total_cells}.
                      </p>
                    )}
                  </>
                ) : (
                  <div>
                    {item.text_excerpt_only && (
                      <p>
                        Часть текста: {(item.text_offset ?? 0) + 1}–
                        {(item.text_offset ?? 0) + (item.text?.length ?? 0)} из{" "}
                        {item.total_text_utf16}.
                      </p>
                    )}
                    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text}</p>
                  </div>
                )}
              </article>
            ))}
          </details>
          <fieldset disabled={busy} style={{ minWidth: 0 }}>
            <legend>План правок</legend>
            <label>
              Адрес{" "}
              <select aria-label="Адрес" value={target} onChange={(e) => setTarget(e.target.value)}>
                {selectableTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} {t.name}
                  </option>
                ))}
              </select>
            </label>
            {xlsx ? (
              <>
                <label>
                  Ячейка <input value={address} onChange={(e) => setAddress(e.target.value)} />
                </label>
                <label>
                  Тип{" "}
                  <select
                    aria-label="Тип"
                    value={valueType}
                    onChange={(e) => setValueType(e.target.value as RangeType)}
                  >
                    <option value="string">Текст (сохраняет ведущие нули)</option>
                    <option value="number">Число</option>
                    <option value="boolean">Логическое (true/false)</option>
                    <option value="formula">Формула без вычисления</option>
                    <option value="null">Очистить</option>
                  </select>
                </label>
                <label>
                  Значение <input value={replace} onChange={(e) => setReplace(e.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={editingIndex !== null}
                  onClick={() => {
                    try {
                      queue({
                        kind: "set_cell",
                        target,
                        address,
                        value: officeCellValue(replace, valueType)
                      });
                    } catch (error) {
                      setError(error instanceof Error ? error.message : "Ячейка отклонена");
                    }
                  }}
                >
                  Добавить правку ячейки
                </button>
                <OfficeRangeEditor target={target} onAdd={queue} disabled={editingIndex !== null} />
                <label>
                  Новый лист{" "}
                  <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={editingIndex !== null}
                  onClick={() => queue({ kind: "add_sheet", name: sheetName })}
                >
                  Добавить лист в план
                </button>
                <p>
                  После добавления листа выберите его адрес, чтобы включить ячейки в тот же план.
                </p>
              </>
            ) : (
              <>
                <label>
                  Найти точный текст{" "}
                  <input value={find} onChange={(e) => setFind(e.target.value)} />
                </label>
                <label>
                  Заменить на <input value={replace} onChange={(e) => setReplace(e.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={!find || !target || editingIndex !== null}
                  onClick={() => queue({ kind: "replace_text", target, find, replace })}
                >
                  Добавить замену в план
                </button>
              </>
            )}
            <OfficePlanEditor
              operations={operations}
              editingIndex={editingIndex}
              onStart={(index) => {
                invalidatePlan();
                setEditingIndex(index);
              }}
              onCancel={() => {
                invalidatePlan();
                setEditingIndex(null);
              }}
              onSave={(index, replacement) => {
                try {
                  applyPlan(replaceOfficeOperation(operations, index, replacement, existingSheets));
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Правка отклонена");
                }
              }}
              onRemove={(index) => {
                invalidatePlan();
                try {
                  applyPlan(removeOfficeOperation(operations, index, existingSheets));
                  setTarget(officeTargetAfterRemoval(operations, index, existingSheets, target));
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Удаление отклонено");
                }
              }}
            />
            <p>
              Файл новой копии: {source.name.replace(/\.(docx|xlsx|pptx)$/i, ".koswork.$1")}. Папку
              сохранения определяет браузер.
            </p>
            <button type="button" onClick={reset}>
              Очистить план
            </button>
            <button
              type="button"
              disabled={!operations.length || editingIndex !== null}
              onClick={() => {
                void run(async (signal, current) => {
                  const proposal = await request<Preview>(
                    "preview",
                    { ...source, expected_version: view.version, operations },
                    signal
                  );
                  if (current()) {
                    setPreview(proposal);
                    setResult(null);
                  }
                });
              }}
            >
              Посмотреть изменения
            </button>
          </fieldset>
          {preview && (
            <div>
              <h4>Предлагаемые изменения</h4>
              <p>
                Файл новой копии: {source.name.replace(/\.(docx|xlsx|pptx)$/i, ".koswork.$1")}.
                Исходник сохраняется.
              </p>
              <ul>
                {preview.diff.map((change, i) => (
                  <li key={i}>
                    <p>
                      {change.target ?? change.name}
                      {change.address ? ` / ${change.address}` : ""}
                    </p>
                    <p>Было: {displayValue(change.before)}</p>
                    <p>Будет: {displayValue(change.after)}</p>
                    {change.kind === "set_cell" && (
                      <p>
                        Тип после:{" "}
                        {change.after === null
                          ? "Очистить"
                          : typeof change.after === "object"
                            ? "Формула без вычисления"
                            : typeof change.after === "number"
                              ? "Число"
                              : typeof change.after === "boolean"
                                ? "Логическое"
                                : "Текст"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || editingIndex !== null}
                onClick={() => {
                  void run(async (signal, current) => {
                    const saved = await request<Preview & { bytes: string }>(
                      "commit",
                      {
                        ...source,
                        expected_version: view.version,
                        operations,
                        preview_token: preview.preview_token,
                        expires: preview.expires
                      },
                      signal
                    );
                    if (!current()) return;
                    const binary = atob(saved.bytes);
                    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
                    if (!globalThis.crypto?.subtle)
                      throw Error(
                        "Проверка новой копии не пройдена: требуется HTTPS или localhost."
                      );
                    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
                    const sha256 = Array.from(digest, (value) =>
                      value.toString(16).padStart(2, "0")
                    ).join("");
                    if (
                      saved.source_version !== view.version ||
                      saved.version !== preview.version ||
                      saved.sha256 !== preview.sha256 ||
                      saved.sha256 !== sha256 ||
                      saved.version !== "sha256:" + sha256
                    )
                      throw Error(
                        "Проверка новой копии не пройдена: байты или версия не совпадают с preview."
                      );
                    if (!current()) return;
                    setResult({
                      url: URL.createObjectURL(
                        new Blob([bytes], { type: "application/octet-stream" })
                      ),
                      name: source.name.replace(/\.(docx|xlsx|pptx)$/i, ".koswork.$1"),
                      version: saved.version,
                      source_version: saved.source_version,
                      sha256: saved.sha256
                    });
                    setPreview(null);
                  });
                }}
              >
                Подтвердить подготовку новой копии
              </button>
            </div>
          )}
        </>
      )}
      {busy && (
        <button type="button" onClick={cancel}>
          Отменить
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <p>Копия подготовлена и повторно прочитана. Для сохранения скачайте файл.</p>
          <pre>
            {JSON.stringify(
              {
                source_version: result.source_version,
                version: result.version,
                sha256: result.sha256
              },
              null,
              2
            )}
          </pre>
          <a href={result.url} download={result.name}>
            Скачать новую копию
          </a>
        </div>
      )}
    </section>
  );
}
