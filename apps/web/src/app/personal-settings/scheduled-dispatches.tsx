"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./personal-settings.module.css";

type Dispatch = {
  id: string;
  kind: "message" | "work_task" | "koscode_task" | "team_task";
  mode: "once" | "daily" | "weekdays" | "weekly";
  due_at: string;
  status: "scheduled" | "ready" | "dispatched" | "cancelled";
  chat_id: string | null;
  project_id: string | null;
  payload: { text: string; title?: string };
};
const KIND_LABEL: Record<Dispatch["kind"], string> = {
  message: "Сообщение в чат",
  work_task: "Задача Koswork",
  koscode_task: "Задача Koscode",
  team_task: "Задача команды"
};
const MODE_LABEL: Record<Dispatch["mode"], string> = {
  once: "Один раз",
  daily: "Каждый день",
  weekdays: "По будням",
  weekly: "Раз в неделю"
};
const STATUS_LABEL: Record<Dispatch["status"], string> = {
  scheduled: "Запланировано",
  ready: "Готово к отправке",
  dispatched: "Исполнено",
  cancelled: "Отменено"
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/scheduled-dispatches${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "content-type": "application/json", ...options?.headers }
  });
  if (!response.ok) throw new Error(`Ошибка HTTP ${response.status}`);
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}
const toLocalInput = () => {
  const at = new Date(Date.now() + 3_600_000);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ScheduledDispatches() {
  const [items, setItems] = useState<Dispatch[]>([]);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Dispatch["kind"]>("message");
  const [mode, setMode] = useState<Dispatch["mode"]>("once");
  const [due, setDue] = useState(toLocalInput);
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setItems((await api<{ items: Dispatch[] }>("")).items);
    } catch {
      setNotice("Расписание недоступно.");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await task();
      await reload();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      if (!text.trim() || !due) throw new Error("Укажите текст и время.");
      const body = {
        client_request_id: crypto.randomUUID(),
        kind,
        mode,
        due_at: new Date(due).toISOString(),
        text: text.trim(),
        ...(kind === "message" ? { chat_id: target } : { project_id: target })
      };
      await api("", { method: "POST", body: JSON.stringify(body) });
      setText("");
      setNotice("Добавлено в расписание.");
    });

  return (
    <section id="scheduled-dispatches" aria-label="Планировка задач и отправки">
      <h2>Планировка</h2>
      <p className={styles.muted}>
        Расстановка задач для Koswork, Koscode и команды по дням, а также отправка сообщения в
        заданное время в любом чате, включая обычный. Отправка выполняется явным тиком и не
        запускает модель скрытно.
      </p>
      <div className={styles.scheduleForm}>
        <label>
          Тип
          <select value={kind} onChange={(e) => setKind(e.target.value as Dispatch["kind"])}>
            {(Object.keys(KIND_LABEL) as Dispatch["kind"][]).map((key) => (
              <option key={key} value={key}>
                {KIND_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Повтор
          <select value={mode} onChange={(e) => setMode(e.target.value as Dispatch["mode"])}>
            {(Object.keys(MODE_LABEL) as Dispatch["mode"][]).map((key) => (
              <option key={key} value={key}>
                {MODE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Когда
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>
          {kind === "message" ? "ID чата" : "ID проекта"}
          <input
            value={target}
            placeholder={kind === "message" ? "uuid чата" : "uuid проекта"}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label className={styles.wide}>
          Текст сообщения или задачи
          <textarea
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            aria-label="Текст сообщения или задачи"
          />
        </label>
      </div>
      <div className={styles.scheduleActions}>
        <button type="button" disabled={busy} onClick={() => void create()}>
          Запланировать
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => api("/tick", { method: "POST", body: "{}" }))}
        >
          Проверить время
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {items.length === 0 ? (
        <p className={styles.muted}>Записей пока нет.</p>
      ) : (
        <ul className={styles.scheduleList}>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.payload.title ?? item.payload.text.slice(0, 60)}</strong>
              <small>
                {KIND_LABEL[item.kind]} · {MODE_LABEL[item.mode]} ·{" "}
                {new Date(item.due_at).toLocaleString()} · {STATUS_LABEL[item.status]}
              </small>
              <div>
                {item.status === "ready" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api(`/${item.id}/dispatch`, { method: "POST", body: "{}" }))
                    }
                  >
                    Отправить / поставить задачу
                  </button>
                )}
                {(item.status === "scheduled" || item.status === "ready") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => api(`/${item.id}`, { method: "DELETE" }))}
                  >
                    Отменить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
