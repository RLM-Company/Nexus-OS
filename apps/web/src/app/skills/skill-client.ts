import { matchesSuccessor, type Detail, type Draft, type Skill } from "./skill-model";
const labels: Record<string, string> = {
  REQUEST_CONFLICT: "Этот ключ уже использован для другого текста. Исходная попытка сохранена.",
  CREATION_DELETED: "Созданная инструкция уже удалена. Повтор не восстановит её.",
  VERSION_CONFLICT:
    "Другая версия уже сохранена. Черновик оставлен: скачайте его или создайте копию перед повторным открытием.",
  LIMIT_REACHED: "Достигнут лимит: 50 инструкций или 20 версий одной инструкции.",
  INVALID_SKILL: "Заполните название, описание и инструкцию без управляющих символов.",
  OWNER_DATA_FENCED: "Изменения временно заблокированы операцией с данными аккаунта.",
  NOT_FOUND: "Инструкция или версия больше не существует. Обновите список."
};
export class SkillApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(labels[code] ?? "Не удалось выполнить действие. Попробуйте ещё раз.");
  }
}
export async function skillApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  requestId?: string
): Promise<T> {
  const response = await fetch(`/api/v1/owner-skills${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: {
            "content-type": "application/json",
            ...(requestId ? { "idempotency-key": requestId } : {})
          },
          body: JSON.stringify(body)
        })
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    throw new SkillApiError(response.status, error.error?.code ?? "");
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
/** Never repeats the mutation: only exact successor readback can resolve an uncertain response. */
export async function writeSkillVersion(
  id: string,
  expectedVersion: number,
  draft: Draft,
  sourceVersion?: number,
  request = skillApi
): Promise<Detail> {
  const path = `/${encodeURIComponent(id)}`;
  try {
    await request<Skill>(
      sourceVersion === undefined ? path : `${path}/restore`,
      sourceVersion === undefined ? "PUT" : "POST",
      sourceVersion === undefined
        ? { ...draft, expected_version: expectedVersion }
        : { expected_version: expectedVersion, source_version: sourceVersion }
    );
  } catch (cause) {
    if (cause instanceof SkillApiError && cause.status !== 409 && cause.status < 500) throw cause;
    try {
      const stored = await request<Detail>(path);
      if (matchesSuccessor(stored, id, expectedVersion, draft)) return stored;
    } catch {
      /* Keep original error and local draft. */
    }
    throw cause;
  }
  // A successful write followed by a failed read must not trigger another write.
  const stored = await request<Detail>(path);
  if (!matchesSuccessor(stored, id, expectedVersion, draft))
    throw new SkillApiError(409, "VERSION_CONFLICT");
  return stored;
}

/** Lookup only: never creates or repeats a write during reconciliation. */
export async function readSkillCreation(requestId: string, request = skillApi): Promise<Detail> {
  const skill = await request<Skill>(`/creations/${encodeURIComponent(requestId)}`);
  return request<Detail>(`/${encodeURIComponent(skill.id)}`);
}
export async function createSkillOnce(
  draft: Draft,
  requestId: string,
  path = "",
  body: unknown = draft,
  request = skillApi
): Promise<Detail> {
  let skill: Skill;
  try {
    skill = await request<Skill>(path, "POST", body, requestId);
  } catch (cause) {
    if (cause instanceof SkillApiError && cause.status < 500) throw cause;
    try {
      return await readSkillCreation(requestId, request);
    } catch {
      /* Keep the original failure and pending request. */
    }
    throw cause;
  }
  return request<Detail>(`/${encodeURIComponent(skill.id)}`);
}
