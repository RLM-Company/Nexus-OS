"use client";
import { useEffect, useRef, useState } from "react";
import type { OfficeOperation } from "@cosmora/contracts";
type View = {
  version: string;
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
  const [operations, setOperations] = useState<OfficeOperation[]>([]);
  const [target, setTarget] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [address, setAddress] = useState("A1");
  const [valueType, setValueType] = useState("string");
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
  const reset = () => {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
    setPreview(null);
    setOperations([]);
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
  const queue = (op: OfficeOperation) => {
    setOperations([...operations, op]);
    setPreview(null);
    setResult(null);
  };
  const selectableTargets = [
    ...(view?.targets ?? []),
    ...operations
      .filter((op) => op.kind === "add_sheet")
      .map((op, i) => ({ id: `sheet:${(view?.targets.length ?? 0) + i + 1}`, name: op.name }))
  ];
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
          <p>
            Текстовое представление. Визуальная корректность не проверена; формулы не вычисляются.
            Экспорт относится к выбранному снимку файла.
          </p>
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
                            <td>{cell.type}</td>
                            <td>
                              {cell.formula !== null
                                ? `Формула: ${cell.formula}; сохранённый кеш: ${cell.cached_value ?? "отсутствует"} (не вычислен здесь)`
                                : cell.text}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {item.cells_excerpt_only && (
                      <p>Показаны первые 100 из {item.total_cells} ячеек.</p>
                    )}
                  </>
                ) : (
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text}</p>
                )}
              </article>
            ))}
          </details>
          <fieldset disabled={busy}>
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
                    onChange={(e) => setValueType(e.target.value)}
                  >
                    <option value="string">Текст (сохраняет ведущие нули)</option>
                    <option value="number">Число</option>
                    <option value="formula">Формула без вычисления</option>
                    <option value="null">Очистить</option>
                  </select>
                </label>
                <label>
                  Значение <input value={replace} onChange={(e) => setReplace(e.target.value)} />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      valueType === "number" &&
                      (!replace.trim() || !Number.isFinite(Number(replace)))
                    ) {
                      setError("Введите конечное число");
                      return;
                    }
                    queue({
                      kind: "set_cell",
                      target,
                      address,
                      value:
                        valueType === "number"
                          ? Number(replace)
                          : valueType === "formula"
                            ? { formula: replace }
                            : valueType === "null"
                              ? null
                              : replace
                    });
                  }}
                >
                  Добавить правку ячейки
                </button>
                <label>
                  Новый лист{" "}
                  <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
                </label>
                <button type="button" onClick={() => queue({ kind: "add_sheet", name: sheetName })}>
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
                  disabled={!find}
                  onClick={() => queue({ kind: "replace_text", target, find, replace })}
                >
                  Добавить замену в план
                </button>
              </>
            )}
            <ol aria-label="План правок">
              {operations.map((op, i) => (
                <li key={i}>
                  {op.kind === "replace_text"
                    ? `${op.target}: «${op.find}» → «${op.replace}»`
                    : op.kind === "add_sheet"
                      ? `Добавить лист «${op.name}»`
                      : op.kind === "set_cell"
                        ? `${op.target}/${op.address}: ${displayValue(op.value)}`
                        : `${op.target}: диапазон ${op.start}`}
                </li>
              ))}
            </ol>
            <button type="button" onClick={reset}>
              Очистить план
            </button>
            <button
              type="button"
              disabled={!operations.length}
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
              <ul>
                {preview.diff.map((change, i) => (
                  <li key={i}>
                    <p>
                      {change.target ?? change.name}
                      {change.address ? ` / ${change.address}` : ""}
                    </p>
                    <p>Было: {displayValue(change.before)}</p>
                    <p>Будет: {displayValue(change.after)}</p>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
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
        <button
          type="button"
          onClick={() => {
            reset();
          }}
        >
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
