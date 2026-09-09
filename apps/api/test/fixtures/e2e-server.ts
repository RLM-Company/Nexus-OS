import { MockProviderAdapter } from "@cosmora/model-gateway";

// Only the Playwright server imports this fixture. Keep the real HTTP server,
// coordinator and SQLite lifecycle; hold this synthetic provider response until
// Stop reaches the executor so reload acceptance never races a one-second answer.
const stream = MockProviderAdapter.prototype.stream;
MockProviderAdapter.prototype.stream = async function* (request, signal) {
  const prompt = [...request.messages].reverse().find((message) => message.role === "user");
  if (prompt?.content === "Останови этот тестовый запуск") {
    yield { type: "text.delta", delta: "Тестовый запуск ожидает остановки." };
    await new Promise<void>((_resolve, reject) => {
      const abort = (): void => reject(new Error("Controlled E2E response aborted"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    return;
  }
  yield* stream.call(this, request, signal);
};

await import("../../src/server.js");
