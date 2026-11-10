"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./personal-settings.module.css";

type DriveConnectionStatus = {
  owner_id: string;
  revision: number;
  connection_id: string | null;
  folder_id: string | null;
  folder_state: "disconnected" | "reserved" | "creating" | "uncertain" | "ready";
  updated_at: string;
};

type MultipartBackupSetView = {
  backupSetId: string;
  connectionId: string;
  totalParts: number;
  verifiedParts: number;
  complete: boolean;
  state: "verified" | "in_progress" | "uncertain" | "failed" | "incomplete";
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  parts: Array<{
    partIndex: number;
    archiveId: string;
    operationId: string;
    fileId: string;
    bytes: number;
    sha256: string;
    state: "reserved" | "uploading" | "checking" | "uncertain" | "verified" | "failed";
  }>;
};

type DriveOwnerOverview = {
  configured: boolean;
  connected: boolean;
  connection: DriveConnectionStatus | null;
  queue: {
    activeCount: number;
    uncertainCount: number;
    failedCount: number;
    verifiedCount: number;
  };
  backupSets: MultipartBackupSetView[];
};

type RestorePreview = {
  valid: true;
  schemaVersion: number;
  backupSetId: string;
  ownerId: string;
  generatedAt: string;
  totalParts: number;
  counts: {
    projects: number;
    generalChats: number;
    generalMessages: number;
    projectMessages: number;
    documents: number;
    canvasArtifacts: number;
    researchRuns: number;
    originals: number;
  };
  excludedCategories: string[];
};

type RestoreResult = {
  restored: true;
  backupSetId: string;
  restoredAt: string;
  counts: RestorePreview["counts"];
};

const base = "/api/v1/personal-settings/google-drive";

