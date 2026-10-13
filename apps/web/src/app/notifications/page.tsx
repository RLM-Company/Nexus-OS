"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { isQuietTime, type NotificationPreferences } from "./quiet-hours";
import styles from "./notifications.module.css";

type Item = {
  id: string;
  source: "work" | "research";
  source_id: string;
  kind: string;
  title: string;
  href: string;
  occurred_at: string;
  read: boolean;
};
type Feed = { items: Item[]; unread: number };
const base = "/api/v1/notifications";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...options });
  if (!response.ok)
    throw Error(
      response.status === 401
        ? "Войдите в Kosmora повторно."
        : response.status === 423
          ? "Данные аккаунта временно закрыты для изменений."
          : "Не удалось обновить уведомления."
    );
  return (await response.json()) as T;
}
const body = (value: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value)
});
const defaults: NotificationPreferences = {
  in_app_enabled: true,
  browser_enabled: false,
  quiet_from: null,
  quiet_until: null,
  time_zone: "Europe/Moscow"
};

export default function NotificationsPage() {
  const [feed, setFeed] = useState<Feed>({ items: [], unread: 0 });
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [quiet, setQuiet] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const refresh = useCallback(async () => {
    const next = await api<Feed>(base);
    const old = seen.current;
    if (
      old &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      prefsRef.current.browser_enabled &&
      prefsRef.current.in_app_enabled &&
      !isQuietTime(prefsRef.current, new Date())
    ) {
      for (const item of next.items.filter((item) => !item.read && !old.has(item.id)).slice(0, 3))
        new Notification("Kosmora", { body: item.title, tag: item.id });
    }
    seen.current = new Set(next.items.map((item) => item.id));
    setFeed(next);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api<Feed>(base), api<NotificationPreferences>(`${base}/preferences`)])
      .then(([next, options]) => {
        if (!active) return;
        seen.current = new Set(next.items.map((item) => item.id));
        setFeed(next);
        setPrefs(options);
        setQuiet(Boolean(options.quiet_from));
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const mark = async (ids: string[]) => {
    if (!ids.length) return;
    setError("");
    try {
      await api<{ marked: number }>(`${base}/read`, { method: "POST", ...body({ ids }) });
      setFeed((current) => ({
        items: current.items.map((item) =>
          ids.includes(item.id) ? { ...item, read: true } : item
        ),
        unread: current.items.filter((item) => !item.read && !ids.includes(item.id)).length
      }));
    } catch (cause) {
      setError(String(cause));
      throw cause;
    }
  };
  const open = async (item: Item) => {
    try {
      if (!item.read) await mark([item.id]);
      window.location.assign(item.href);
    } catch {
      /* The event remains visible for retry. */
    }
  };
  const enableBrowser = async () => {
    if (!("Notification" in window)) {
      setError("Этот браузер не поддерживает уведомления.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setError("Браузер не разрешил уведомления. Измените разрешение в его настройках.");
      return;
    }
    setPrefs((current) => ({ ...current, browser_enabled: true }));
    setMessage("Разрешение получено. Сохраните настройки.");
  };
  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const value = {
        ...prefs,
        quiet_from: quiet ? (prefs.quiet_from ?? "22:00") : null,
        quiet_until: quiet ? (prefs.quiet_until ?? "08:00") : null,
        browser_enabled:
          prefs.browser_enabled && "Notification" in window && Notification.permission === "granted"
      };
      const saved = await api<NotificationPreferences>(`${base}/preferences`, {
        method: "PUT",
        ...body(value)
      });
      setPrefs(saved);
      setMessage("Настройки сохранены.");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div>
          <Link href="/">← Kosmora</Link>
          <small>АККАУНТ / СОБЫТИЯ</small>
          <h1>Уведомления</h1>
          <p>Важные состояния задач Work и исследований в одном месте.</p>
        </div>
        <span className={styles.counter}>{feed.unread} непрочитано</span>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
      <div className={styles.grid}>
        <section className={styles.feed} aria-label="Лента событий">
          <div className={styles.sectionHead}>
            <h2>Лента</h2>
            <button
              type="button"
              onClick={() =>
                void mark(feed.items.filter((item) => !item.read).map((item) => item.id)).catch(
                  () => undefined
                )
              }
              disabled={!feed.unread}
            >
              Отметить всё прочитанным
            </button>
          </div>
          {loading ? (
            <p className={styles.empty}>Загружаем…</p>
          ) : !prefs.in_app_enabled ? (
            <p className={styles.empty}>Лента отключена в настройках.</p>
          ) : feed.items.length === 0 ? (
            <p className={styles.empty}>
              Пока нет событий. Здесь появятся результаты Work и исследований.
            </p>
          ) : (
            <ol>
              {feed.items.map((item) => (
                <li key={item.id} className={item.read ? styles.read : styles.unread}>
                  <button type="button" onClick={() => void open(item)}>
                    <span className={styles.dot} aria-hidden="true" />
                    <span className={styles.itemText}>
                      <small>{item.source === "work" ? "WORK" : "ИССЛЕДОВАНИЕ"}</small>
                      <strong>{item.title}</strong>
                      <time dateTime={item.occurred_at}>
                        {new Date(item.occurred_at).toLocaleString("ru-RU")}
                      </time>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className={styles.settings} aria-label="Настройки уведомлений">
          <h2>Настройки</h2>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={prefs.in_app_enabled}
              onChange={(event) => setPrefs({ ...prefs, in_app_enabled: event.target.checked })}
            />
            Показывать события в ленте
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={prefs.browser_enabled}
              onChange={(event) => {
                if (event.target.checked) void enableBrowser();
                else setPrefs({ ...prefs, browser_enabled: false });
              }}
            />
            Уведомлять через браузер
          </label>
          <p>
            Для сообщений браузера требуется разрешение. Они появляются только пока Kosmora открыта;
            при первом открытии старая лента не всплывает.
          </p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={quiet}
              onChange={(event) => setQuiet(event.target.checked)}
            />
            Тихие часы
          </label>
          {quiet && (
            <div className={styles.times}>
              <label>
                С{" "}
                <input
                  type="time"
                  value={prefs.quiet_from ?? "22:00"}
                  onChange={(event) => setPrefs({ ...prefs, quiet_from: event.target.value })}
                />
              </label>
              <label>
                До{" "}
                <input
                  type="time"
                  value={prefs.quiet_until ?? "08:00"}
                  onChange={(event) => setPrefs({ ...prefs, quiet_until: event.target.value })}
                />
              </label>
            </div>
          )}
          <label className={styles.zone}>
            Часовой пояс
            <input
              list="notification-zones"
              value={prefs.time_zone}
              onChange={(event) => setPrefs({ ...prefs, time_zone: event.target.value })}
            />
          </label>
          <datalist id="notification-zones">
            <option value="Europe/Moscow" />
            <option value="Europe/Berlin" />
            <option value="UTC" />
          </datalist>
          <button
            type="button"
            className={styles.save}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Сохраняем…" : "Сохранить настройки"}
          </button>
        </section>
      </div>
    </main>
  );
}
