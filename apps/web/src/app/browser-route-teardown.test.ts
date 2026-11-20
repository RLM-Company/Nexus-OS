import { describe, expect, it } from "vitest";
import { isExpectedRouteTeardownError, settleRouteAction } from "./browser-route-teardown";

describe("browser route teardown policy", () => {
  it("recognises only known navigation/cancellation teardown errors", () => {
    expect(
      isExpectedRouteTeardownError(new Error("Target page, context or browser has been closed"))
    ).toBe(true);
    expect(
      isExpectedRouteTeardownError(new Error("route.continue: Request is already handled!"))
    ).toBe(true);
    expect(isExpectedRouteTeardownError(new Error("net::ERR_ABORTED"))).toBe(true);
    expect(isExpectedRouteTeardownError("Frame was detached")).toBe(true);
    expect(
      isExpectedRouteTeardownError({ message: "Navigation to '/' interrupted by another one" })
    ).toBe(true);

    // A genuine forwarding failure must not be mistaken for a teardown error.
    expect(isExpectedRouteTeardownError(new Error("route.continue: socket hang up"))).toBe(false);
    expect(isExpectedRouteTeardownError(new Error("ECONNRESET from the API fixture"))).toBe(false);
    expect(isExpectedRouteTeardownError(null)).toBe(false);
    expect(isExpectedRouteTeardownError(undefined)).toBe(false);
  });

  it("resolves when the route action succeeds", async () => {
    await expect(settleRouteAction(Promise.resolve(), () => false)).resolves.toBeUndefined();
  });

  it("tolerates a known teardown error", async () => {
    await expect(
      settleRouteAction(Promise.reject(new Error("Target page has been closed")), () => false)
    ).resolves.toBeUndefined();
  });

  it("tolerates a teardown error when the page is already closed", async () => {
    await expect(
      settleRouteAction(Promise.reject(new Error("unrecognised teardown wording")), () => true)
    ).resolves.toBeUndefined();
  });

  it("rethrows an unexpected failure instead of suppressing it", async () => {
    const failure = new Error("route.continue: socket hang up");
    await expect(settleRouteAction(Promise.reject(failure), () => false)).rejects.toBe(failure);
  });
});
