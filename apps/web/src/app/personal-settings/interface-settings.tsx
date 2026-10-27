"use client";
import { useEffect, useState } from "react";
import { Switch } from "../ui/kosmora-controls";
import styles from "./personal-settings.module.css";
export function InterfaceSettings() {
  const [prefs, setPrefs] = useState({ compact: false, largeText: false });
  const [notice, setNotice] = useState("");
  const [rate, setRate] = useState(1);
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem("cosmora:ui-preferences") ?? "{}") as Record<
        string,
        unknown
      >;
      setPrefs({ compact: value.compact === true, largeText: value.largeText === true });
      const saved = Number(localStorage.getItem("kosmora:voice-rate.v1") ?? 1);
      if (Number.isFinite(saved) && saved >= 0.75 && saved <= 1.5) setRate(saved);
    } catch {
      /* The default voice rate works without local storage. */
    }
  }, []);
  function save(next: typeof prefs) {
    setPrefs(next);
    try {
      localStorage.setItem("cosmora:ui-preferences", JSON.stringify(next));
      setNotice("Внешний вид сохранён для этого устройства.");
    } catch {
      setNotice("Браузер не разрешил сохранение настройки.");
    }
  }
  return (
    <section id="interface-settings">
      <h2>Интерфейс и голос</h2>
      <div className={styles.interfaceOptions}>
        <Switch checked={prefs.compact} onChange={(value) => save({ ...prefs, compact: value })}>
          Компактная навигация
        </Switch>
        <Switch
          checked={prefs.largeText}
          onChange={(value) => save({ ...prefs, largeText: value })}
        >
          Увеличенный текст
        </Switch>
        <label>
          Скорость озвучивания <output>{rate.toFixed(2)}×</output>
          <input
            type="range"
            min="0.75"
            max="1.5"
            step="0.05"
            value={rate}
            aria-label="Скорость озвучивания"
            onChange={(event) => {
              const value = Number(event.target.value);
              setRate(value);
              try {
                localStorage.setItem("kosmora:voice-rate.v1", String(value));
              } catch {
                setNotice("Не удалось сохранить скорость озвучивания.");
              }
            }}
          />
        </label>
      </div>
      <p>
        Голос запускается значком под ответом. Размер боковой панели и её сворачивание запоминаются
        на этом устройстве.
      </p>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
