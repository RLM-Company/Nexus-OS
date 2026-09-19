export type SecretName = "MODEL_API_KEY";

export interface SecretResolver {
  resolve(name: SecretName): Promise<string | null>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  readonly #environment: NodeJS.ProcessEnv;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#environment = environment;
  }

  async resolve(name: SecretName): Promise<string | null> {
    await Promise.resolve();
    const value = this.#environment[name];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }
}
