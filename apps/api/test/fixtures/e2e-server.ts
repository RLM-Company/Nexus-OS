import { MockProviderAdapter } from "@cosmora/model-gateway";

// Only the Playwright server imports this fixture. Keep the real HTTP server,
// coordinator and SQLite lifecycle; hold this synthetic provider response until
// Stop reaches the executor so reload acceptance never races a one-second answer.
const provider = new MockProviderAdapter("slow_stream");
const stream = provider.stream.bind(provider);
MockProviderAdapter.prototype.stream = async function* (request, signal) {
  const prompt = [...request.messages].reverse().find((message) => message.role === "user");
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

await import("../../src/server.js");
