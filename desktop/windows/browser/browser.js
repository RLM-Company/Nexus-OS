"use strict";
const $ = (id) => document.getElementById(id),
  bridge = window.kosworkBrowser;
let current = { tabs: [], projects: [], downloads: [] },
  busy = false,
  historyBusy = false;
const messages = {
  BROWSER_DOM_TIMEOUT: "Страница отвечает слишком долго. Перезагрузите или закройте вкладку.",
  BROWSER_QUERY_INVALID: "Запрос должен содержать от 1 до 240 символов.",
  BROWSER_SEARCH_UNAVAILABLE:
    "Поиск сейчас недоступен. Проверьте подключение сервера к поиску и повторите запрос.",
  BROWSER_INPUT_UNCERTAIN:
    "Действие могло выполниться частично. Проверьте результат перед новым запуском.",
  BROWSER_URL_INVALID: "Адрес не поддерживается. Используйте HTTP(S) или поисковый запрос.",
  BROWSER_TAB_LIMIT:
    "Лимит: 8 вкладок, до 3 загруженных. Закройте ненужную вкладку; страницы с вводом не выгружаются автоматически.",
  BROWSER_STALE: "Страница изменилась. Проверьте её и повторите действие.",
  BROWSER_ELEMENT_UNAVAILABLE:
    "Элемент недоступен. Возможно, нужен ручной вход или действие владельца.",
  COMPUTER_BUSY: "Уже выполняется другая задача. Сначала остановите её.",
  COMPUTER_CANCELLED: "Запуск отменён.",
  COMPUTER_VAULT_NOT_CONNECTED:
    "Сначала подключите папку в окне «Локальное хранилище» через меню Koswork.",
  COMPUTER_WORKSPACE_CHANGED:
    "Рабочая папка изменилась. Выберите исходную папку для восстановления задачи.",
  COMPUTER_LIVE_MODEL_REQUIRED: "Для запуска нужен подключённый сервер с живой моделью.",
  COMPUTER_PRIVACY_BLOCKED: "Доступ остановлен настройками приватности аккаунта.",
  COMPUTER_IDENTITY_CHANGED: "Аккаунт или сервер изменился. Откройте браузер заново.",
  COMPUTER_ROUTE_UNAVAILABLE: "Сейчас нет подходящего модельного маршрута.",
  COMPUTER_SESSION_STOPPED: "Задача остановлена. Проверьте результат перед повторным запуском.",
  COMPUTER_OWNER_UNVERIFIED: "Нужен подтверждённый вход в Kosmora.",
  COMPUTER_HISTORY_UNAVAILABLE: "Журнал недоступен. Действия остановлены; проверьте результат.",
  COMPUTER_RECOVERY_RESTART_REQUIRED: "После ошибки требуется перезапуск приложения.",
  WORK_ENVIRONMENT_DENIED:
    "Доступ к среде не разрешён. Задача остановлена; её можно продолжить с новым разрешением.",
  WORK_RESULT_UNCHECKED: "Не все этапы плана проверены. Задача не отмечена как завершённая.",
  WORK_CONTEXT_TOO_LARGE:
    "Контекст задачи слишком велик. Уточните цель и продолжите с контрольной точки.",
  WORK_STEP_INVALID: "Этап плана изменился. Проверьте прогресс перед продолжением."
};
const error = (v) =>
  messages[v] || "Действие не выполнено. Проверьте страницу, подключение и результат.";
