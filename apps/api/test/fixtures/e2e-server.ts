import { MockProviderAdapter } from "@cosmora/model-gateway";
import { ResearchPageReader } from "../../src/research/page-reader.js";
import { WebSearch } from "../../src/web-search.js";
import { installPresentationWorkFixture } from "./presentation-work-provider.js";
import { installChatReliabilityFixture } from "./chat-reliability-provider.js";
import { installSiteWorkFixture } from "./site-work-provider.js";
import { installGameWorkFixture } from "./game-work-provider.js";

const researchQuestion = "Какой код указан в архиве лунной станции?";
const researchUrl = "https://example.org/lunar-station-archive";
const researchEvidence = "Код архива лунной станции — SELENE-047.";
// Retain the prototype methods for the fixture and forward their original receiver with .call.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalSearch = WebSearch.prototype.search;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRead = ResearchPageReader.prototype.read;
const searchOrigin = process.env.WEB_SEARCH_ORIGIN;
process.env.WEB_SEARCH_ORIGIN = searchOrigin || "http://127.0.0.1:8080";
WebSearch.prototype.search = async function (query, signal, engine) {
  if (query.startsWith("B5 ")) {
    const fixture = new WebSearch("http://127.0.0.1:8080", () =>
      Promise.resolve(
        query === "B5 сбой поиска"
          ? new Response(null, { status: 503 })
          : Response.json({
              results:
                query === "B5 код демо-архива"
                  ? [
                      {
                        title: "Демо-архив",
                        url: "https://example.org/b5/archive",
                        content: "Код архива — B5-047."
                      }
                    ]
                  : []
            })
      )
    );
    return originalSearch.call(fixture, query, signal);
  }
  if (query === researchQuestion) {
    return {
      query,
      searched_at: new Date().toISOString(),
      items: [{ title: "Архив лунной станции", url: researchUrl, snippet: "" }]
    };
  }
  if (!searchOrigin) throw new Error("Search unavailable");
  return originalSearch.call(this, query, signal, engine);
};
ResearchPageReader.prototype.read = function (url, signal) {
  if (url === researchUrl) {
    return Promise.resolve(researchEvidence + " Запись подтверждена реестром станции.");
  }
  return originalRead.call(this, url, signal);
};

// Only the Playwright server imports this fixture. Keep the real HTTP server,
// coordinator and SQLite lifecycle; hold this synthetic provider response until
// Stop reaches the executor so reload acceptance never races a one-second answer.
const provider = new MockProviderAdapter("slow_stream");
const stream = provider.stream.bind(provider);
MockProviderAdapter.prototype.stream = async function* (request, signal) {
  const prompt = [...request.messages].reverse().find((message) => message.role === "user");
  if (prompt?.content.startsWith("B5 ")) {
    const input = prompt.content;
    if (input.startsWith("B5 ожидание")) {
      yield { type: "text.delta", delta: "B5 ожидает остановки." };
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("B5 fixture stopped"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return;
    }
    const answer =
      input.includes("[kosmora_web_search]") &&
      input.includes("B5-047") &&
      input.includes("https://example.org/b5/archive")
        ? "Код архива — B5-047. [Демо-архив](https://example.org/b5/archive)"
        : input.includes("kind: explain")
          ? "Дисперсия показывает разброс значений вокруг среднего."
          : input.includes("kind: hint")
            ? "Сначала раздели обе части уравнения на 2."
            : input.includes("kind: walkthrough")
              ? "Разделим обе части на 2: x + 3 = 5. Вычтем 3: x = 2."
              : input.includes("kind: check")
                ? "При x = 3 левая часть равна 12. Верный ответ x = 2."
                : input.includes("kind: rewrite") &&
                    input.includes("tone: деловой") &&
                    input.includes("length: shorter") &&
                    input.includes("Ответьте, пожалуйста, сегодня.")
                  ? "Просим ответить сегодня."
                  : "Обычный ответ B5.";
    yield { type: "text.delta", delta: answer };
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 40, outputTokens: 20 }
    };
    return;
  }
  if (prompt?.content === "Покажи тестовый Markdown") {
    yield {
      type: "text.delta",
      delta:
        "# Результат\n\n```ts\nexport const value = 42;\n```\n\n| Этап | Статус |\n| --- | --- |\n| Код | Готов |\n\n[Источник](https://example.org/docs)\n\n![Скрытый пиксель](https://example.org/tracking.png)\n\n<script>alert(1)</script>\n"
    };
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 8, outputTokens: 90 }
    };
    return;
  }
  if (prompt?.content === "Назови код из отчёта в материалах проекта.") {
    const reportAttached = request.messages.some(
      (message) =>
        message.content.includes(researchEvidence) && message.content.includes(researchUrl)
    );
    yield {
      type: "text.delta",
      delta: reportAttached ? "Код из отчёта: SELENE-047." : "Отчёт отсутствует в контексте."
    };
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 80, outputTokens: 12 }
    };
    return;
  }
  if (prompt?.content === "Останови этот тестовый запуск") {
    yield { type: "text.delta", delta: "Тестовый запуск ожидает остановки." };
    await new Promise<void>((_resolve, reject) => {
      const abort = (): void => reject(new Error("Controlled E2E response aborted"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    return;
  }
  yield* stream(request, signal);
};

installChatReliabilityFixture();
installPresentationWorkFixture();
installSiteWorkFixture();
installGameWorkFixture();
await import("../../src/server.js");
