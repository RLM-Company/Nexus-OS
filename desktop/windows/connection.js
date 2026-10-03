"use strict";

const form = document.querySelector("#connection-form");
const origin = document.querySelector("#origin");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const button = document.querySelector("#connect");
const error = document.querySelector("#error");

async function initialize() {
  try {
    const defaults = await window.cosmoraDesktop.getConnectionDefaults();
    origin.value = defaults.origin;
  } catch {
    origin.value = "https://13.141.51.16";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  button.disabled = true;
  button.textContent = "Подключение…";

  try {
    const result = await window.cosmoraDesktop.connect({
      origin: origin.value,
      username: username.value,
      password: password.value
    });

    if (!result.ok) {
      error.textContent = result.message;
      password.select();
    }
  } catch {
    error.textContent = "Не удалось открыть Cosmora. Проверьте соединение и повторите попытку.";
  } finally {
    button.disabled = false;
    button.textContent = "Подключиться";
  }
});

void initialize();
