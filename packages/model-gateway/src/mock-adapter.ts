import type { ModelRequest } from "@cosmora/contracts";
import { GatewayRunError, type ModelProviderAdapter, type ProviderStreamEvent } from "./types.js";

export type MockProviderMode =
  | "success"
  | "slow_stream"
  | "timeout"
  | "provider_error"
  | "disconnect_after_delta"
  | "invalid_sequence"
  | "cancel"
  | "duplicate_request";

export const MOCK_PROVIDER_ID = "mock";
export const MOCK_MODEL_ID = "manager-b0.1";

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Mock stream aborted"));
      },
      { once: true }
    );
  });

const lastUserMessage = (request: ModelRequest): string =>
  [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";

const summarize = (prompt: string): string => {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
};

export class MockProviderAdapter implements ModelProviderAdapter {
  readonly id = MOCK_PROVIDER_ID;
  readonly modelId = MOCK_MODEL_ID;
  readonly #mode: MockProviderMode;

  constructor(mode: MockProviderMode = "success") {
    this.#mode = mode;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamEvent> {
    if (this.#mode === "provider_error") {
      throw new GatewayRunError("PROVIDER_ERROR", this.id, "Mock provider error", true);
    }
    if (this.#mode === "timeout") {
      await delay(request.constraints.timeout_ms + 50, signal);
      return;
    }

    const prompt = lastUserMessage(request);
    const pause = this.#mode === "slow_stream" ? 260 : 35;
    const workResponse =
      request.task_type === "manager_work_plan"
        ? JSON.stringify({
            summary: "Подготовить демонстрационный файл",
            instructions: "Создать result.md с явной пометкой mock",
            complexity: "simple",
            needs_critic: true,
            requires_external_actions: false
          })
        : request.task_type === "manager_work_draft"
          ? JSON.stringify({
              files: [
                {
                  name: "result.md",
                  content:
                    "# Kosmora mock\n\nЭто демонстрационный файл. Живая модель не вызывалась."
                }
              ]
            })
          : request.task_type === "manager_work_review"
            ? JSON.stringify({
                verdict: "PASS",
                reason: "Демонстрационная проверка mock-результата; не оценка живой модели."
              })
            : null;
    const parts = workResponse
      ? [workResponse]
      : request.task_type === "chat_response"
        ? [
            "Принял сообщение. ",
            `Запрос обычного чата: «${summarize(prompt)}». `,
            "Сейчас Kosmora работает в безопасном mock-режиме: история сохранена на сервере, а ответ передаётся потоком. ",
            "После подключения ключа этот же чат будет отвечать через настроенный Model Gateway."
          ]
        : [
            "Принял задачу. ",
            `В проекте зафиксирована цель: «${summarize(prompt)}». `,
            "Сейчас Kosmora работает в безопасном mock-режиме: сообщение уже сохранено в локальной базе, а этот ответ передаётся потоком. ",
            "Следующий этап подключит настоящего менеджера и исполнителей через Model Gateway."
          ];

    for (const [index, part] of parts.entries()) {
      await delay(pause, signal);
      yield { type: "text.delta", delta: part };
      if (this.#mode === "disconnect_after_delta" && index === 0) {
        throw new GatewayRunError("PROVIDER_ERROR", this.id, "Mock stream disconnected", true);
      }
    }

    yield {
      type: "response.completed",
      provider: this.id,
      model: MOCK_MODEL_ID,
      finishReason: "stop",
      usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: 72 }
    };
  }
}
