import { EnvironmentSecretResolver, type SecretResolver, type ServerConfig } from "@cosmora/config";
import { ModelRegistryDocumentSchema, type ModelRegistryDocument } from "@cosmora/contracts";
import { ManagerService } from "@cosmora/core";
import {
  AnthropicCompatibleAdapter,
  MockProviderAdapter,
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  OpenAICompatibleAdapter,
  type ModelProviderAdapter
} from "@cosmora/model-gateway";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";

const DEFAULT_REGISTRY_PATH = fileURLToPath(
  new URL("../../../config/model-registry.v1.json", import.meta.url)
);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface ModelRuntime {
  gateway: ModelGateway;
  manager: ManagerService;
  registryVersion: string;
}

export interface ModelRuntimeOptions {
  registryDocument?: ModelRegistryDocument;
  secretResolver?: SecretResolver;
}

export const loadModelRegistryDocument = (path: string): ModelRegistryDocument => {
  const resolvedPath = isAbsolute(path) ? path : resolve(REPOSITORY_ROOT, path);
  let candidate: unknown;
  try {
    candidate = JSON.parse(readFileSync(resolvedPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Failed to read Model Registry from ${path} (resolved to ${resolvedPath})`, {
      cause: error
    });
  }
  if (!Value.Check(ModelRegistryDocumentSchema, candidate)) {
    throw new Error(`Invalid Model Registry document at ${path}`);
  }
  return candidate;
};

export const buildModelRuntime = async (
  config: ServerConfig,
  options: ModelRuntimeOptions = {}
): Promise<ModelRuntime> => {
  const document =
    options.registryDocument ??
    loadModelRegistryDocument(config.modelRegistryPath ?? DEFAULT_REGISTRY_PATH);
  const registry = new ModelRegistry(document);
  const router = new ModelRouter(registry);
  const adapters: ModelProviderAdapter[] = [new MockProviderAdapter(config.mockProviderMode)];
  const preferredProvider = config.modelProviderId;

  if (config.modelProvider !== "mock") {
    const apiKey = await (options.secretResolver ?? new EnvironmentSecretResolver()).resolve(
      "MODEL_API_KEY"
    );
    if (!config.modelBaseUrl || !apiKey) {
      throw new Error("External model provider configuration is incomplete");
    }
    const registered = registry.get(preferredProvider, config.modelName);
    if (
      !registered ||
      registered.status !== "active" ||
      registered.protocol !== config.modelProvider
    ) {
      throw new Error(
        `Configured route ${preferredProvider}:${config.modelName} is not active in Model Registry ${registry.version}`
      );
    }

    if (config.modelProvider === "openai-compatible") {
      adapters.push(
        new OpenAICompatibleAdapter({
          id: preferredProvider,
          baseUrl: config.modelBaseUrl,
          apiKey,
          model: config.modelName
        })
      );
    } else {
      adapters.push(
        new AnthropicCompatibleAdapter({
          id: preferredProvider,
          baseUrl: config.modelBaseUrl,
          apiKey,
          model: config.modelName
        })
      );
    }
  }

  return {
    gateway: new ModelGateway(
      adapters,
      router,
      config.modelFallbackToMock && preferredProvider !== "mock" ? ["mock"] : [],
      {
        maxAttemptsPerRoute: config.modelMaxAttemptsPerRoute,
        retryBaseDelayMs: config.modelRetryBaseDelayMs,
        retryMaxDelayMs: config.modelRetryMaxDelayMs,
        circuitFailureThreshold: config.modelCircuitFailureThreshold,
        circuitOpenMs: config.modelCircuitOpenMs
      }
    ),
    manager: new ManagerService({
      preferredProvider,
      preferredModelAlias: config.modelName,
      fallbackAllowed: config.modelFallbackToMock,
      timeoutMs: config.managerTimeoutMs,
      maxOutputTokens: config.managerMaxOutputTokens
    }),
    registryVersion: registry.version
  };
};
