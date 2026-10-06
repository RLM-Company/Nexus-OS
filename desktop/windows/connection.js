"use strict";

const form = document.querySelector("#connection-form");
const origin = document.querySelector("#origin");
const button = document.querySelector("#connect");
const retry = document.querySelector("#retry");
const change = document.querySelector("#change");
const error = document.querySelector("#error");
const title = document.querySelector("#title");
const lead = document.querySelector("#lead");

function setBusy(value) {
  button.disabled = value;
  retry.disabled = value;
  button.textContent = value ? "Подключение…" : "Открыть Cosmora";
  retry.textContent = value ? "Проверка…" : "Повторить";
}

async function render() {
  const state = await window.cosmoraDesktop.getConnectionState();
  origin.value = state.origin;
  error.textContent = state.message || "";
  const offline = state.mode === "offline";
  form.hidden = offline;
  retry.hidden = !offline;
  change.hidden = !offline;
  title.textContent = offline ? "Cosmora сейчас недоступна" : "Подключение к Cosmora";
  lead.textContent = offline
    ? "Сохранённый сервер не ответил. Можно повторить попытку или изменить адрес — текущий выбор останется сохранённым до успешного подключения к новому серверу."
    : "Укажите HTTPS-сервер Cosmora. После проверки откроется обычная страница входа Cosmora — пароль в оболочку Windows вводить не нужно.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  setBusy(true);
  try {
    const result = await window.cosmoraDesktop.connect({ origin: origin.value });
    if (!result.ok) error.textContent = result.message;
  } catch {
    error.textContent = "Не удалось открыть Cosmora. Проверьте соединение и повторите попытку.";
  } finally {
    setBusy(false);
  }
});

retry.addEventListener("click", async () => {
  error.textContent = "";
  setBusy(true);
  try {
    const result = await window.cosmoraDesktop.retry();
    if (!result.ok) error.textContent = result.message;
  } catch {
    error.textContent = "Повторное подключение не удалось.";
  } finally {
    setBusy(false);
  }
});

change.addEventListener("click", () => {
  form.hidden = false;
  retry.hidden = true;
  change.hidden = true;
  title.textContent = "Сменить сервер Cosmora";
  lead.textContent = "Новый адрес сохранится только после успешной HTTPS-проверки. Текущий сервер пока остаётся сохранённым.";
  error.textContent = "";
  origin.focus();
  origin.select();
});

window.cosmoraDesktop.onConnectionStateChanged(() => void render());
void render().catch(() => {
  origin.value = "https://13.141.51.16";
  error.textContent = "Не удалось прочитать настройки подключения.";
});
