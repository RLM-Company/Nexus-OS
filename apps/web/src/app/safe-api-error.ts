export const safeApiErrorMessage = (status: number): string => {
  if (status === 401 || status === 403) return "Недостаточно прав для этого действия.";
  if (status === 404) return "Запрошенные данные не найдены.";
  if (status === 409) return "Состояние изменилось. Обновите данные и повторите попытку.";
  if (status === 429) return "Слишком много запросов. Повторите попытку позже.";
  if (status >= 500) return "Сервис временно недоступен. Повторите попытку.";
  return "Не удалось выполнить запрос. Проверьте данные и повторите попытку.";
};

export const safeApiError = (response: Pick<Response, "status">): Error =>
  new Error(safeApiErrorMessage(response.status));
