import { isValidChatAttachments, type ChatAttachment } from "@cosmora/contracts/chat-attachments";

export const DRAFT_PREFIX = "cosmora:composer-draft:";
const MATERIAL_PREFIX = "cosmora:composer-materials:";
export const DRAFT_LIMITS = {
  entries: 20,
  characters: 4_000_000,
  text: 128_000,
  ageMs: 30 * 86400_000
};
type Storage = Pick<globalThis.Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const materialsKey = (key: string) => key.replace(DRAFT_PREFIX, MATERIAL_PREFIX);
const storageNotice =
  "Не удалось сохранить черновик полностью. Текст и файлы доступны в этой вкладке.";

export function readComposerDraft(storage: Storage, key: string) {
  let text = "";
  try {
    // Text has its own record, so damaged/unavailable material never hides it.
    text = storage.getItem(key) ?? "";
    const raw = storage.getItem(materialsKey(key));
    if (!raw) return { text, files: [] as ChatAttachment[], notice: null };
    if (raw.length > DRAFT_LIMITS.characters) throw new Error("Oversize record");
    const value = JSON.parse(raw) as { version?: unknown; savedAt?: unknown; files?: unknown };
    if (value.version !== 1 || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt))
      throw new Error("Invalid record");
    if (Date.now() - value.savedAt > DRAFT_LIMITS.ageMs) {
      clearComposerDraft(storage, key);
      return { text: "", files: [] as ChatAttachment[], notice: null };
    }
    if (!Array.isArray(value.files) || !isValidChatAttachments(value.files as ChatAttachment[]))
      throw new Error("Invalid materials");
    return { text, files: value.files as ChatAttachment[], notice: null };
  } catch {
    return {
      text,
      files: [] as ChatAttachment[],
      notice: "Не удалось восстановить вложения черновика. Доступный текст сохранён."
    };
  }
}

export function clearComposerDraft(storage: Storage, key: string): void {
  storage.removeItem(key);
  storage.removeItem(materialsKey(key));
}

export function saveComposerDraft(
  storage: Storage,
  key: string,
  text: string,
  files: ChatAttachment[]
): string | null {
  try {
    if (!text && !files.length) {
      clearComposerDraft(storage, key);
      return null;
    }
    if (text.length > DRAFT_LIMITS.text) return storageNotice;
    const record = JSON.stringify({ version: 1, savedAt: Date.now(), files });
    const size = key.length + materialsKey(key).length + text.length + record.length;
    if (size > DRAFT_LIMITS.characters) return storageNotice;
    const entries: { key: string; size: number; savedAt: number }[] = [];
    // Only this module's keys are eligible for eviction. Legacy text drafts are included.
    for (let i = 0; i < storage.length; i++) {
      const candidate = storage.key(i);
      if (!candidate?.startsWith(DRAFT_PREFIX) || candidate === key) continue;
      const material = storage.getItem(materialsKey(candidate)) ?? "";
      let savedAt = 0;
      try {
        savedAt = (JSON.parse(material) as { savedAt?: number }).savedAt ?? 0;
      } catch {
        /* Legacy draft. */
      }
      entries.push({
        key: candidate,
        savedAt,
        size:
          candidate.length +
          materialsKey(candidate).length +
          (storage.getItem(candidate)?.length ?? 0) +
          material.length
      });
    }
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let total = entries.reduce((sum, item) => sum + item.size, size);
    let count = entries.length + 1;
    for (const entry of entries) {
      if (
        count <= DRAFT_LIMITS.entries &&
        total <= DRAFT_LIMITS.characters &&
        (entry.savedAt === 0 || Date.now() - entry.savedAt <= DRAFT_LIMITS.ageMs)
      )
        continue;
      clearComposerDraft(storage, entry.key);
      total -= entry.size;
      count--;
    }
    // Save text before the larger image record. Quota failure still preserves text.
    storage.setItem(key, text);
    try {
      storage.setItem(materialsKey(key), record);
    } catch {
      storage.removeItem(materialsKey(key));
      return storageNotice;
    }
    return null;
  } catch {
    return storageNotice;
  }
}
