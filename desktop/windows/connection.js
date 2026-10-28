"use strict";

const form = document.querySelector("#connection-form");
const origin = document.querySelector("#origin");
const button = document.querySelector("#connect");
const retry = document.querySelector("#retry");
const change = document.querySelector("#change");
const error = document.querySelector("#error");
const title = document.querySelector("#title");
const lead = document.querySelector("#lead");

let activeRequestId = 0;
let renderVersion = 0;
let editingReplacementOrigin = false;

function setBusy(value) {
  button.disabled = value;
  retry.disabled = value;
  button.textContent = value ? "Подключение…" : "Открыть Kosmora";
  retry.textContent = value ? "Проверка…" : "Повторить";
}

async function render() {
  const version = ++renderVersion;
  const requestId = activeRequestId;
  const state = await window.cosmoraDesktop.getConnectionState();
  if (version !== renderVersion || requestId !== activeRequestId) return;
  setBusy(Boolean(state.connecting));
  if (editingReplacementOrigin) return;
  origin.value = state.origin;
  error.textContent = state.message || "";
  const offline = state.mode === "offline";
  form.hidden = offline;
  retry.hidden = !offline;
  change.hidden = !offline;
  title.textContent = offline ? "Kosmora сейчас недоступна" : "Подключение к Kosmora";
  lead.textContent = offline
    ? "Сохранённый сервер не ответил. Можно повторить попытку или изменить адрес — текущий выбор останется сохранённым до успешного подключения к новому серверу."
    : "Укажите HTTPS-сервер Kosmora. После проверки откроется обычная страница входа Kosmora — пароль в оболочку Windows вводить не нужно.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const requestId = ++activeRequestId;
  error.textContent = "";
  setBusy(true);
  try {
    const result = await window.cosmoraDesktop.connect({ origin: origin.value });
    if (requestId !== activeRequestId || result?.stale) return;
    if (result?.ok) editingReplacementOrigin = false;
    else error.textContent = result?.message || "Не удалось подключиться к серверу.";
  } catch {
    if (requestId !== activeRequestId) return;
    error.textContent = "Не удалось открыть Kosmora. Проверьте соединение и повторите попытку.";
  } finally {
    if (requestId === activeRequestId) setBusy(false);
  }
});

retry.addEventListener("click", async () => {
  const requestId = ++activeRequestId;
  editingReplacementOrigin = false;
  error.textContent = "";
  setBusy(true);
  try {
    const result = await window.cosmoraDesktop.retry();
    if (requestId !== activeRequestId || result?.stale) return;
    if (!result?.ok) error.textContent = result?.message || "Повторное подключение не удалось.";
  } catch {
    if (requestId !== activeRequestId) return;
    error.textContent = "Повторное подключение не удалось.";
  } finally {
    if (requestId === activeRequestId) setBusy(false);
  }
});

change.addEventListener("click", () => {
  editingReplacementOrigin = true;
  form.hidden = false;
  retry.hidden = true;
  change.hidden = true;
  title.textContent = "Сменить сервер Kosmora";
  lead.textContent =
    "Новый адрес сохранится только после успешной HTTPS-проверки. Текущий сервер пока остаётся сохранённым.";
  error.textContent = "";
  origin.focus();
  origin.select();
});

window.cosmoraDesktop.onConnectionStateChanged(() => void render().catch(() => {}));
void render().catch(() => {
  origin.value = "https://13.141.51.16";
  error.textContent = "Не удалось прочитать настройки подключения.";
});
