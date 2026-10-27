export type NavigationState = {
  folders: Array<{ id: string; title: string }>;
  assignments: Array<{ chat_id: string; folder_id: string }>;
  chats: string[];
  projects: string[];
};

/** Refuse a malformed successful response before it can replace usable navigation. */
export function readNavigationState(value: unknown): NavigationState {
  const record = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item);
  const id = (item: unknown): item is string => typeof item === "string" && item.length > 0;
  if (
    !record(value) ||
    !Array.isArray(value.folders) ||
    !value.folders.every((item) => record(item) && id(item.id) && typeof item.title === "string") ||
    !Array.isArray(value.assignments) ||
    !value.assignments.every((item) => record(item) && id(item.chat_id) && id(item.folder_id)) ||
    !Array.isArray(value.chats) ||
    !value.chats.every(id) ||
    !Array.isArray(value.projects) ||
    !value.projects.every(id)
  )
    throw new Error("Не удалось прочитать папки и закрепления с сервера.");
  return value as NavigationState;
}
