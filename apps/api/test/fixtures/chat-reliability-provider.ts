import { MockProviderAdapter } from "@cosmora/model-gateway";

export function installChatReliabilityFixture(): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = MockProviderAdapter.prototype.stream;
  MockProviderAdapter.prototype.stream = async function* (request, signal) {
    const prompt = request.messages.findLast((message) => message.role === "user")?.content;
    if (prompt === "Надёжность: длинный Markdown") {
      yield {
        type: "text.delta",
        delta:
          "# Большой результат\n\n" +
          "Абзац с **текстом** и Unicode 🛰️.\n\n".repeat(600) +
          "```ts\n" +
          "export const value = 42;\n".repeat(800) +
          "```\n\n| Этап | Статус |\n| --- | --- |\n| Код | Готов |\n"
      };
    } else if (prompt === "Надёжность: восстановление потока") {
      yield { type: "text.delta", delta: "Начало ответа. " };
      for (let i = 0; i < 10; i++) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new Error("Fixture stopped"));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, 900);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
        yield { type: "text.delta", delta: `Часть ${i + 1}. ` };
      }
    } else if (prompt?.startsWith("Останови этот тестовый запуск")) {
      yield { type: "text.delta", delta: "Тестовый запуск ожидает остановки." };
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("Fixture stopped"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return;
    } else if (prompt === "Покажи тестовый Markdown") {
      yield {
        type: "text.delta",
        delta:
          "# Результат\n\n```ts\nexport const value = 42;\n```\n\n| Этап | Статус |\n| --- | --- |\n| Код | Готов |\n\n[Источник](https://example.org/docs)\n\n![Пиксель](https://example.org/tracking.png)\n<script>alert(1)</script>"
      };
    } else {
      yield* original.call(this, request, signal);
      return;
    }
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 8, outputTokens: 90 }
    };
  };
}