function add(text) {
  const row = document.createElement("li");
  row.textContent = text;
  $("events").append(row);
  while ($("events").children.length > 40) $("events").firstElementChild.remove();
}
async function command(name, input) {
  if (!bridge) {
    $("notice").textContent = "Откройте браузер из Windows-приложения Kosmora.";
    return {};
  }
  let result;
  try {
    result = await bridge.command(name, input);
  } catch {
    result = { error: "BROWSER_INTERRUPTED" };
  }
  if (result?.error) $("notice").textContent = error(result.error);
  return result;
}
function render(value) {
  current = { ...current, ...value };
  $("work-plan").hidden = current.taskMode !== "work";
  if (current.taskMode === "work") {
    document.title = "Koswork · Рабочая задача";
    document.querySelector(".brand small").textContent = "Work";
    $("work-environment").textContent =
      "Среда: " +
      ({ none: "планирование", browser: "браузер", computer: "ваш ПК" }[
        current.workTask?.environment
      ] || "планирование");
    $("work-steps").replaceChildren();
    for (const step of current.workTask?.steps || []) {
      const item = document.createElement("li"),
        title = document.createElement("strong"),
        criterion = document.createElement("p"),
        evidence = document.createElement("p");
      title.textContent =
        ({ pending: "○ ", running: "◌ ", checked: "✓ " }[step.state] || "") + step.title;
      criterion.textContent = step.criteria;
      evidence.textContent = step.evidence || "";
      item.append(title, criterion, evidence);
      $("work-steps").append(item);
    }
  }
  $("tabs").replaceChildren();
  for (const tab of current.tabs) {
    const row = document.createElement("div");
    row.className = "tab" + (tab.id === current.active ? " active" : "");
    const mark = document.createElement("span");
    mark.className = "tab-mark";
    mark.textContent = tab.loading ? "◌" : tab.loaded ? "○" : "·";
    const select = document.createElement("button");
    select.className = "tab-label";
    select.textContent = tab.title || "Новая вкладка";
    select.title = tab.title;
    select.addEventListener("click", () => void command("switch", tab.id).then(update));
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрыть " + tab.title);
    close.addEventListener("click", () => void command("close", tab.id).then(update));
    row.append(mark, select, close);
    $("tabs").append(row);
  }
  const active = current.tabs.find((t) => t.id === current.active);
  $("back").disabled = !active?.canGoBack;
  $("forward").disabled = !active?.canGoForward;
  const protocol = document.querySelector("#protocol-icon use");
  if (protocol)
    protocol.setAttribute(
      "href",
      active?.url?.startsWith("https://") && !active.searchQuery && !active.error && !active.loading
        ? "#icon-lock"
        : active?.url && active.url !== "about:blank"
          ? "#icon-info"
          : "#icon-search"
    );
  $("home").hidden = !!active && (active.url !== "about:blank" || !!active.searchQuery);
  if (document.activeElement !== $("address"))
    $("address").value =
      active?.searchQuery || (active?.url && active.url !== "about:blank" ? active.url : "");
  $("memory").textContent = (current.liveTabs || 0) + " / 3 вкладки в памяти";
  $("new").disabled = current.tabs.length >= 8;
  const selected = $("project").value;
  $("project").replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Выберите проект";
  $("project").append(empty);
  for (const p of current.projects) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.title;
    $("project").append(option);
  }
  if (current.projects.some((p) => p.id === selected)) $("project").value = selected;
  else if (current.projects[0]) $("project").value = current.projects[0].id;
  if (current.prefill) {
    if (current.prefill.goal) $("goal").value = current.prefill.goal.slice(0, 8000);
    if (current.projects.some((p) => p.id === current.prefill.project))
      $("project").value = current.prefill.project;
    current.prefill = null;
  }
  $("start").disabled = busy || current.running || !$("project").value;
  $("project").disabled = busy || current.running;
  $("goal").disabled = busy || current.running;
  $("takeover").disabled = !busy && !current.running;
  $("resume").hidden = !current.paused;
  $("status").textContent = current.paused
    ? "Ждёт вас"
    : current.running || busy
      ? "Работает"
      : "Готов";
  $("folder").disabled = busy || current.running;
  $("folder-name").textContent = current.folder?.name || "Рабочая папка";
  $("folder-description").textContent = current.folder
    ? "Для разрешённых вложений и результатов."
    : "Выберите папку для вложений и результатов.";
  $("folder").textContent = current.folder ? "Изменить" : "Подключить";
  $("revoke-folder").hidden = !current.folder;
  $("vault").hidden = !current.vaultAvailable || current.vaultAccess;
  $("vault").disabled = busy || current.running;
  $("revoke-vault").hidden = !current.vaultAccess;
  $("notice").textContent =
    active?.error ||
    current.notice ||
    "Входы на сайты выполняются вами. Агент начинает работу после отдельного разрешения.";
  $("downloads").replaceChildren();
  $("download-count").textContent = current.downloads.length
    ? "(" + current.downloads.length + ")"
    : "";
  for (const d of current.downloads) {
    const line = document.createElement("p");
    line.textContent =
      d.name +
      " · " +
      ({
        progressing: "Загружается",
        completed: "Сохранено",
        cancelled: "Отменено",
        interrupted: "Прервано",
        unverified: "Результат не подтверждён",
        blocked: "Заблокировано"
      }[d.status] || d.status) +
      " · " +
      Math.round(d.bytes / 1024) +
      " КБ";
    $("downloads").append(line);
  }
}
function update(value) {
  if (value?.tabs) render(value);
}
$("date").textContent = new Date().toLocaleDateString("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long"
});
for (const action of ["new", "back", "forward", "reload"])
  $(action).addEventListener("click", () => void command(action).then(update));
