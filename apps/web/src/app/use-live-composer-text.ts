"use client";
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

// One current value, mirrored synchronously for pagehide and delayed IPC callbacks.
// React's committed value alone can lag a user action that closes the document.
export function useLiveComposerText() {
  const [text, renderText] = useState("");
  const latest = useRef({ text: "", revision: 0 });
  const setText = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    const next = typeof value === "function" ? value(latest.current.text) : value;
    latest.current = { text: next, revision: latest.current.revision + 1 };
    renderText(next);
  }, []);
  return [text, setText, latest] as const;
}
