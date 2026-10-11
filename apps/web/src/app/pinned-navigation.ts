/** Browser-local quick access for the owner workspace. Store IDs only, never chat content. */
export const PINNED_NAVIGATION_KEY = "kosmora:pinned-navigation:v1";
const MAX_PINS_PER_KIND = 100;
const MAX_ID_LENGTH = 160;

export type PinnedNavigation = { chats: string[]; projects: string[] };
export const EMPTY_PINS: PinnedNavigation = { chats: [], projects: [] };

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH) ids.add(id);
    if (ids.size === MAX_PINS_PER_KIND) break;
  }
  return [...ids];
}

export function readPinnedNavigation(storage: Pick<Storage, "getItem">): PinnedNavigation {
  try {
    const raw = storage.getItem(PINNED_NAVIGATION_KEY);
    if (!raw || raw.length > 40_000) return { chats: [], projects: [] };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { chats: [], projects: [] };
    const parsed = value as { version?: unknown; chats?: unknown; projects?: unknown };
    if (parsed.version !== 1) return { chats: [], projects: [] };
    return { chats: cleanIds(parsed.chats), projects: cleanIds(parsed.projects) };
  } catch {
    return { chats: [], projects: [] };
  }
}

export function savePinnedNavigation(
  storage: Pick<Storage, "setItem">,
  pins: PinnedNavigation
): boolean {
  try {
    storage.setItem(
      PINNED_NAVIGATION_KEY,
      JSON.stringify({ version: 1, chats: cleanIds(pins.chats), projects: cleanIds(pins.projects) })
    );
    return true;
  } catch {
    return false;
  }
}

export function togglePin(
  pins: PinnedNavigation,
  kind: keyof PinnedNavigation,
  id: string
): PinnedNavigation {
  if (!id || id.length > MAX_ID_LENGTH) return pins;
  const current = pins[kind];
  const next = current.includes(id)
    ? current.filter((candidate) => candidate !== id)
    : [id, ...current].slice(0, MAX_PINS_PER_KIND);
  return { ...pins, [kind]: next };
}

/** Server order remains the tie breaker within pinned and unpinned groups. */
export function pinsFirst<T extends { id: string }>(items: T[], pinnedIds: string[]): T[] {
  const pinned = new Set(pinnedIds);
  return [
    ...items.filter((item) => pinned.has(item.id)),
    ...items.filter((item) => !pinned.has(item.id))
  ];
}
