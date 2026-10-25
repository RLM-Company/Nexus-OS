import { api, endpoint, json } from "./client";
import { contentKey } from "./editor-history";
import type { Deck } from "./model";
export function matchesSavedDraft(draft: Deck, stored: Deck): boolean {
  return (
    stored.id === draft.id &&
    stored.version === draft.version + 1 &&
    contentKey(stored) === contentKey({ ...draft, title: draft.title.trim() })
  );
}
/** One write only. A failed response is reconciled by an owner-scoped read, never by retrying PUT. */
export async function savePresentation(draft: Deck, request: typeof api = api): Promise<Deck> {
  const url = `${endpoint}/${draft.id}`;
  try {
    return await request<Deck>(url, {
      method: "PUT",
      ...json({
        version: draft.version,
        title: draft.title,
        theme: draft.theme,
        slides: draft.slides
      })
    });
  } catch (cause) {
    try {
      const stored = await request<Deck>(url);
      if (matchesSavedDraft(draft, stored)) return stored;
    } catch {
      /* Preserve the original failure and local draft when readback also fails. */
    }
    throw cause;
  }
}
