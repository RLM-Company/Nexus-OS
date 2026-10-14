export const endpoint = "/api/v1/presentations";
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    if (response.status === 409) throw Error("CONFLICT");
    if (response.status === 401) throw Error("Сеанс завершён. Войдите снова.");
    if (response.status === 423) throw Error("Данные аккаунта временно закрыты для изменений.");
    if (response.status === 413) throw Error("Превышен лимит презентаций или объёма текста.");
    if (response.status === 404)
      throw Error("Версия или презентация больше недоступна. Обновите список.");
    throw Error(result.error?.code ?? "Не удалось сохранить данные.");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
export const json = (value: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value)
});
