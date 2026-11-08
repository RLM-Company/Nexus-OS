"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ChatAttachment } from "@cosmora/contracts/chat-attachments";
import { saveComposerDraft } from "./composer-draft-storage";

type Snapshot = { key: string; text: string; revision: number; files: ChatAttachment[] };
export function useBrowserComposerDraft(
  snapshot: () => Snapshot | null,
  notice: (value: string | null) => void
) {
  const current = useRef({ snapshot, notice });
  current.current = { snapshot, notice };
  const written = useRef<Snapshot | null>(null);
  const save = useCallback(() => {
    const next = current.current.snapshot();
    if (!next) return;
    // An idle tab must not overwrite another tab's newer persisted draft on close.
    if (
      written.current?.key === next.key &&
      written.current.revision === next.revision &&
      written.current.text === next.text &&
      written.current.files === next.files
    )
      return;
    try {
      const message = saveComposerDraft(window.localStorage, next.key, next.text, next.files);
      current.current.notice(message);
      if (!message) written.current = next;
    } catch {
      current.current.notice("Сохранение черновика в этом браузере недоступно.");
    }
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [save]);
  return save;
}
