"use strict";
const project = document.getElementById("project");
const goal = document.getElementById("goal");
const start = document.getElementById("start");
const stop = document.getElementById("stop");
const resume = document.getElementById("resume");
const connection = document.getElementById("connection");
const events = document.getElementById("events");
const historyList = document.getElementById("history");
const historyStatus = document.getElementById("history-status");
const clearHistory = document.getElementById("clear-history");
const selectFolder = document.getElementById("select-folder");
const revokeFolder = document.getElementById("revoke-folder");
const folderStatus = document.getElementById("folder-status");
let selectedFolder = null;
let folderEpoch = 0;
let historyItems = [];
let busy = false;
const errors = {
  COMPUTER_WORKSPACE_UNAVAILABLE: "Рабочая папка недоступна. Выберите её в нативной консоли.",
  COMPUTER_WORKSPACE_CHANGED:
    "Рабочая папка изменилась или отключена. Для восстановления выберите ту же папку, что использовалась в исходной задаче.",
  COMPUTER_HISTORY_UNAVAILABLE:
    "История задач недоступна или повреждена. Действия остановлены. Можно явно удалить локальную историю или перезапустить приложение.",
  COMPUTER_HISTORY_NOT_FOUND: "Задача больше не доступна в локальной истории.",
  COMPUTER_RECOVERY_UNAVAILABLE:
    "Эта задача не подлежит восстановлению. Проверьте результат и создайте новую задачу.",
  COMPUTER_RECOVERY_RESTART_REQUIRED:
    "Исполнитель остановлен после ошибки сохранения или ввода. Проверьте результат и перезапустите приложение.",
  COMPUTER_PRIVACY_BLOCKED:
    "Данные аккаунта удалены или сейчас обрабатывается запрос приватности. Восстановление недоступно.",
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
  } else add(`${value.step ? value.step + ". " : ""}${value.message || value.action}`);
});
async function runTask(invoke) {
  if (busy) return;
  busy = true;
  renderHistory();
  start.disabled = true;
  stop.disabled = false;
  goal.disabled = true;
  project.disabled = true;
  events.replaceChildren();
  resume.disabled = true;
  connection.textContent = "Ожидаем разрешение и подтверждённую команду модели…";
  try {
    const result = await invoke();
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
    busy = false;
    start.disabled = !project.value;
    stop.disabled = true;
    goal.disabled = false;
    project.disabled = false;
    resume.disabled = true;
    await refreshHistory();
  }
}
start.addEventListener("click", () => {
  if (goal.value.trim() && project.value)
    void runTask(() => window.kosworkComputer.start({ project: project.value, goal: goal.value }));
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
    renderHistory();
  })
  .catch(() => {
    connection.textContent = "Не удалось подключиться. Войдите в Kosmora и откройте окно повторно.";
  });