async function driveRequest<T>(route: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${route}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    throw new Error(body?.error?.message ?? body?.error?.code ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function GoogleDrivePanel() {
  const [overview, setOverview] = useState<DriveOwnerOverview | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await driveRequest<DriveOwnerOverview>("/status");
    setOverview(data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Google Drive недоступен"));
  }, [load]);

  const startConnect = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await driveRequest<{ authorization_url: string; state: string }>("/connect/start", {
        method: "POST",
        body: "{}"
      });
      window.location.assign(res.authorization_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать подключение Google Drive");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await driveRequest<DriveOwnerOverview>("/disconnect", {
        method: "POST",
        body: "{}"
      });
      setOverview(next);
      setRestorePreview(null);
      setMessage("Подключение Google Drive отключено. Прежние квитанции сохранены в журнале.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отключить Google Drive");
    } finally {
      setBusy(false);
    }
  };

  const retryFolder = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await driveRequest<DriveOwnerOverview>("/folder/retry", {
        method: "POST",
        body: "{}"
      });
      setOverview(next);
      setMessage("Папка архивов Kosmora проверена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить папку на Google Drive");
    } finally {
      setBusy(false);
    }
  };

  const createBackup = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await driveRequest<{
        backupSet: MultipartBackupSetView;
      }>("/backups", {
        method: "POST",
        body: "{}"
      });
      await load();
      if (res.backupSet.complete && res.backupSet.state === "verified") {
        setMessage(
          `Архивный набор ${res.backupSet.backupSetId} полностью сохранён и проверен (${res.backupSet.verifiedParts}/${res.backupSet.totalParts} частей).`
        );
      } else {
        setError(
          `Архивный набор ${res.backupSet.backupSetId} НЕ завершён (${res.backupSet.verifiedParts}/${res.backupSet.totalParts} частей проверено, статус: ${res.backupSet.state}). Проверьте отдельные части ниже.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать архивную копию");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const reconcilePart = async (archiveId: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await driveRequest(`/backups/${encodeURIComponent(archiveId)}/reconcile`, {
        method: "POST",
        body: "{}"
      });
      await load();
      setMessage("Состояние части архива сверено чтением с Google Drive.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сверить часть архива");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const retryPart = async (archiveId: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await driveRequest(`/backups/${encodeURIComponent(archiveId)}/retry`, {
        method: "POST",
        body: "{}"
      });
      await load();
      setMessage("Повторная отправка части архива с тем же ID завершена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось повторить отправку части архива");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const previewSetRestore = async (backupSetId: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const preview = await driveRequest<RestorePreview>("/restore/preview", {
        method: "POST",
        body: JSON.stringify({ backup_set_id: backupSetId })
      });
      setRestorePreview(preview);
    } catch (e) {
      setRestorePreview(null);
      setError(e instanceof Error ? e.message : "Не удалось проверить архив перед восстановлением");
    } finally {
      setBusy(false);
    }
  };

  const executeSetRestore = async (backupSetId: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await driveRequest<RestoreResult>("/restore", {
        method: "POST",
        body: JSON.stringify({ backup_set_id: backupSetId })
      });
      setRestorePreview(null);
      setMessage(
        `Архив ${res.backupSetId} восстановлен в новые объекты (проектов: ${res.counts.projects}, чатов: ${res.counts.generalChats}, сообщений: ${res.counts.generalMessages + res.counts.projectMessages}, документов: ${res.counts.documents}, оригиналов: ${res.counts.originals}).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Восстановление отменено без изменения базы");
    } finally {
      setBusy(false);
    }
  };

  const folderState = overview?.connection?.folder_state ?? "disconnected";

  return (
    <section>
      <h2>Архивные копии Google Drive</h2>
      <p className={styles.muted}>
        Узкое разрешение только на файлы, созданные Kosmora (drive.file). Полный архив считается
        сохранённым только после побайтовой проверки всех его частей. Восстановление создаёт новые
        проекты и чаты в одной транзакции без перезаписи текущей работы и без восстановления
        разрешений, сессий или команд исполнения.
      </p>
      {!overview ? (
        <p>Проверка состояния Google Drive…</p>
      ) : (
        <>
          <p>
            Статус подключения:{" "}
            <strong>
              {!overview.configured
                ? "не настроен OAuth-клиент сервера"
                : overview.connected
                  ? `подключено (папка: ${folderState})`
                  : "отключено"}
            </strong>
          </p>
          <p className={styles.muted}>
            Очередь текущего подключения: активных — {overview.queue.activeCount}, неопределённых —{" "}
            {overview.queue.uncertainCount}, ошибок — {overview.queue.failedCount}; всего проверенных
            частей — {overview.queue.verifiedCount}.
          </p>
          {!overview.connected ? (
            <button
              disabled={busy || !overview.configured}
              className={styles.download}
              onClick={() => void startConnect()}
            >
              Подключить Google Drive (только папка Kosmora)
            </button>
          ) : (
            <div>
              {folderState === "ready" ? (
                <button
                  disabled={busy}
                  className={styles.download}
                  onClick={() => void createBackup()}
                >
                  Создать проверенную архивную копию на Google Drive
                </button>
              ) : (
                <button disabled={busy} onClick={() => void retryFolder()}>
                  Проверить / повторить создание папки Kosmora
                </button>
              )}
              <button
                disabled={busy}
                className={styles.danger}
                onClick={() => void disconnect()}
              >
                Отключить Google Drive
              </button>
            </div>
          )}

          {overview.backupSets.length > 0 && (
            <>
              <h3>Журнал архивных наборов</h3>
              <div className={styles.scroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Набор</th>
                      <th>Части</th>
                      <th>Размер</th>
                      <th>Статус набора</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.backupSets.map((set) => (
                      <tr key={`${set.connectionId}:${set.backupSetId}`}>
                        <td>{set.backupSetId}</td>
                        <td>
                          {set.verifiedParts} / {set.totalParts}
                        </td>
                        <td>{set.totalBytes.toLocaleString("ru-RU")} Б</td>
                        <td>
                          {set.complete && set.state === "verified"
                            ? "verified (полный архив подтверждён)"
                            : `${set.state} (неполный / требует проверки)`}
                        </td>
                        <td>
                          {set.complete && set.state === "verified" ? (
                            <button
                              disabled={busy}
                              onClick={() => void previewSetRestore(set.backupSetId)}
                            >
                              Предпросмотр восстановления
                            </button>
                          ) : (
                            set.parts.map((part) =>
                              part.state === "uncertain" ? (
                                <button
                                  key={part.archiveId}
                                  disabled={busy}
                                  onClick={() => void reconcilePart(part.archiveId)}
                                >
                                  Сверить часть #{part.partIndex}
                                </button>
                              ) : part.state === "failed" ? (
                                <button
                                  key={part.archiveId}
                                  disabled={busy}
                                  onClick={() => void retryPart(part.archiveId)}
                                >
                                  Повторить часть #{part.partIndex}
                                </button>
                              ) : null
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {restorePreview && (
            <div>
              <h3>Предпросмотр восстановления набора {restorePreview.backupSetId}</h3>
              <p>
                Частей: <strong>{restorePreview.totalParts}</strong>. Будут созданы новые объекты:
                проектов — <strong>{restorePreview.counts.projects}</strong>, чатов —{" "}
                <strong>{restorePreview.counts.generalChats}</strong>, сообщений —{" "}
                <strong>
                  {restorePreview.counts.generalMessages + restorePreview.counts.projectMessages}
                </strong>
                , документов — <strong>{restorePreview.counts.documents}</strong>, холстов —{" "}
                <strong>{restorePreview.counts.canvasArtifacts}</strong>, оригиналов —{" "}
                <strong>{restorePreview.counts.originals}</strong>.
              </p>
              <button
                disabled={busy}
                className={styles.download}
                onClick={() => void executeSetRestore(restorePreview.backupSetId)}
              >
                Подтвердить восстановление в новые объекты
              </button>
              <button disabled={busy} onClick={() => setRestorePreview(null)}>
                Отмена
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
