"use client";
import { useEffect, useRef, useState } from "react";
const MIN = 190,
  MAX = 420,
  DEFAULT = 244,
  KEY = "kosmora.sidebar.width.v1";
const bound = (width: number) =>
  Math.round(
    Math.min(
      Math.max(MIN, width),
      window.innerWidth <= 860 ? MAX : Math.min(MAX, Math.max(MIN, window.innerWidth - 520))
    )
  );
export function useSidebarWidth() {
  const [width, setWidth] = useState(DEFAULT);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (Number.isFinite(saved) && saved >= MIN) setWidth(bound(saved));
    } catch {
      /* Local preference is optional. */
    }
    setReady(true);
    const resized = () => {
      if (window.innerWidth > 860) setWidth((current) => bound(current));
    };
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(KEY, String(width));
      } catch {
        /* Resizing still works for this visit. */
      }
  }, [width, ready]);
  return { width, setWidth: (value: number) => setWidth(bound(value)) };
}
export function SidebarResize({
  width,
  onChange
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label="Ширина боковой панели"
      aria-orientation="vertical"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      aria-valuetext={`${width} пикселей`}
      tabIndex={0}
      title="Перетащите для изменения ширины. Двойное нажатие — стандартный размер."
      onDoubleClick={() => onChange(DEFAULT)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.setAttribute("data-resizing", "true");
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(start.current.width + e.clientX - start.current.x);
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.removeAttribute("data-resizing");
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        start.current = null;
        e.currentTarget.removeAttribute("data-resizing");
      }}
      onPointerCancel={(e) => {
        start.current = null;
        e.currentTarget.removeAttribute("data-resizing");
      }}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        onChange(
          e.key === "Home"
            ? MIN
            : e.key === "End"
              ? MAX
              : width + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 32 : 8)
        );
      }}
    />
  );
}
