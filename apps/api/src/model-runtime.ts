import type { ServerConfig } from "@cosmora/config";
import { ManagerService } from "@cosmora/core";
import {
  AnthropicCompatibleAdapter,
  MockProviderAdapter,
  ModelGateway,
  OpenAICompatibleAdapter,
  type ModelProviderAdapter
} from "@cosmora/model-gateway";

export interface ModelRuntime {
  gateway: ModelGateway;
  manager: ManagerService;
}

export const buildModelRuntime = (config: ServerConfig): ModelRuntime => {
  const adapters: ModelProviderAdapter[] = [new MockProviderAdapter(config.mockProviderMode)];
  const preferredProvider = config.modelProvider === "mock" ? "mock" : "primary";

  if (config.modelProvider !== "mock") {
    if (!config.modelBaseUrl || !config.modelApiKey) {
      throw new Error("External model provider configuration is incomplete");
    }

    if (config.modelProvider === "openai-compatible") {
      adapters.push(
        new OpenAICompatibleAdapter({
          id: preferredProvider,
          baseUrl: config.modelBaseUrl,
          apiKey: config.modelApiKey,
          model: config.modelName
        })
      );
    } else {
      adapters.push(
        new AnthropicCompatibleAdapter({
          id: preferredProvider,
          baseUrl: config.modelBaseUrl,
          apiKey: config.modelApiKey,
          model: config.modelName
        })
      );
    }
  }

  return {
    gateway: new ModelGateway(adapters, config.modelFallbackToMock ? ["mock"] : []),
    manager: new ManagerService({
      preferredProvider,
      preferredModelAlias: config.modelName,
      fallbackAllowed: config.modelFallbackToMock,
      timeoutMs: config.managerTimeoutMs,
      maxOutputTokens: config.managerMaxOutputTokens
    })
  };
};
