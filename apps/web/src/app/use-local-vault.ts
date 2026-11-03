"use client";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
type Bridge = {
  open: () => Promise<{ ok: boolean }>;
  readContext: () => Promise<{ id: string; text: string } | null>;
  ackContext: (id: string) => Promise<void>;
  onContext: (listener: () => void) => () => void;
};
export const localVaultBridge = () =>
  (window as Window & { kosmoraDesktopVault?: Bridge }).kosmoraDesktopVault;
export function useLocalVaultContext(
  ready: boolean,
  draft: string,
  setDraft: Dispatch<SetStateAction<string>>
) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const bridge = localVaultBridge();
    if (!ready || !bridge) return;
    let cancelled = false;
    const read = async () => {
      try {
        const item = await bridge.readContext();
        if (
          cancelled ||
          !item ||
          typeof item.id !== "string" ||
          typeof item.text !== "string" ||
          item.text.length > 20000 ||
          draft.length + item.text.length + 2 > 120000 ||
          seen.current.has(item.id)
        )
          return;
        seen.current.add(item.id);
        setDraft((current) => current + (current ? "\n\n" : "") + item.text);
        await bridge.ackContext(item.id);
      } catch {
        /* Keep the user's existing draft on a lost native session. */
      }
    };
    const unsubscribe = bridge.onContext(() => void read());
    void read();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [ready, draft, setDraft]);
}
