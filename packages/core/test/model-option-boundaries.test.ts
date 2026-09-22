import { describe, expect, it } from "vitest";
import { ChatService, ManagerService } from "../src/index.js";

type ServiceFactory = (preferredProvider: string, preferredModelAlias: string) => unknown;

const services: Array<[string, ServiceFactory]> = [
  [
    "ManagerService",
    (preferredProvider, preferredModelAlias) =>
      new ManagerService({
        preferredProvider,
        preferredModelAlias,
        fallbackAllowed: false
      })
  ],
  [
    "ChatService",
    (preferredProvider, preferredModelAlias) =>
      new ChatService({
        preferredProvider,
        preferredModelAlias,
        fallbackAllowed: false
      })
  ]
];

describe("direct model option length boundaries", () => {
  it.each(services)("%s accepts contract maximum routing lengths", (_name, createService) => {
    expect(() => createService("p".repeat(128), "m".repeat(256))).not.toThrow();
  });

  it.each(services)("%s rejects provider names above 128 characters", (_name, createService) => {
    expect(() => createService("p".repeat(129), "manager")).toThrow(
      "Invalid model request option: preferredProvider"
    );
  });

  it.each(services)("%s rejects model aliases above 256 characters", (_name, createService) => {
    expect(() => createService("mock", "m".repeat(257))).toThrow(
      "Invalid model request option: preferredModelAlias"
    );
  });
  it.each(services)("rejects non-strict maxCost objects", (_name, createService) => {
    const createWithExtraMaxCost = () => {
      if (_name === "ManagerService") {
        return new ManagerService({
          preferredProvider: "mock",
          preferredModelAlias: "manager",
          fallbackAllowed: false,
          maxCost: { amount: 1, currency: "USD", unexpected: true } as never
        });
      }

      return new ChatService({
        preferredProvider: "mock",
        preferredModelAlias: "chat",
        fallbackAllowed: false,
        maxCost: { amount: 1, currency: "USD", unexpected: true } as never
      });
    };

    expect(createWithExtraMaxCost).toThrow("Invalid model request option: maxCost");
    expect(createService).toBeTypeOf("function");
  });
});