$("brand").addEventListener("click", (e) => {
  e.preventDefault();
  void command("new").then(update);
});
for (const [form, input] of [
  ["address-form", "address"],
  ["search-form", "search"]
])
  $(form).addEventListener("submit", (e) => {
    e.preventDefault();
    if ($(input).value.trim()) void command("navigate", $(input).value).then(update);
  });
document.querySelectorAll("[data-goal]").forEach((button) =>
  button.addEventListener("click", () => {
    $("goal").value = button.dataset.goal;
    $("goal").focus();
  })
);
async function run(name, input) {
  if (busy || current.running) return;
  busy = true;
  $("events").replaceChildren();
  render({});
  try {
    const result = await command(name, input);
    add(
      result.error ? error(result.error) : result.summary || result.status || "Задача завершена."
    );
  } catch {
    add("Соединение с исполнителем прервано.");
  } finally {
    busy = false;
    update(await command("state"));
    if ($("history-details").open) await refreshHistory();
  }
}
$("start").addEventListener("click", () => {
  if ($("goal").value.trim())
    void run("start", { project: $("project").value, goal: $("goal").value });
});
$("takeover").addEventListener("click", async () => {
  await command("stop");
  add("Управление у вас. Новые действия агента не разрешены.");
});
$("resume").addEventListener(
  "click",
  () =>
    void command("resume")
      .then(() => command("state"))
      .then(update)
);
$("folder").addEventListener("click", async () => {
  busy = true;
  render({});
  await command("folder");
  busy = false;
  update(await command("state"));
});
$("revoke-folder").addEventListener(
  "click",
  () =>
    void command("revoke-folder")
      .then(() => command("state"))
      .then(update)
);
async function refreshHistory() {
  if (historyBusy) return;
  historyBusy = true;
  try {
    const result = await command("history");
    $("history").replaceChildren();
    for (const item of result.items || []) {
      const row = document.createElement("div");
      row.className = "history-item";
      const text = document.createElement("p");
      text.textContent =
        (item.goal || "Цель не сохранена") +
        " · " +
        ({
          completed: "Модель сообщила о завершении",
          failed: "Ошибка",
          cancelled: "Остановлена",
          interrupted: "Прервана",
          step_limit: "Лимит шагов",
          needs_user: "Нужно ваше действие",
          running: "Выполняется",
          paused: "Пауза"
        }[item.status] || item.status);
      row.append(text);
      if (item.recoverable) {
        const button = document.createElement("button");
        button.textContent = "Восстановить с новым разрешением";
        button.disabled = busy || current.running;
        button.addEventListener("click", () => void run("recover", item.id));
        row.append(button);
      }
      if (item.status === "completed" && !item.acceptedAt) {
        const button = document.createElement("button");
        button.textContent = "Результат проверен мной";
        button.addEventListener("click", async () => {
          await command("accept", item.id);
          await refreshHistory();
        });
        row.append(button);
      }
      $("history").append(row);
    }
  } finally {
    historyBusy = false;
  }
}
$("vault").addEventListener("click", async () => {
  busy = true;
  render({});
  await command("vault");
  busy = false;
  update(await command("state"));
});
$("revoke-vault").addEventListener(
  "click",
  () =>
    void command("revoke-vault")
      .then(() => command("state"))
      .then(update)
);
$("history-details").addEventListener("toggle", () => {
  if ($("history-details").open) void refreshHistory();
});
if (bridge) {
  bridge.onShortcut?.((key) => {
    if (key === "l") {
      $("address").focus();
      $("address").select();
    } else if (key === "t") void command("new").then(update);
    else if (key === "r") void command("reload").then(update);
    else if (key === "w" && current.active) void command("close", current.active).then(update);
  });
  bridge.onState(render);
  bridge.onEvent((value) => {
    add((value.step ? value.step + ". " : "") + (value.message || value.action || ""));
    if (value.phase === "awaiting_user") render({ paused: true, running: true });
  });
  void command("state").then(update);
}
