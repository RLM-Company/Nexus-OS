"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./personal-settings.module.css";
import { UsageMetrics, UsageActivity } from "./usage-analytics";
import PrivacyPanel from "./privacy-panel";
import { Switch, SystemMessage } from "../ui/kosmora-controls";
import { ModelPicker } from "../ui/model-picker";
import { InterfaceSettings } from "./interface-settings";
import { LocalVaultSettings } from "./local-vault-settings";

type Preferences = {
  version: number;
  relay_enabled: boolean;
  response_language: "ru" | "en";
  optimize_for: "balanced" | "cost" | "quality" | "latency";
  preferred_provider: string | null;
  preferred_model: string | null;
  chat_style: "standard" | "concise" | "detailed";
  max_total_tokens: number | null;
};
type Route = { provider: string; model: string; capabilities: Record<string, boolean> };
type Usage = {
  summary: {
    model_tokens_or_upper_bound: number;
    translation_tokens_or_upper_bound: number;
    in_flight_or_uncertain_holds: number;
    total_counted_tokens: number;
    max_total_tokens: number | null;
    currency_cost: string;
  };
  rows: Array<{
    kind: string;
    stage?: string | null;
    chat_id: string | null;
    run_id: string;
    provider_id: string;
    model_id: string;
    status: string;
    input_tokens: number | null;
    output_tokens: number | null;
    reserved_tokens: number;
    created_at: string;
  }>;
};
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/personal-settings${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "content-type": "application/json", ...options?.headers }
  });
  if (!res.ok) throw new Error(`Ошибка HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
export default function PersonalSettings() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const [data, meter] = await Promise.all([
      api<{ settings: Preferences; available_models: Route[] }>(""),
      api<Usage>("/usage")
    ]);
    setPrefs(data.settings);
    setUsage(meter);
  }, []);
  useEffect(() => {
    void reload().catch(() => setNotice("Сервер персональных настроек недоступен."));
  }, [reload]);
  const save = async (next: Preferences) => {
    setBusy(true);
    setNotice("");
    try {
      const r = await api<{ settings: Preferences }>("", {
        method: "PUT",
        body: JSON.stringify({
          expected_version: next.version,
          relay_enabled: next.relay_enabled,
          response_language: next.response_language,
          optimize_for: next.optimize_for,
          preferred_provider: next.preferred_provider,
          preferred_model: next.preferred_model,
          chat_style: next.chat_style,
          max_total_tokens: next.max_total_tokens
        })
      });
      setPrefs(r.settings);
      await reload();
      setNotice("Настройки сохранены на сервере.");
    } catch {
      setNotice("Не удалось сохранить: обновите страницу и повторите.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={`${styles.page} product-shell`}>
      <nav>
        <Link href="/">← Вернуться в Kosmora</Link>
      </nav>
      <h1>Настройки</h1>
      <p className={styles.muted}>Всё для удобной работы с Kosmora.</p>
      <nav className={styles.sectionsNav} aria-label="Разделы настроек">
        <a href="#model-settings">Модель и чат</a>
        <a href="#interface-settings">Интерфейс и голос</a>
        <a href="#relay-settings">English Relay</a>
        <a href="#account-usage">Использование</a>
        <a href="#account-data">Данные</a>
      </nav>
      {!prefs ? (
        <p>Загрузка настроек…</p>
      ) : (
        <>
          <section id="model-settings">
            <h2>Модель и чат</h2>
            <ModelPicker />
            <label>
              Язык ответа с ретранслятором
              <select
                disabled={busy}
                value={prefs.response_language}
                onChange={(e) =>
                  void save({
                    ...prefs,
                    response_language: e.target.value as Preferences["response_language"]
                  })
                }
              >
                <option value="ru">Русский</option>
                <option value="en">Английский</option>
              </select>
            </label>
            <label>
              Приоритет модели
              <select
                disabled={busy}
                value={prefs.optimize_for}
                onChange={(e) =>
                  void save({
                    ...prefs,
                    optimize_for: e.target.value as Preferences["optimize_for"]
                  })
                }
              >
                <option value="balanced">Сбалансированно</option>
                <option value="cost">Меньше расход</option>
                <option value="latency">Быстрее</option>
                <option value="quality">Качество</option>
              </select>
            </label>
            <label>
              Стиль ответа
              <select
                disabled={busy}
                value={prefs.chat_style}
                onChange={(e) =>
                  void save({ ...prefs, chat_style: e.target.value as Preferences["chat_style"] })
                }
              >
                <option value="standard">Обычный</option>
                <option value="concise">Краткий</option>
                <option value="detailed">Подробный</option>
              </select>
            </label>
            <p className={styles.muted}>
              Доступны только проверенные и реально подключённые модели. Невозможные функции не
              предлагаются.
            </p>
          </section>
          <section id="relay-settings">
            <h2>English Relay</h2>
            <Switch
              disabled={busy}
              checked={prefs.relay_enabled}
              onChange={(value) => void save({ ...prefs, relay_enabled: value })}
            >
              Переводить запрос на английский и ответ обратно
            </Switch>
            <p className={styles.muted}>
              По умолчанию выключено. Это дополнительные запросы к модели с дополнительными
              токенами. Уменьшение расхода не гарантировано. Код, URL и идентификаторы защищаются;
              для потенциально секретного или неподдерживаемого текста перевод блокируется. Если
              перевод недоступен, обычная отправка не произойдёт автоматически.
            </p>
          </section>
          <section id="account-usage">
            <h2>Использование и квота</h2>
            <UsageMetrics summary={usage?.summary} />
            <Switch
              disabled={busy}
              checked={prefs.max_total_tokens !== null}
              onChange={(enabled) =>
                void save({ ...prefs, max_total_tokens: enabled ? 200000 : null })
              }
            >
              Персональное ограничение расхода токенов
            </Switch>
            <p className={styles.muted}>
              Неизвестные расходы могут учитываться верхней границей. Денежная стоимость не
              вычисляется без подтверждённых цен. Персональный лимит принудительно действует для
              обычного чата и его переводов; у проектов есть отдельные существующие лимиты.
            </p>
            <label>
              Лимит токенов для аккаунта (пусто — без персонального ограничения)
              <input
                type="number"
                min="1"
                max="2000000000"
                key={prefs.version}
                defaultValue={prefs.max_total_tokens ?? ""}
                id="account-token-limit"
              />
            </label>
            <button
              disabled={busy}
              onClick={() => {
                const field = document.getElementById("account-token-limit") as HTMLInputElement;
                const limit = field.value ? Number(field.value) : null;
                void save({ ...prefs, max_total_tokens: limit });
              }}
            >
              Сохранить лимит
            </button>
            <h3>Последние попытки</h3>
            <UsageActivity rows={usage?.rows ?? []} />
          </section>
          <InterfaceSettings />
          <LocalVaultSettings />
          <div id="account-data">
            <PrivacyPanel />
          </div>
        </>
      )}
      {notice && (
        <SystemMessage kind={notice === "Настройки сохранены на сервере." ? "success" : "error"}>
          {notice}
        </SystemMessage>
      )}
    </main>
  );
}
