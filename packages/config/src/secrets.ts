export type SecretName = "MODEL_API_KEY";

export interface GitHubTokenResolver {
  resolve(name: "GITHUB_TOKEN"): Promise<string | null>;
}

export interface SecretResolver {
  resolve(name: SecretName): Promise<string | null>;
}

export class EnvironmentSecretResolver implements SecretResolver, GitHubTokenResolver {
  readonly #environment: NodeJS.ProcessEnv;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#environment = environment;
  }

  async resolve(name: SecretName | "GITHUB_TOKEN"): Promise<string | null> {
    await Promise.resolve();
    const value = this.#environment[name];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }
}
