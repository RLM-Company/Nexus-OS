"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DRIVE_OFFICE_FILE_MAX_BYTES, type GoogleDriveSourceList } from "@cosmora/contracts";
type Summary = {
  chats: number;
  messages: number;
  files: number;
  exported_at: string;
  unfinished_messages: number;
  extracted_documents: number;
  titles: string[];
  filenames: string[];
};
type Backup = {
  id: string;
  state: string;
  bytes: number;
  parts: number;
  saved_parts: number;
  created_at: string;
  can_retry: boolean;
  has_preview?: boolean;
  preview: Summary;
};
type Preview = Summary & { token: string; expires_at: number; backup: string; operation: string };
type Restored = {
  id: string;
  chats: { id: string; title: string }[];
  files: { id: string; name: string }[];
};
const root = "/api/v1/storage/drive";
async function api<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(root + path, {
    cache: "no-store",
    credentials: "same-origin",
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw Error(data?.error?.code ?? "BACKUP_UNAVAILABLE");
  }
  return r.json() as Promise<T>;
}
const failure = (e: unknown) => {
  const code = e instanceof Error ? e.message : "";
  if (code === "BACKUP_TOO_LARGE")
    return "Копия превышает 32 МиБ. Выберите меньше чатов или отключите результаты Work.";
  if (code === "BACKUP_CACHE_FULL")
    return "Временное хранилище заполнено. Завершите или освободите незавершённые снимки.";
  if (code === "RESTORE_STALE")
    return "Предпросмотр истёк или состояние аккаунта изменилось. Откройте предпросмотр заново.";
  if (code === "BACKUP_EMPTY")
    return "В выбранной области пока нет чатов или опубликованных результатов.";
  if (code === "DRIVE_OPERATION_CONFLICT")
    return "Выбранный файл изменился или больше недоступен. Обновите список и выберите его заново.";
  if (code === "BACKUP_INVALID_SELECTION")
    return "Проверьте выбранные чаты и файлы: часть источников больше недоступна.";
  if (code === "OFFICE_FILE_TOO_LARGE") return "Максимальный размер файла Office — 2 МиБ.";
  if (code === "BACKUP_INVALID_OFFICE_FILE")
    return "Выберите файл DOCX, XLSX или PPTX размером до 2 МиБ.";
  if (["BACKUP_BUSY", "DRIVE_OWNER_BUSY", "DRIVE_BUSY"].includes(code))
    return "Другая операция ещё выполняется. Повторите чуть позже.";
  if (["DRIVE_CONNECTION_CHANGED", "OWNER_DATA_FENCED"].includes(code))
    return "Подключение изменилось. Обновите страницу; исходные чаты сохранены.";
  return "Операция не завершена. Копия не считается проверенной; исходные данные не перезаписаны. Можно повторить загрузку или проверить доступ к Drive.";
};
export function GoogleDriveBackupControls({
  connected,
  onChange
}: {
  connected: boolean;
  onChange: () => Promise<void>;
}) {
  const [items, setItems] = useState<Backup[]>([]),
    [sources, setSources] = useState<{ id: string; title: string; mode: string }[]>([]);
  const [files, setFiles] = useState<
      { id: string; name: string; source_project?: string; source_version?: number }[]
    >([]),
    [all, setAll] = useState(true),
    [results, setResults] = useState(true);
  const [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [restored, setRestored] = useState<Restored | null>(null);
  const [fileSources, setFileSources] = useState<NonNullable<GoogleDriveSourceList["files"]>>([]),
    [fileSelection, setFileSelection] = useState(false),
    [customFiles, setCustomFiles] = useState(false),
    [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [officeSelection, setOfficeSelection] = useState(false);
  const [officeFile, setOfficeFile] = useState<File | null>(null);
  const officeInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const operation = useRef<string | null>(null);
  const [moreBackups, setMoreBackups] = useState(false),
    [moreFiles, setMoreFiles] = useState(false);
  const reload = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      api<{ items: Backup[]; has_more?: boolean }>("/backups"),
      api<GoogleDriveSourceList>("/sources"),
      api<{ items: typeof files; has_more?: boolean }>("/restored-files")
    ]);
    setItems(a.items ?? []);
    setSources(b.items ?? []);
    setFileSelection(b.file_selection === true);
    setOfficeSelection(b.office_file_selection === true);
    setFileSources(b.file_selection === true ? (b.files ?? []) : []);
    setFiles(c.items ?? []);
    setMoreBackups(Boolean(a.has_more));
    setMoreFiles(Boolean(c.has_more));
  }, []);
  useEffect(() => {
    void reload().catch(() => setError("Список копий пока недоступен."));
  }, [reload, connected]);
  const run = async (job: () => Promise<void>, refresh = true) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await job();
    } catch (e) {
      setError(failure(e));
    } finally {
      if (refresh) {
        await reload().catch(() => {});
        await onChange().catch(() => {});
      }
      setBusy(false);
    }
  };
  return (
    <div aria-busy={busy}>
      <h3>Копии чатов и результатов</h3>
      <p>
        Чаты Kosmora/Koswork, сохранённые в них изображения и текст вложений, опубликованные файлы
        Work. Исходные PDF/DOCX, если в чате остался только извлечённый текст, не восстанавливаются
        как оригиналы.
      </p>
      <details>
        <summary>Что сохранить</summary>
        <label>
          <input
            type="checkbox"
            checked={all}
            disabled={busy}
            onChange={(e) => {
              setAll(e.target.checked);
              operation.current = null;
            }}
          />{" "}
          Все чаты Kosmora/Koswork
        </label>
        {!all && (
          <ul>
            {sources.map((c) => (
              <li key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(c.id)}
                    onChange={(e) => {
                      setSelected((old) =>
                        e.target.checked ? [...old, c.id] : old.filter((id) => id !== c.id)
                      );
                      operation.current = null;
                    }}
                  />{" "}
                  {c.title}
                </label>
              </li>
            ))}
          </ul>
        )}
        <label>
          <input
            type="checkbox"
            checked={results}
            disabled={busy || customFiles}
            onChange={(e) => {
              setResults(e.target.checked);
              operation.current = null;
            }}
          />{" "}
          Опубликованные результаты Work
        </label>
        {(fileSelection || customFiles) && (
          <>
            <label>
              <input
                type="checkbox"
                checked={customFiles}
                disabled={busy}
                onChange={(e) => {
                  setCustomFiles(e.target.checked);
                  operation.current = null;
                }}
              />{" "}
              Выбрать файлы по отдельности
            </label>
            {customFiles && (
              <fieldset disabled={busy}>
                <legend>Сохранить только отмеченные файлы</legend>
                {fileSources.length === 0 && <p>Доступных результатов пока нет.</p>}
                {fileSources.map((file) => (
                  <label key={file.id}>
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file.id)}
                      onChange={(e) => {
                        setSelectedFiles((old) =>
                          e.target.checked ? [...old, file.id] : old.filter((id) => id !== file.id)
                        );
                        operation.current = null;
                      }}
                    />{" "}
                    {file.name} · {file.project} · v{file.version} ·{" "}
                    {(file.bytes / 1024).toFixed(1)} КиБ
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {officeSelection && (
          <label>
            Файл Office с устройства (DOCX, XLSX или PPTX, до 2 МиБ)
            <input
              ref={officeInput}
              type="file"
              accept=".docx,.xlsx,.pptx"
              disabled={busy}
              onChange={(event) => {
                setOfficeFile(event.currentTarget.files?.[0] ?? null);
                operation.current = null;
              }}
            />
          </label>
        )}
      </details>
      <button
        type="button"
        disabled={busy || !connected}
        onClick={() =>
          void run(async () => {
            if (
              customFiles &&
              (!fileSelection ||
                selectedFiles.some((id) => !fileSources.some((file) => file.id === id)))
            )
              throw Error("DRIVE_OPERATION_CONFLICT");
            let office_file: { name: string; bytes: string } | undefined;
            if (officeFile) {
              if (!officeSelection) throw Error("DRIVE_OPERATION_CONFLICT");
              if (officeFile.size > DRIVE_OFFICE_FILE_MAX_BYTES)
                throw Error("OFFICE_FILE_TOO_LARGE");
              const bytes = new Uint8Array(await officeFile.arrayBuffer());
              let binary = "";
              for (let offset = 0; offset < bytes.length; offset += 8192)
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              office_file = { name: officeFile.name, bytes: btoa(binary) };
            }
            operation.current ??= crypto.randomUUID();
            await api("/backups", {
              operation_id: operation.current,
              include_results: customFiles ? false : results,
              ...(customFiles ? { file_ids: selectedFiles } : {}),
              ...(!all ? { chat_ids: selected } : {}),
              ...(office_file ? { office_file } : {})
            });
            operation.current = null;
            if (officeFile) {
              setOfficeFile(null);
              if (officeInput.current) officeInput.current.value = "";
            }
            setNotice("Все части копии сохранены и проверены.");
          })
        }
      >
        Сохранить копию на Drive
      </button>
      {busy && <p role="status">Операция выполняется. Крупные копии передаются частями.</p>}
      {items.length > 0 && (
        <ul aria-label="Копии на Drive">
          {items.map((item) => (
            <li key={item.id}>
              <p>
                {new Date(item.created_at).toLocaleString("ru-RU")} · Чаты: {item.preview.chats} ·{" "}
                Файлы: {item.preview.files} · {(item.bytes / 1048576).toFixed(1)} МиБ
              </p>
              <p>
                {item.state === "verified"
                  ? "Проверена"
                  : item.state === "discarded"
                    ? "Временный снимок удалён"
                    : "Не завершена"}{" "}
                · {item.saved_parts}/{item.parts} частей
              </p>
              {item.has_preview && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/backups/${item.id}/cancel-preview`, {});
                      setPreview((old) => (old?.backup === item.id ? null : old));
                      setNotice("Временный предпросмотр освобождён. Копия на Drive сохранена.");
                    })
                  }
                >
                  Закрыть предпросмотр
                </button>
              )}
              {item.can_retry && (
                <button
                  disabled={busy || !connected}
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await api(`/backups/${item.id}/retry`, {});
                      setNotice("Копия проверена.");
                    })
                  }
                >
                  Продолжить загрузку
                </button>
              )}
              {item.state !== "discarded" && (
                <button
                  disabled={busy || !connected}
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const p = await api<Summary & { token: string; expires_at: number }>(
                        `/backups/${item.id}/preview`,
                        {}
                      );
                      setRestored(null);
                      setPreview({ ...p, backup: item.id, operation: crypto.randomUUID() });
                    })
                  }
                >
                  Проверить и восстановить
                </button>
              )}
              {item.can_retry && (
                <button
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      if (
                        !window.confirm(
                          "Удалить временный снимок? Повтор его передачи станет недоступен. Исходные чаты и файлы на Drive останутся."
                        )
                      )
                        return;
                      await api(`/backups/${item.id}/discard`, {});
                      setNotice("Временный снимок удалён.");
                    })
                  }
                >
                  Освободить временный снимок
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {moreBackups && (
        <button
          disabled={busy}
          type="button"
          onClick={() =>
            void run(async () => {
              const data = await api<{ items: Backup[]; has_more: boolean }>(
                `/backups?offset=${items.length}`
              );
              setItems((old) => [...old, ...data.items]);
              setMoreBackups(data.has_more);
            }, false)
          }
        >
          Показать ещё копии
        </button>
      )}
      {preview && (
        <div role="region" aria-label="Предпросмотр восстановления">
          <h3>Предпросмотр восстановления</h3>
          <p>
            Чаты: {preview.chats}. Сообщения: {preview.messages}. Файлы: {preview.files}.
          </p>
          <p>
            Будут созданы новые чаты и отдельные файлы. Существующие данные не перезаписываются;
            задачи, доступы и подключения не восстанавливаются. Подтверждение действует 10 минут.
          </p>
          {preview.unfinished_messages > 0 && (
            <p>
              Прерванных сообщений: {preview.unfinished_messages}. Они останутся остановленными.
            </p>
          )}
          {preview.extracted_documents > 0 && (
            <p>
              Вложений PDF/DOCX с сохранённым извлечённым текстом: {preview.extracted_documents}.
            </p>
          )}
          <ul>
            {preview.titles.map((title, i) => (
              <li key={i}>{title}</li>
            ))}
            {preview.filenames.map((name, i) => (
              <li key={"file" + i}>{name}</li>
            ))}
          </ul>
          <button
            disabled={busy || !connected}
            type="button"
            onClick={() =>
              void run(async () => {
                const result = await api<Restored>(`/backups/${preview.backup}/restore`, {
                  token: preview.token,
                  operation_id: preview.operation
                });
                setRestored(result);
                setPreview(null);
                setNotice("Новые копии восстановлены.");
              })
            }
          >
            Восстановить копии
          </button>
          <button
            disabled={busy}
            type="button"
            onClick={() =>
              void run(async () => {
                await api(`/backups/${preview.backup}/cancel-preview`, {});
                setPreview(null);
              })
            }
          >
            Отмена
          </button>
        </div>
      )}
      {restored && (
        <ul aria-label="Восстановленные чаты">
          {restored.chats.map((c) => (
            <li key={c.id}>
              <a href={`/?chat=${encodeURIComponent(c.id)}`}>{c.title}</a>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <>
          <h3>Восстановленные файлы</h3>
          <ul>
            {files.map((f) => (
              <li key={f.id}>
                <a href={`${root}/restored-files/${encodeURIComponent(f.id)}`}>
                  {f.name}
                  {f.source_project ? ` · ${f.source_project} · v${f.source_version ?? 1}` : ""}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {moreFiles && (
        <button
          disabled={busy}
          type="button"
          onClick={() =>
            void run(async () => {
              const data = await api<{ items: typeof files; has_more: boolean }>(
                `/restored-files?offset=${files.length}`
              );
              setFiles((old) => [...old, ...data.items]);
              setMoreFiles(data.has_more);
            }, false)
          }
        >
          Показать ещё файлы
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
