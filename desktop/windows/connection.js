"use strict";

const form = document.querySelector("#connection-form");
const origin = document.querySelector("#origin");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const remember = document.querySelector("#remember");
const credentialStatus = document.querySelector("#credential-status");
const button = document.querySelector("#connect");
const error = document.querySelector("#error");

let hasStoredCredentials = false;
let storedOrigin = "";

async function initialize() {
  try {
    const defaults = await window.cosmoraDesktop.getConnectionDefaults();
    origin.value = defaults.origin;
    storedOrigin = defaults.origin;
    username.value = defaults.username || "";
    remember.checked = Boolean(defaults.rememberCredentials);
    hasStoredCredentials = Boolean(defaults.rememberCredentials);

    if (!defaults.protectedStorageAvailable) {
      remember.checked = false;
      remember.disabled = true;
      remember.closest(".remember").classList.add("is-disabled");
      credentialStatus.textContent =
        "Защищённое хранилище Windows сейчас недоступно; данные останутся только в памяти.";
    } else if (hasStoredCredentials) {
      credentialStatus.textContent =
        "Сохранённый пароль будет использован, если поле пароля оставить пустым.";
    }
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
      password: password.value,
      rememberCredentials: remember.checked,
      useStoredCredentials: hasStoredCredentials && password.value === ""
    });

    if (!result.ok) {
      error.textContent = result.message;
      password.select();
      return;
    }

    hasStoredCredentials = remember.checked;
  } catch {
    error.textContent = "Не удалось открыть Cosmora. Проверьте соединение и повторите попытку.";
  } finally {
    button.disabled = false;
    button.textContent = "Подключиться";
  }
});

origin.addEventListener("input", () => {
  if (hasStoredCredentials && origin.value.trim() !== storedOrigin) {
    hasStoredCredentials = false;
    remember.checked = false;
    credentialStatus.textContent =
      "Для другого сервера сохранённые учётные данные использоваться не будут.";
  }
});

void initialize();
