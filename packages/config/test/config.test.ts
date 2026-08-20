import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/index.js";

describe("loadServerConfig", () => {
  it("loads zero-cost local defaults", () => {
    expect(loadServerConfig({})).toEqual({
      nodeEnv: "development",
      apiHost: "127.0.0.1",
      apiPort: 3100,
      webOrigin: "http://localhost:3000",
      databaseUrl: "file:./data/nexus.db",
      logLevel: "info",
      mockProviderMode: "success"
    });
  });

  it("parses an explicit port", () => {
    expect(loadServerConfig({ API_PORT: "4100" }).apiPort).toBe(4100);
  });

  it("rejects an invalid port without exposing values", () => {
    expect(() => loadServerConfig({ API_PORT: "99999" })).toThrow(
      "Invalid server configuration: /API_PORT"
    );
  });

  it("rejects an unknown mock mode", () => {
    expect(() => loadServerConfig({ MOCK_PROVIDER_MODE: "unsafe" })).toThrow(
      "Invalid server configuration: /MOCK_PROVIDER_MODE"
    );
  });
});
