// Playwright tears down in-flight browser routes during navigation and
// cancellation. Those two errors are an expected part of a reliability
// fixture that deliberately reloads the page while a request is held; every
// other failure (for example a real forwarding error) must still fail the
// test instead of being swallowed by `.catch(() => undefined)`.
//
// This is the shared rule behind the "no suppressed errors" cleanup of the
// browser route handlers: keep the expectation narrow and let unexpected
// errors propagate to Playwright.
const ROUTE_TEARDOWN_PATTERNS: readonly RegExp[] = [
  // "Target page, context or browser has been closed" / "Target closed".
  /^target\s+(?:page|context|browser)[^\n]*\bclosed\b/i,
  /^target closed\b/i,
  /request is already handled/i,
  /request (?:was )?(?:cancelled|aborted|interrupted)/i,
  /net::ERR_ABORTED/i,
  /route is already handled/i,
  /frame was detached/i,
  /navigation [^\n]* interrupted/i
];

/** True only for errors produced by Playwright tearing down an in-flight route. */
export function isExpectedRouteTeardownError(error: unknown): boolean {
  let message = "";
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  else if (error != null && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") message = value;
  }
  return ROUTE_TEARDOWN_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Await a route action, tolerating only the navigation/cancellation teardown
 * errors. Any other error is rethrown so the test fails. If the action resolves
 * normally, `pageClosed` is not consulted.
 */
export async function settleRouteAction(
  action: Promise<unknown>,
  pageClosed: () => boolean
): Promise<void> {
  try {
    await action;
  } catch (error) {
    if (isExpectedRouteTeardownError(error) || pageClosed()) return;
    throw error;
  }
}
