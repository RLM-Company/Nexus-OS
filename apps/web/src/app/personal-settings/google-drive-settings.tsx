"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GoogleDriveConnectionView, GoogleDriveConnectStart } from "@cosmora/contracts";
import { consumeDriveFlow, rememberDriveFlow } from "./google-drive-flow";
import { GoogleDriveBackupControls } from "./google-drive-backup-controls";

const endpoint = "/api/v1/storage/drive";
async function request<T>(path = "", body?: object): Promise<T> {
  const result = await fetch(endpoint + path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  if (!result.ok) {
    const data = (await result.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw Error(data?.error?.code ?? "DRIVE_REQUEST_FAILED");
  }
  return result.json() as Promise<T>;
}
const message = (e: unknown): string => {
  const code = e instanceof Error ? e.message : "";
  if (code === "DRIVE_AUTH_FAILED" || code === "DRIVE_AUTH_INVALID_GRANT")
    return "Подключение не подтверждено. Начните вход в Google заново в этой вкладке.";
  if (code === "DRIVE_NOT_CONFIGURED") return "Подключение Google Drive пока недоступно.";
  if (["DRIVE_AUTH_BUSY", "DRIVE_OWNER_BUSY", "DRIVE_BUSY"].includes(code))
    return "Другая операция ещё выполняется. Повторите чуть позже.";
  if (code === "DRIVE_CONNECTION_CHANGED" || code === "OWNER_DATA_FENCED")
    return "Состояние аккаунта изменилось. Обновите страницу и повторите подключение.";
  return "Не удалось завершить операцию с Google Drive. Повторите позже.";
};

export function GoogleDriveSettings() {
  const [status, setStatus] = useState<GoogleDriveConnectionView | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const started = useRef(false);
  const reload = useCallback(async () => {
    const next = await request<GoogleDriveConnectionView>();
    setStatus(next);
  }, []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = window.location.hash;
    const isCallback = /(?:^#|&)(?:drive_state|drive_code|drive_error|drive_result)=/.test(
      fragment
    );
    if (isCallback)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search + "#drive-storage"
      );
    const initialize = async () => {
      try {
        if (isCallback) {
          setBusy(true);
          const input = consumeDriveFlow(window.sessionStorage, fragment);
          if (input) {
            const data = await request<GoogleDriveConnectionView & { result: string }>(
              "/finish",
              input
            );
            setStatus(data);
            setNotice(
              data.result === "cancelled"
                ? "Подключение отменено."
                : data.state === "connected"
                  ? "Google Drive подключён."
                  : "Вход подтверждён. Папку пока не удалось проверить — нажмите «Проверить подключение»."
            );
          }
        }
      } catch (e) {
        setError(message(e));
      } finally {
        await reload().catch((e: unknown) => setError(message(e)));
        setBusy(false);
      }
    };
    void initialize();
  }, [reload]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="drive-storage" aria-labelledby="drive-heading" aria-busy={busy}>
      <h2 id="drive-heading">Google Drive</h2>
      <p>
        Копии чатов и результатов в вашей папке Kosmora. Подключение не переносит текущие данные и
        не открывает доступ ко всему диску.
      </p>
      {!status ? (
        <p>Проверяем подключение…</p>
      ) : (
        <>
          <p role="status">
            {status.state === "connected"
              ? "Подключён"
              : status.state === "preparing"
                ? "Требуется проверка папки"
                : status.state === "unavailable"
                  ? "Подключение пока недоступно"
                  : "Не подключён"}
          </p>
          {status.archive_count > 0 && (
            <p>
              Копий в журнале: {status.archive_count}. Непроверенных: {status.pending_count}.
            </p>
          )}
          {status.configured && (
            <button
              disabled={busy}
              type="button"
              onClick={() =>
                void run(async () => {
                  const start = await request<GoogleDriveConnectStart>("/connect", {});
                  let target: string;
                  try {
                    target = rememberDriveFlow(window.sessionStorage, start);
                  } catch {
                    setError("Для подключения разрешите временное хранилище вкладки в браузере.");
                    return;
                  }
                  window.location.assign(target);
                })
              }
            >
              {status.can_disconnect ? "Подключить заново" : "Подключить Google Drive"}
            </button>
          )}
          {status.state === "preparing" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await request<GoogleDriveConnectionView>("/check", {});
                  setStatus(next);
                  setNotice(
                    next.state === "connected"
                      ? "Google Drive подключён."
                      : "Папка пока недоступна."
                  );
                })
              }
            >
              Проверить подключение
            </button>
          )}
          {status.can_retry && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setStatus(await request<GoogleDriveConnectionView>("/retry-folder", {}));
                  setNotice("Папка проверена.");
                })
              }
            >
              Повторить создание папки
            </button>
          )}
          {status.can_disconnect && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setStatus(await request<GoogleDriveConnectionView>("/disconnect", {}));
                  setNotice("Подключение отключено. Копии на вашем Drive сохранены.");
                })
              }
            >
              Отключить Google Drive
            </button>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <p>При отключении или удалении данных Kosmora копии на вашем Drive остаются.</p>
      {status && (
        <GoogleDriveBackupControls connected={status.state === "connected"} onChange={reload} />
      )}
    </section>
  );
}
