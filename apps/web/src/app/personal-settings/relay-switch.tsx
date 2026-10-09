"use client";
import { useEffect, useState } from "react";
type AccountPreferences = {
  version: number;
  relay_enabled: boolean;
  response_language: "ru" | "en";
  optimize_for: "balanced" | "quality" | "latency" | "cost";
  preferred_provider: string | null;
  preferred_model: string | null;
  chat_style: "standard" | "concise" | "detailed";
  max_total_tokens: number | null;
};
type RelayResponse = { relay_enabled?: boolean; settings?: AccountPreferences };
/** Small standalone composer control; switching is persisted on the authenticated server. */
export function RelaySwitch({
  chatId,
  error,
  onRecover
}: {
  chatId: string | null;
  error: string | null;
  onRecover?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    setReady(false);
    setMessage("");
    const path = chatId
      ? `/api/v1/personal-settings/chats/${encodeURIComponent(chatId)}`
      : "/api/v1/personal-settings";
    fetch(path, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error("unavailable");
        return r.json() as Promise<RelayResponse>;
      })
      .then((data) => {
        if (live) {
          setEnabled(Boolean(chatId ? data.relay_enabled : data.settings?.relay_enabled));
          setReady(true);
        }
      })
      .catch(() => {
        if (live) {
          setReady(false);
          setMessage("Настройки перевода недоступны");
        }
      });
    return () => {
      live = false;
    };
  }, [chatId]);
  async function setRelay(value: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const path = chatId
        ? `/api/v1/personal-settings/chats/${encodeURIComponent(chatId)}`
        : "/api/v1/personal-settings";
      const payload = chatId
        ? { relay_enabled: value }
        : await fetch(path, { cache: "no-store" })
            .then((r) => {
              if (!r.ok) throw new Error("unavailable");
              return r.json() as Promise<{ settings: AccountPreferences }>;
            })
            .then((data) => ({
              expected_version: data.settings.version,
              relay_enabled: value,
              response_language: data.settings.response_language,
              optimize_for: data.settings.optimize_for,
              preferred_provider: data.settings.preferred_provider,
              preferred_model: data.settings.preferred_model,
              chat_style: data.settings.chat_style,
              max_total_tokens: data.settings.max_total_tokens
            }));
      const res = await fetch(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw Error("unavailable");
      setEnabled(value);
    } catch {
      setMessage("Переключение не сохранено");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 12,
        color: "#555"
      }}
    >
      <label title="Дополнительные запросы перевода расходуют токены">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!ready || busy}
          onChange={(e) => void setRelay(e.target.checked)}
        />{" "}
        English Relay {enabled ? "включён" : "выключен"}
      </label>
      <a href="/personal-settings">Настройки</a>
      {error?.includes("Перевод") && (
        <>
          <button type="button" onClick={onRecover}>
            Восстановить запрос и повторить с Relay
          </button>
          {enabled && (
            <button type="button" onClick={() => void setRelay(false)}>
              Выключить Relay и отправить исходный запрос вручную
            </button>
          )}
        </>
      )}
      {message && <span role="alert">{message}</span>}
    </div>
  );
}
