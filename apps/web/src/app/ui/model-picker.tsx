"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import { EffortSlider } from "./effort-slider";
import slider from "./effort-slider.module.css";
import styles from "./kosmora-controls.module.css";

export type ExecutionPreferences = {
  version: number;
  model_profile: "mercurius" | "mars" | "jupiter" | "saturnus";
  autonomy: number;
  turbo: boolean;
};
type Profile = { id: ExecutionPreferences["model_profile"]; name: string; description: string };
type SettingsData = {
  execution?: ExecutionPreferences;
  profiles?: Profile[];
  reasoning?: {
    effort: "low" | "medium" | "high" | null;
    supported_efforts: ("low" | "medium" | "high")[];
  };
};
export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const [data, setData] = useState<SettingsData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [autonomyPreview, setAutonomyPreview] = useState(2);
  const pendingAutonomy = useRef(2),
    locked = useRef(false),
    menu = useRef<HTMLDetailsElement>(null);
  const life = useRef<AbortController | null>(null);
  async function load(signal?: AbortSignal): Promise<SettingsData> {
    const response = await fetch("/api/v1/personal-settings", {
      cache: "no-store",
      ...(signal ? { signal } : {})
    });
    if (!response.ok) throw Error("Настройки недоступны.");
    return response.json() as Promise<SettingsData>;
  }
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const refresh = () => {
      if (!locked.current)
        void load(controller.signal)
          .then((value) => {
            if (!controller.signal.aborted) setData(value);
          })
          .catch(() => {});
    };
    refresh();
    const close = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (!busy) {
      pendingAutonomy.current = data?.execution?.autonomy ?? 2;
      setAutonomyPreview(pendingAutonomy.current);
    }
  }, [data?.execution?.autonomy, busy]);
  async function update(change: Partial<Omit<ExecutionPreferences, "version">>) {
    if (locked.current || disabled || !data?.execution) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const signal = life.current?.signal;
    try {
      const latest = await load(signal);
      if (!latest.execution) throw Error();
      const response = await fetch("/api/v1/personal-settings/execution", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        ...(signal ? { signal } : {}),
        body: JSON.stringify({
          expected_version: latest.execution.version,
          model_profile: latest.execution.model_profile,
          autonomy: latest.execution.autonomy,
          turbo: latest.execution.turbo,
          ...change
        })
      });
      if (!response.ok) throw Error();
      const result = (await response.json()) as { execution: ExecutionPreferences };
      if (!signal?.aborted) {
        setData({ ...latest, execution: result.execution });
        window.dispatchEvent(
          new CustomEvent("kosmora:execution-settings", { detail: result.execution })
        );
      }
    } catch {
      if (!signal?.aborted) setError("Не удалось сохранить. Повторите выбор.");
    } finally {
      locked.current = false;
      if (!signal?.aborted) setBusy(false);
    }
  }
  async function effort(value: "low" | "medium" | "high" | null) {
    if (disabled || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/personal-settings/reasoning", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effort: value }),
        signal: life.current!.signal
      });
      if (!response.ok) throw Error();
      const reasoning = (await response.json()) as NonNullable<SettingsData["reasoning"]>;
      if (!life.current?.signal.aborted) setData((current) => ({ ...current, reasoning }));
    } catch {
      if (!life.current?.signal.aborted) setError("Усилия не изменены. Повторите выбор.");
    } finally {
      locked.current = false;
      if (!life.current?.signal.aborted) setBusy(false);
    }
  }
  const unavailable = disabled || busy || !data?.execution;
  const active = data?.profiles?.find((profile) => profile.id === data.execution?.model_profile);
  return (
    <span className="model-controls">
      <details className={styles.modelPicker} ref={menu} data-model-picker>
        <summary
          aria-label="Выбор модели"
          aria-disabled={disabled || busy}
          onClick={(event) => {
            if (disabled || busy) event.preventDefault();
          }}
        >
          <span>{active?.name ?? "Kosmora Mars"}</span>
          <WorkspaceIcon name="arrow" />
        </summary>
        <div className={styles.modelMenu}>
          <strong>Модель</strong>
          {data?.profiles?.map((profile) => (
            <button
              type="button"
              key={profile.id}
              disabled={unavailable}
              aria-pressed={active?.id === profile.id}
              onClick={() => void update({ model_profile: profile.id })}
            >
              <span>
                {profile.name}
                <small>{profile.description}</small>
              </span>
              {active?.id === profile.id && <WorkspaceIcon name="check" />}
            </button>
          ))}
          <section className={styles.effortSection} aria-label="Усилия модели">
            <EffortSlider
              value={data?.execution?.turbo ? "low" : (data?.reasoning?.effort ?? null)}
              supported={data?.reasoning?.supported_efforts ?? []}
              disabled={unavailable || !data?.reasoning || data?.execution?.turbo === true}
              onCommit={(value) => void effort(value)}
            />
          </section>
          <section className={styles.effortSection} aria-label="Автономность ответа">
            <div className={slider.slider}>
              <div className={slider.heading}>
                <span>Автономность</span>
                <output>{autonomyPreview}/6</output>
              </div>
              <input
                type="range"
                aria-label="Уровень автономности"
                aria-valuetext={`${autonomyPreview} из 6`}
                min={0}
                max={6}
                step={1}
                value={autonomyPreview}
                disabled={unavailable}
                style={{ "--effort-fill": `${(autonomyPreview / 6) * 100}%` } as CSSProperties}
                onChange={(event) => {
                  pendingAutonomy.current = Number(event.target.value);
                  setAutonomyPreview(pendingAutonomy.current);
                }}
                onPointerUp={() => {
                  if (pendingAutonomy.current !== data?.execution?.autonomy)
                    void update({ autonomy: pendingAutonomy.current });
                }}
                onKeyUp={() => {
                  if (pendingAutonomy.current !== data?.execution?.autonomy)
                    void update({ autonomy: pendingAutonomy.current });
                }}
                onBlur={() => {
                  if (pendingAutonomy.current !== data?.execution?.autonomy)
                    void update({ autonomy: pendingAutonomy.current });
                }}
              />
              <div className={slider.ticks}>
                <span>По запросу</span>
                <span>Самостоятельно</span>
              </div>
            </div>
            <small>
              От уточнений до самостоятельного результата. Доступ к действиям сохраняет настройки
              проекта.
            </small>
          </section>
          <small>Профили Kosmora сейчас работают на одном ядре.</small>
          {error && <p role="alert">{error}</p>}
          <a href="/personal-settings">Все настройки</a>
        </div>
      </details>
      <button
        type="button"
        className="turbo-toggle"
        aria-label="Мегабыстрый режим"
        aria-pressed={data?.execution?.turbo ?? false}
        title="Мегабыстрый режим — прямой поток и минимум предварительных размышлений"
        disabled={unavailable}
        onClick={() => void update({ turbo: !data?.execution?.turbo })}
      >
        <WorkspaceIcon name="bolt" />
      </button>
    </span>
  );
}
