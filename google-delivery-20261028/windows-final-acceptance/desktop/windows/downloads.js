"use strict";

const list = document.querySelector("#list");
const empty = document.querySelector("#empty");
const error = document.querySelector("#error");
const stateText = document.querySelector("#state-text");
const openFolder = document.querySelector("#open-folder");
const clearCompleted = document.querySelector("#clear-completed");

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "0 Б";
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function describe(item) {
  const progress =
    item.totalBytes && item.totalBytes > 0
      ? `${formatBytes(item.receivedBytes)} из ${formatBytes(item.totalBytes)}`
      : formatBytes(item.receivedBytes);
  if (item.status === "active") return `Скачивается • ${progress}`;
  if (item.status === "completed") return `Готово • ${progress}`;
  if (item.status === "cancelled") return "Отменено";
  return "Прервано • автоматический повтор отключён";
}

function actionButton(label, handler, secondary = false) {
  const button = document.createElement("button");
  button.type = "button";
  if (secondary) button.className = "secondary";
  button.textContent = label;
  button.addEventListener("click", () => void run(handler));
  return button;
}

async function run(action) {
  error.textContent = "";
  try {
    const result = await action();
    if (result && result.ok === false) {
      error.textContent = result.message || "Операция не выполнена.";
    }
    await render();
  } catch {
    error.textContent = "Не удалось выполнить команду Центра загрузок.";
  }
}

async function render() {
  const result = await window.cosmoraDownloads.list();
  const items = Array.isArray(result.items) ? result.items : [];
  stateText.textContent = result.message || `${items.length} в истории текущего аккаунта`;
  list.replaceChildren();
  empty.hidden = items.length > 0;
  clearCompleted.disabled = !items.some((item) => item.status !== "active");

  for (const item of items) {
    const row = document.createElement("li");
    row.className = "row";
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("p");
    name.className = "filename";
    name.textContent = item.name;
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = describe(item);
    meta.append(name, status);

    const actions = document.createElement("div");
    actions.className = "actions";
    if (item.status === "active") {
      actions.append(
        actionButton("Отменить", () => window.cosmoraDownloads.cancelItem(item.id), true)
      );
    } else if (item.status === "completed") {
      actions.append(
        actionButton("Открыть", () => window.cosmoraDownloads.openItem(item.id)),
        actionButton(
          "Показать в папке",
          () => window.cosmoraDownloads.revealItem(item.id),
          true
        ),
        actionButton("Убрать", () => window.cosmoraDownloads.removeItem(item.id), true)
      );
    } else {
      actions.append(
        actionButton("Убрать", () => window.cosmoraDownloads.removeItem(item.id), true)
      );
    }
    row.append(meta, actions);
    list.append(row);
  }
}

openFolder.addEventListener("click", () => void run(() => window.cosmoraDownloads.openFolder()));
clearCompleted.addEventListener(
  "click",
  () => void run(() => window.cosmoraDownloads.clearCompleted())
);
window.cosmoraDownloads.onChanged(() => void render());
void render().catch(() => {
  error.textContent = "Не удалось загрузить историю скачиваний.";
});
