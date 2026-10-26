import { MockProviderAdapter } from "@cosmora/model-gateway";

/** Deterministic transport only in the local Playwright server. */
export function installSiteWorkFixture() {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const previous = MockProviderAdapter.prototype.stream;
  MockProviderAdapter.prototype.stream = async function* (request, signal) {
    if (
      !request.task_type.startsWith("manager_work_") ||
      !request.messages.some((message) => message.content.includes("E2E_WEBSITE_WORK"))
    ) {
      yield* previous.call(this, request, signal);
      return;
    }
    if (signal.aborted) throw Error("Aborted site fixture");
    const value =
      request.task_type === "manager_work_plan"
        ? {
            summary: "Тестовый сайт",
            instructions: "Create a static index.html",
            complexity: "simple",
            needs_critic: false,
            requires_external_actions: false
          }
        : request.task_type === "manager_work_draft"
          ? {
              files: [
                {
                  name: "index.html",
                  content:
                    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>body{font:18px system-ui;background:#fafafa;color:#222}main{max-width:900px;margin:auto;padding:40px}h1{font-size:3em}@media(max-width:500px){h1{font-size:2em}}</style></head><body><main><h1>Студия Альфа</h1><p>Синтетический результат браузерного теста.</p></main></body></html>'
                }
              ]
            }
          : { verdict: "PASS", reason: "Synthetic fixture only" };
    yield { type: "text.delta", delta: JSON.stringify(value) };
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 100 }
    };
  };
}
