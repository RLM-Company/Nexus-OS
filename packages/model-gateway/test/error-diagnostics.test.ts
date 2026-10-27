import { describe, expect, it } from "vitest";
import { GatewayRunError } from "../src/index.js";

describe("safe operator diagnostics", () => {
  it("identifies HTTP failure status without requiring a raw error body", () => {
    const error = new GatewayRunError("PROVIDER_ERROR", "test", "Provider returned HTTP 429", true);
    expect(error.diagnostic).toBe("HTTP_429");
    expect(error.retryable).toBe(true);
  });

  it("distinguishes protocol failures from incomplete text output", () => {
    const error = new GatewayRunError(
      "PROVIDER_ERROR",
      "test",
      "Provider stream did not finish a non-empty text response",
      false
    );
    expect(error.diagnostic).toBe("INCOMPLETE_TEXT_RESPONSE");
    expect(
      new GatewayRunError(
        "PROVIDER_ERROR",
        "test",
        "Provider returned invalid streaming JSON",
        false
      ).diagnostic
    ).toBe("INVALID_STREAM_JSON");
  });

  it("does not serialize arbitrary provider text, private request data or exception causes", () => {
    const secret = "private request and credential fixture";
    for (const message of [
      secret,
      `Provider returned HTTP 400: ${secret}`,
      `Provider returned HTTP 400\n${secret}`
    ]) {
      const error = new GatewayRunError("PROVIDER_ERROR", "test", message, false, {
        cause: new Error(secret)
      });
      expect(error.diagnostic).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain("message");
      expect(JSON.stringify(error)).not.toContain("cause");
    }
  });

  it("leaves unrecognized gateway errors without a speculative diagnosis", () => {
    expect(
      new GatewayRunError("ROUTE_UNAVAILABLE", "gateway", "No model route available", false)
        .diagnostic
    ).toBeUndefined();
    for (const message of ["__proto__", "constructor", "toString"]) {
      expect(
        new GatewayRunError("PROVIDER_ERROR", "test", message, false).diagnostic
      ).toBeUndefined();
    }
    expect(
      new GatewayRunError("ROUTE_UNAVAILABLE", "test", "Provider returned HTTP 400", false)
        .diagnostic
    ).toBeUndefined();
  });
});
