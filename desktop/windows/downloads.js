"use strict";

const api = window.kosmoraDownloads;
const list = document.getElementById("downloads");
const clear = document.getElementById("clear");
const empty = document.getElementById("empty");
const message = document.getElementById("message");
const names = {
  active: "Загружается",
  completed: "Завершено",
  cancelled: "Отменено",
  interrupted: "Прервано"
};
const integer = new Intl.NumberFormat("ru-RU");
function bytes(value) {
  return `${integer.format(value || 0)} байт`;
}
function action(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await handler();
      if (!result?.ok)
        message.textContent = "Действие не выполнено. Проверьте сеанс или наличие файла.";
      else message.textContent = "";
    } catch {
      message.textContent = "Действие недоступно.";
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
function render(entries) {
  list.replaceChildren();
  empty.hidden = entries.length !== 0;
  clear.disabled = !entries.some((entry) => entry.status !== "active");
  for (const entry of entries) {
    if (!entry || !Object.hasOwn(names, entry.status)) continue;
    const li = document.createElement("li");
    const record = document.createElement("div");
    record.className = "record";
    const filename = document.createElement("div");
    filename.className = "filename";
    filename.textContent = entry.name; // Never innerHTML: download names are untrusted.
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = `${names[entry.status]} · ${bytes(entry.receivedBytes)}${entry.totalBytes ? ` из ${bytes(entry.totalBytes)}` : " · размер неизвестен"}`;
    record.append(filename, detail);
    if (entry.status === "active" && entry.totalBytes) {
      const progress = document.createElement("progress");
      progress.max = entry.totalBytes;
      progress.value = Math.min(entry.receivedBytes, entry.totalBytes);
      progress.setAttribute("aria-label", "Получено байт");
      record.append(progress);
    }
    li.append(record);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (entry.status === "active") actions.append(action("Отменить", () => api.cancel(entry.id)));
    if (entry.status === "completed")
      actions.append(action("Показать в папке", () => api.reveal(entry.id)));
    li.append(actions);
    list.append(li);
  }
}
async function refresh() {
  try {
    const result = await api.list();
    if (result?.ok && Array.isArray(result.entries)) render(result.entries);
    else {
      render([]);
      message.textContent = "Требуется подтверждение текущего аккаунта.";
    }
  } catch {
    render([]);
    message.textContent = "Не удалось получить историю загрузок.";
  }
}
clear.addEventListener("click", async () => {
  try {
    const result = await api.clear();
    if (!result?.ok) message.textContent = "Очистка недоступна.";
  } catch {
    message.textContent = "Очистка недоступна.";
  }
});
api.onChanged(render);
void refresh();
