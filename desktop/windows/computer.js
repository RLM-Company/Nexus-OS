"use strict";
const project = document.getElementById("project");
const goal = document.getElementById("goal");
const start = document.getElementById("start");
const stop = document.getElementById("stop");
const resume = document.getElementById("resume");
const connection = document.getElementById("connection");
const events = document.getElementById("events");
const errors = {
  COMPUTER_CANCELLED: "Запуск отменён.",
  COMPUTER_SESSION_STOPPED:
    "Управление остановлено или разрешение истекло. Проверьте состояние проекта перед новым запуском.",
  COMPUTER_IDENTITY_CHANGED: "Аккаунт или сервер изменился. Откройте управление заново.",
  COMPUTER_OWNER_UNVERIFIED: "Войдите в Kosmora и откройте управление заново.",
  COMPUTER_POLICY_BLOCKED:
    "Профиль проекта не разрешает управление ПК. Проверьте разрешения проекта в Koswork.",
  COMPUTER_API_UNAVAILABLE: "На сервере ещё нет этой версии управления ПК.",
  COMPUTER_ROUTE_UNAVAILABLE:
    "На сервере не настроен действующий маршрут с поддержкой изображений. Задача не запущена.",
  COMPUTER_LIVE_MODEL_REQUIRED:
    "Подключён тестовый планировщик или несовместимый API. Управление ПК не запущено: нужна живая модель.",
  COMPUTER_DECISION_SOURCE_INVALID:
    "API не подтвердил источник команды живой модели. Действие не выполнено.",
  COMPUTER_RUNTIME_UNAVAILABLE:
    "Не удалось получить действие модели. Нужен доступный маршрут с поддержкой изображений; автоматического повтора нет.",
  COMPUTER_OUTPUT_INVALID: "Модель вернула неподдерживаемое действие. Оно не выполнено.",
  COMPUTER_OUTPUT_INCOMPLETE: "Ответ модели оборвался. Действие не выполнено.",
  COMPUTER_BUSY: "Уже выполняется другая задача. Дождитесь остановки.",
  COMPUTER_SESSION_RECOVERY_REQUIRED:
    "Сеанс прерван перезапуском сервера. Запустите новую задачу после проверки результата.",
  COMPUTER_FOCUS_REJECTED:
    "Windows не позволила переключить окно. Откройте нужное приложение и запустите задачу заново.",
  COMPUTER_USER_INPUT_ACTIVE:
    "Обнаружен ввод с клавиатуры или мыши. Агент остановился, чтобы не мешать вашим действиям.",
  COMPUTER_DESKTOP_UNAVAILABLE:
    "Рабочий стол недоступен. Разблокируйте устройство; защищённые окна требуют вашего участия.",
  COMPUTER_INPUT_REJECTED:
    "Windows не подтвердила полный ввод. Проверьте результат перед новым запуском.",
  COMPUTER_STOP_SHORTCUT_UNAVAILABLE:
    "Не удалось включить горячую клавишу остановки. Управление не запущено.",
  OWNER_BUDGET_LIMIT: "Достигнут лимит расходов аккаунта.",
  USAGE_LIMIT: "Достигнут лимит проекта."
};
const applyPrefill = (value) => {
  if (!value || !stop.disabled) return;
  if (typeof value.goal === "string") goal.value = value.goal.slice(0, 8000);
  if (typeof value.project === "string") {
    if (Array.from(project.options).some((option) => option.value === value.project))
      project.value = value.project;
    else {
      project.value = "";
      start.disabled = true;
      connection.textContent = "Выбранный проект недоступен. Выберите доступный проект.";
    }
  }
};
project.addEventListener("change", () => {
  if (stop.disabled) start.disabled = !project.value;
});
window.kosworkComputer.onPrefill(applyPrefill);
const add = (text) => {
  const row = document.createElement("li");
  row.textContent = text;
  events.append(row);
  while (events.children.length > 60) events.firstElementChild.remove();
};
window.kosworkComputer.onStatus((value) => {
  if (value.phase) resume.disabled = value.phase !== "awaiting_user";
  if (value.phase === "awaiting_user")
    connection.textContent =
      "Пауза: ждём вашего действия. Снимки и запросы к модели не выполняются.";
  if (value.phase === "running")
    connection.textContent = "Ожидаем следующую подтверждённую команду модели…";
  const source = value.decision_source;
  if (source?.mode === "provider") {
    connection.textContent = `Команды через модель ${source.model_id} · ${source.provider_id}`;
    add(`${value.step}. ${value.message || value.action} · запрос ${source.run_id}`);
  } else add(`${value.step}. ${value.message || value.action}`);
});
start.addEventListener("click", async () => {
  if (!goal.value.trim() || !project.value) return;
  start.disabled = true;
  stop.disabled = false;
  goal.disabled = true;
  project.disabled = true;
  events.replaceChildren();
  resume.disabled = true;
  connection.textContent = "Ожидаем разрешение и подтверждённую команду модели…";
  try {
    const result = await window.kosworkComputer.start({ project: project.value, goal: goal.value });
    add(
      result.error
        ? errors[result.error] ||
            "Работа прервана. Проверьте подключение и результат; автоматического повтора нет."
        : result.summary || result.status
    );
  } catch {
    add("Соединение с локальным исполнителем прервано.");
  } finally {
    connection.textContent = "Сеанс управления завершён. Новые действия не выполняются.";
    start.disabled = false;
    stop.disabled = true;
    goal.disabled = false;
    project.disabled = false;
    resume.disabled = true;
  }
});
stop.addEventListener("click", async () => {
  resume.disabled = true;
  await window.kosworkComputer.stop();
  add("Отправлена команда остановки.");
});
resume.addEventListener("click", async () => {
  resume.disabled = true;
  const result = await window.kosworkComputer.resume();
  if (!result.resumed) add("Нет ожидающего продолжения сеанса.");
});
window.kosworkComputer
  .projects()
  .then((result) => {
    if (result.error) {
      connection.textContent = result.error;
      return;
    }
    connection.textContent = `${result.origin} · аккаунт подтверждён; модель ещё не запускалась`;
    for (const item of result.projects) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.title;
      project.append(option);
    }
    if (!project.options.length) {
      connection.textContent += ". Создайте проект в Koswork.";
      return;
    }
    project.disabled = false;
    start.disabled = false;
    applyPrefill(result.prefill);
  })
  .catch(() => {
    connection.textContent = "Не удалось подключиться. Войдите в Kosmora и откройте окно повторно.";
  });
