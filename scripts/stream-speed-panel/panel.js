const form = document.querySelector("#experiment");
const modes = document.querySelector("#modes");
const status = document.querySelector("#status");
const results = document.querySelector("#metrics");
const answers = document.querySelector("#answers");
const run = document.querySelector("#run");
const stop = document.querySelector("#stop");
let current;

function addResult(mode, m) {
  const row = results.insertRow();
  for (const value of [
    mode,
    m.first_visible_text_ms == null ? null : `${m.first_visible_text_ms} мс`,
    m.total_ms == null ? null : `${m.total_ms} мс`,
    m.visible_characters_per_second,
    m.provider_completion_tokens,
    m.provider_completion_tokens_per_second_end_to_end
  ])
    row.insertCell().textContent = value ?? "—";
}

async function compareMode(mode, prompt, maxTokens, signal) {
  const title = mode.dataset.title;
  const card = document.createElement("article");
  const heading = document.createElement("h3");
  const output = document.createElement("pre");
  heading.textContent = title;
  card.append(heading, output);
  answers.append(card);
  status.textContent = `Выполняется: ${title}`;
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: mode.value, prompt, maxTokens }),
    signal
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  let buffer = "";
  let completed = false;
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.text) output.textContent += event.text;
      if (event.error) {
        if (output.textContent) output.textContent += "\n\n";
        output.textContent += event.error;
        addResult(`${title} · ошибка`, {});
        completed = true;
      }
      if (event.metrics) {
        addResult(title, event.metrics);
        completed = true;
      }
    }
  }
  if (!completed) throw new Error("Поток прервался до получения результата.");
}

stop.addEventListener("click", () => current?.abort());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = [...modes.querySelectorAll("input:checked")];
  if (!selected.length || current) return;
  current = new AbortController();
  const prompt = document.querySelector("#prompt").value;
  const maxTokens = document.querySelector("#max-tokens").valueAsNumber;
  run.disabled = true;
  stop.disabled = false;
  results.replaceChildren();
  answers.replaceChildren();
  try {
    for (const mode of selected) await compareMode(mode, prompt, maxTokens, current.signal);
    status.textContent = "Прогон завершён.";
  } catch (error) {
    status.textContent = current.signal.aborted ? "Прогон остановлен." : error.message;
  } finally {
    current = undefined;
    run.disabled = !modes.querySelector("input:checked");
    stop.disabled = true;
  }
});

try {
  const response = await fetch("/api/modes");
  if (!response.ok) throw new Error("Не удалось загрузить режимы.");
  for (const mode of await response.json()) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = mode.id;
    checkbox.checked = mode.id === "fixture";
    checkbox.disabled = !mode.ready;
    checkbox.dataset.title = mode.live && mode.model ? `${mode.label} · ${mode.model}` : mode.label;
    label.append(checkbox, ` ${checkbox.dataset.title}${mode.ready ? "" : " · не подключён"}`);
    modes.append(label);
  }
  modes.addEventListener("change", () => {
    run.disabled = Boolean(current) || !modes.querySelector("input:checked");
  });
  run.disabled = false;
  status.textContent = "";
} catch {
  status.textContent = "Не удалось загрузить режимы.";
}
