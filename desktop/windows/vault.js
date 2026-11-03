"use strict";
const $ = (id) => document.getElementById(id);
let busy = false;
function render(data) {
  if (!data?.items) return;
  $("items").replaceChildren();
  $("status").textContent =
    data.connected === false
      ? "Папка не подключена."
      : `Файлов: ${data.items.length}${data.bytes !== undefined ? " · " + data.bytes + " байт" : ""}${data.limited ? " · показана ограниченная выборка" : ""}`;
  for (const item of data.items) {
    const row = document.createElement("article"),
      title = document.createElement("strong"),
      meta = document.createElement("p"),
      controls = document.createElement("div");
    title.textContent = item.name;
    meta.textContent =
      item.snippet ||
      `${item.bytes} байт · ${item.kind === "memory" ? "Снимок памяти" : "Оригинал"} · ${item.created_at}`;
    row.append(title, meta, controls);
    for (const [command, label] of [
      ["preview", "Посмотреть текст"],
      ["send", "В черновик чата"],
      ["export", "Сохранить копию"],
      ["remove", "Удалить копию"]
    ]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => void run(command, item.id);
      controls.append(b);
    }
    $("items").append(row);
  }
}
async function run(command, value) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  $("status").textContent = "Выполняется…";
  try {
    const r = await window.kosmoraVault.command(command, value);
    if (!r.ok) throw Error(r.message);
    if (r.data) render(r.data);
    else $("status").textContent = "Готово.";
    if (typeof r.text === "string") $("preview").textContent = r.text;
    if (["disconnect", "choose", "remove"].includes(command)) $("preview").textContent = "";
  } catch (e) {
    $("status").textContent = e.message || "Операция не выполнена.";
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
document
  .querySelectorAll("[data-command]")
  .forEach((b) => (b.onclick = () => void run(b.dataset.command)));
$("search").onsubmit = (e) => {
  e.preventDefault();
  void run("search", $("query").value);
};
void run("status");
