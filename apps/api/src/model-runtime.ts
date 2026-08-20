import type { ServerConfig } from "@nexus/config";
import { ManagerService } from "@nexus/core";
import {
  MockProviderAdapter,
  ModelGateway,
  OpenAICompatibleAdapter,
  type ModelProviderAdapter
} from "@nexus/model-gateway";

export interface ModelRuntime {
  gateway: ModelGateway;
  manager: ManagerService;
}

export const buildModelRuntime = (config: ServerConfig): ModelRuntime => {
  const adapters: ModelProviderAdapter[] = [new MockProviderAdapter(config.mockProviderMode)];
  const preferredProvider = config.modelProvider === "mock" ? "mock" : "primary";

  if (config.modelProvider === "openai-compatible") {
    if (!config.modelBaseUrl || !config.modelApiKey) {
      throw new Error("OpenAI-compatible provider configuration is incomplete");
    }
    adapters.push(
      new OpenAICompatibleAdapter({
        id: preferredProvider,
        baseUrl: config.modelBaseUrl,
        apiKey: config.modelApiKey,
        model: config.modelName
      })
    );
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
