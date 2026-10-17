import { MockProviderAdapter } from "@cosmora/model-gateway";

/** Installed only by the local integration server. Never changes a live provider. */
export function installPresentationWorkFixture(): void {
  // Rebound explicitly with .call(this, ...) below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const stream = MockProviderAdapter.prototype.stream;
  MockProviderAdapter.prototype.stream = async function* (request, signal) {
    const matching = request.messages.some(
      (message) =>
        typeof message.content === "string" && message.content.includes("E2E_PRESENTATION_WORK")
    );
    if (!matching || !request.task_type.startsWith("manager_work_")) {
      yield* stream.call(this, request, signal);
      return;
    }
    if (signal.aborted) throw Error("Aborted fixture");
    const result =
      request.task_type === "manager_work_plan"
        ? {
            summary: "Тестовые слайды",
            instructions: "E2E_PRESENTATION_WORK: create presentation.json",
            complexity: "simple",
            needs_critic: true,
            requires_external_actions: false
          }
        : request.task_type === "manager_work_draft"
          ? {
              files: [
                {
                  name: "presentation.json",
                  content: JSON.stringify({
                    format: "kosmora-presentation-v1",
                    title: "Проверка слайдов",
                    theme: "paper",
                    slides: [
                      {
                        id: "s1",
                        layout: "title",
                        title: "Законы Ньютона",
                        body: "Тестовый ответ, живая модель не вызывалась",
                        aside: "",
                        notes: "Заметки & <текст>"
                      },
                      {
                        id: "s2",
                        layout: "content",
                        title: "Второй закон",
                        body: "F = ma",
                        aside: "",
                        notes: "Единицы СИ"
                      },
                      {
                        id: "s3",
                        layout: "two-column",
                        title: "Сравнение",
                        body: "Действие",
                        aside: "Противодействие",
                        notes: "Разные тела"
                      }
                    ]
                  })
                }
              ]
            }
          : { verdict: "PASS", reason: "Синтетическая проверка fixture, не оценка живой модели" };
    yield { type: "text.delta", delta: JSON.stringify(result) };
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 100 }
    };
  };
}
