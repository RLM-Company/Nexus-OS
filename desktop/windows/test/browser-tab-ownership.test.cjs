"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { OWNERS, TabOwnershipError, createTabOwnership } = require("../browser/tab-ownership.cjs");

test("a tab can be claimed by an agent or handed to the human", () => {
  const ownership = createTabOwnership();
  const claimed = ownership.claim("tab-a", OWNERS.AGENT, "runner-1");
  assert.equal(claimed.owner, "agent");
  assert.equal(claimed.starred, true);
  const handed = ownership.release("tab-a", OWNERS.AGENT, "runner-1");
  assert.equal(handed.owner, null);
  assert.equal(handed.starred, false);
  ownership.claim("tab-a", OWNERS.HUMAN, "local-user");
  assert.equal(ownership.get("tab-a").owner, "human");
});

test("a different claimant cannot act on an owned tab", () => {
  const ownership = createTabOwnership();
  ownership.claim("tab-a", OWNERS.AGENT, "runner-1");
  assert.throws(
    () => ownership.claim("tab-a", OWNERS.AGENT, "runner-2"),
    (error) => error instanceof TabOwnershipError && error.code === "BROWSER_TAB_OWNED"
  );
  assert.throws(
    () => ownership.assertOwner("tab-a", OWNERS.AGENT, "runner-2"),
    /BROWSER_TAB_OWNED/
  );
  assert.throws(() => ownership.get("missing"), /BROWSER_STALE/);
});

test("screen actions are serialized per tab and independent tabs do not block", async () => {
  const ownership = createTabOwnership();
  const order = [];
  ownership.claim("tab-a", OWNERS.AGENT, "runner-1");
  ownership.claim("tab-b", OWNERS.AGENT, "runner-1");
  const first = ownership.enqueue("tab-a", OWNERS.AGENT, "runner-1", "focus", async () => {
    order.push("a-start");
    await new Promise((done) => setTimeout(done, 20));
    order.push("a-end");
    return "a";
  });
  const second = ownership.enqueue("tab-a", OWNERS.AGENT, "runner-1", "click", async () => {
    order.push("a-click");
    return "b";
  });
  const other = ownership.enqueue("tab-b", OWNERS.AGENT, "runner-1", "fill", async () => {
    order.push("b");
    return "c";
  });
  assert.deepEqual(
    (await Promise.all([first, second, other])).map((r) => r.result),
    ["a", "b", "c"]
  );
  assert.deepEqual(order, ["a-start", "b", "a-end", "a-click"]);
  assert.equal(ownership.get("tab-a").generation, 2);
  assert.equal(ownership.get("tab-b").generation, 1);
});

test("a released tab has no owner until claimed again", () => {
  const ownership = createTabOwnership();
  ownership.claim("tab-a", OWNERS.AGENT, "runner-1");
  const released = ownership.release("tab-a", OWNERS.AGENT, "runner-1");
  assert.equal(released.owner, null);
  // No owner means any claimant may act until a new owner claims the tab.
  assert.doesNotThrow(() => ownership.assertOwner("tab-a", OWNERS.AGENT, "runner-1"));
  ownership.claim("tab-a", OWNERS.HUMAN, "local-user");
  assert.equal(ownership.get("tab-a").owner, "human");
});
