import { describe, expect, it } from "vitest";
import { EnvironmentSecretResolver } from "../src/index.js";

describe("EnvironmentSecretResolver", () => {
  it("resolves an allowed secret only at the composition boundary", async () => {
    const resolver = new EnvironmentSecretResolver({
      MODEL_API_KEY: "runtime-only-value",
      GITHUB_TOKEN: "github-runtime-only-value"
    });

    await expect(resolver.resolve("MODEL_API_KEY")).resolves.toBe("runtime-only-value");
    await expect(resolver.resolve("GITHUB_TOKEN")).resolves.toBe("github-runtime-only-value");
  });

  it("treats missing and empty values as unavailable", async () => {
    await expect(new EnvironmentSecretResolver({}).resolve("MODEL_API_KEY")).resolves.toBeNull();
    await expect(
      new EnvironmentSecretResolver({ MODEL_API_KEY: "" }).resolve("MODEL_API_KEY")
    ).resolves.toBeNull();
  });

  it("treats whitespace-only values as unavailable without mutating real secrets", async () => {
    await expect(
      new EnvironmentSecretResolver({ MODEL_API_KEY: "   " }).resolve("MODEL_API_KEY")
    ).resolves.toBeNull();
    await expect(
      new EnvironmentSecretResolver({ MODEL_API_KEY: " runtime-only-value " }).resolve(
        "MODEL_API_KEY"
      )
    ).resolves.toBe(" runtime-only-value ");
  });
});
