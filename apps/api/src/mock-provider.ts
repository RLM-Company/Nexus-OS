import type { ServerConfig } from "@nexus/config";

export const MOCK_PROVIDER = "nexus-mock";
export const MOCK_MODEL = "manager-b0.1";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const summarize = (prompt: string): string => {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
};

export const streamMockResponse = async function* (
  prompt: string,
  mode: ServerConfig["mockProviderMode"]
): AsyncGenerator<string> {
  if (mode === "provider_error") throw new Error("Mock provider error");
  if (mode === "timeout") {
    await delay(80);
    throw new Error("Mock provider timeout");
  }

  const pause = mode === "slow_stream" ? 260 : 35;
  const parts = [
    "Принял задачу. ",
    `В проекте зафиксирована цель: «${summarize(prompt)}». `,
    "Сейчас Nexus работает в безопасном mock-режиме: сообщение уже сохранено в локальной базе, а этот ответ передаётся потоком. ",
    "Следующий этап подключит настоящего менеджера и исполнителей через Model Gateway."
  ];

  for (const part of parts) {
    await delay(pause);
    yield part;
  }
};
