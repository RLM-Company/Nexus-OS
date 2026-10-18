import { asDraft, normalizeDraft, type Draft } from "./skill-model";

export type PendingCreation = { requestId: string; draft: Draft };
export const pendingCreationKey = (scope: string): string => {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw Error("Не удалось проверить аккаунт.");
  return `kosmora:skills:creation:v1:${scope}`;
};
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readPendingCreation(
  storage: PendingStorage,
  scope: string
): PendingCreation | null {
  const raw = storage.getItem(pendingCreationKey(scope));
  if (raw === null) return null;
  try {
    if (raw.length > 125_000) throw Error();
    const value = JSON.parse(raw) as Partial<PendingCreation>;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.requestId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.requestId) ||
      !value.draft
    )
      throw Error();
    return { requestId: value.requestId, draft: normalizeDraft(value.draft) };
  } catch {
    throw Error("Не удалось прочитать незавершённую попытку. Проверьте список перед её сбросом.");
  }
}
/** Persist before dispatch; blocked storage must never degrade into an untracked POST. */
export function savePendingCreation(
  storage: PendingStorage,
  scope: string,
  value: PendingCreation
): void {
  const key = pendingCreationKey(scope);
  const safe = { requestId: value.requestId, draft: asDraft(normalizeDraft(value.draft)) };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(safe.requestId))
    throw Error("Некорректный ключ создания.");
  const serialized = JSON.stringify(safe);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized)
    throw Error("Не удалось сохранить попытку в этой вкладке.");
}
export function clearPendingCreation(storage: PendingStorage, scope: string): void {
  storage.removeItem(pendingCreationKey(scope));
}