const states = {
  running: "Выполняется",
  paused: "Ожидает владельца",
  interrupted: "Прервана перезапуском",
  completed: "Модель сообщила о завершении",
  cancelled: "Остановлена",
  failed: "Ошибка",
  step_limit: "Лимит шагов",
  needs_user: "Нужно ваше действие"
};
const phases = {
  planned: "Предложено; ввод не начинался",
  not_executed: "Не выполнялось",
  dispatching: "Передача исполнителю; исход неизвестен",
  requested: "Исполнитель подтвердил команду; результат не проверен",
  observed: "Получен снимок после команды; результат не подтверждён"
};
function renderHistory() {
  historyList.replaceChildren();
  clearHistory.disabled = busy;
  selectFolder.disabled = busy || project.disabled;
  revokeFolder.disabled = !selectedFolder;
  for (const item of historyItems) {
    const row = document.createElement("li");
    const heading = document.createElement("p");
    heading.textContent =
      (item.goal || "Цель не сохранена: возможно, содержала секрет") +
      " · " +
      (states[item.status] || item.status);
    const detail = document.createElement("p");
    detail.className = "hint";
    detail.textContent =
      new Date(item.updatedAt).toLocaleString() +
      " · проект " +
      item.project +
      (item.acceptedAt ? " · результат принят вами" : "");
    row.append(heading, detail);
    const steps = document.createElement("ol");
    for (const step of item.steps) {
      const line = document.createElement("li");
      line.textContent = step.kind + " · " + phases[step.phase];
      steps.append(line);
    }
    row.append(steps);
    if (item.requiresReview) {
      const warning = document.createElement("p");
      warning.className = "hint";
      warning.textContent =
        "Прошлые действия могли изменить данные. При восстановлении открытие приложений и файлов, клики, перетаскивания, ввод текста и клавиш потребуют подтверждения после проверки текущего состояния.";
      row.append(warning);
    }
    if (item.recoverable) {
      const button = document.createElement("button");
      button.textContent = "Восстановить с новым разрешением";
      button.disabled = busy;
      button.addEventListener("click", () => {
        void runTask(() => window.kosworkComputer.recover(item.id));
      });
      row.append(button);
    }
    if (item.status === "completed" && !item.acceptedAt) {
      const button = document.createElement("button");
      button.textContent = "Результат проверен мной";
      button.disabled = busy;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const result = await window.kosworkComputer.accept(item.id);
          if (result.error) add(errors[result.error] || "Не удалось принять результат.");
        } catch {
          add("Локальная история недоступна.");
        }
        await refreshHistory();
      });
      row.append(button);
    }
    historyList.append(row);
  }
}
async function refreshHistory() {
  try {
    const result = await window.kosworkComputer.history();
    historyItems = result.items || [];
    historyStatus.textContent = result.error
      ? errors[result.error] || "История недоступна. Проверьте подключение и аккаунт."
      : historyItems.length
        ? ""
        : "Сохранённых задач пока нет.";
    renderHistory();
  } catch {
    historyItems = [];
    historyStatus.textContent = "Не удалось загрузить локальную историю.";
    renderHistory();
  }
}
clearHistory.addEventListener("click", async () => {
  clearHistory.disabled = true;
  try {
    const result = await window.kosworkComputer.clearHistory();
    if (result.error) add(errors[result.error] || "Не удалось удалить историю.");
  } catch {
    add("Локальная история недоступна.");
  }
  await refreshHistory();
});
void refreshHistory();
async function refreshFolder() {
  const ticket = ++folderEpoch;
  try {
    const result = await window.kosworkComputer.workspaceStatus();
    if (ticket !== folderEpoch) return;
    selectedFolder = result.folder ?? null;
    folderStatus.textContent = result.error
      ? errors[result.error] || "Не удалось проверить рабочую папку."
      : selectedFolder
        ? "Рабочая папка: " +
          selectedFolder.name +
          ". Текстовые файлы могут передаваться модели для задачи; перезапись требует проверки версии и подтверждения."
        : "Рабочая папка не подключена. Выберите её заново после закрытия консоли.";
  } catch {
    selectedFolder = null;
    folderStatus.textContent = "Рабочая папка не подключена.";
  }
  renderHistory();
}
selectFolder.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  start.disabled = true;
  renderHistory();
  try {
    const result = await window.kosworkComputer.selectWorkspace();
    if (result.error)
      add(errors[result.error] || "Папка не подключена: выбор отменён или путь недоступен.");
  } catch {
    add("Не удалось подключить рабочую папку.");
  } finally {
    busy = false;
    start.disabled = !project.value;
    await refreshFolder();
  }
});
revokeFolder.addEventListener("click", async () => {
  folderEpoch++;
  try {
    const result = await window.kosworkComputer.revokeWorkspace();
    if (result.error) add(errors[result.error] || "Не удалось отключить папку.");
  } catch {
    add("Не удалось отключить папку. Остановите задачу и закройте консоль.");
  }
  await refreshFolder();
});
void refreshFolder();

document.getElementById("browser").addEventListener("click", async () => {
  const result = await window.kosworkComputer.openBrowser();
  if (result.error) add(errors[result.error] || "Не удалось открыть браузер.");
});
