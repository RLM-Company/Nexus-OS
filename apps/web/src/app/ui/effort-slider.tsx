"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./effort-slider.module.css";

export type ReasoningEffort = "low" | "medium" | "high";
const names = { low: "Низкие", medium: "Средние", high: "Высокие" };
export function EffortSlider({
  value,
  supported,
  disabled,
  onCommit
}: {
  value: ReasoningEffort | null;
  supported: ReasoningEffort[];
  disabled: boolean;
  onCommit: (value: ReasoningEffort | null) => void;
}) {
  const levels = [
    null,
    ...(["low", "medium", "high"] as const).filter((effort) => supported.includes(effort))
  ];
  const [preview, setPreview] = useState(value);
  const pending = useRef(value);
  const committing = useRef(false);
  useEffect(() => {
    if (!disabled) {
      pending.current = value;
      setPreview(value);
      committing.current = false;
    }
  }, [value, disabled]);
  const index = Math.max(0, levels.indexOf(preview));
  const commit = () => {
    if (disabled || committing.current || pending.current === value) return;
    committing.current = true;
    onCommit(pending.current);
  };
  return (
    <div className={styles.slider}>
      <div className={styles.heading}>
        <span>Усилия</span>
        <output>{preview ? names[preview] : "Авто"}</output>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(1, levels.length - 1)}
        step={1}
        value={index}
        aria-label="Уровень усилий"
        aria-valuetext={preview ? names[preview] : "Авто"}
        disabled={disabled || levels.length < 2}
        style={
          { "--effort-fill": `${(index / Math.max(1, levels.length - 1)) * 100}%` } as CSSProperties
        }
        onChange={(event) => {
          const effort = levels[Number(event.target.value)] ?? null;
          pending.current = effort;
          setPreview(effort);
        }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerUp={commit}
        onBlur={commit}
        onPointerCancel={() => {
          pending.current = value;
          setPreview(value);
        }}
        onKeyUp={(event) => {
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(
              event.key
            )
          )
            commit();
        }}
      />
      <div className={styles.ticks} aria-hidden="true">
        {levels.map((effort) => (
          <span key={effort ?? "auto"} data-active={effort === preview || undefined}>
            {effort ? names[effort] : "Авто"}
          </span>
        ))}
      </div>
    </div>
  );
}
