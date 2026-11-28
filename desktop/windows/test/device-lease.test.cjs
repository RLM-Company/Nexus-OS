"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DeviceLeaseError, LEASE_KIND, createDeviceLease } = require("../browser/device-lease.cjs");

const agent = (lease, holder, owner = "koswork", reason = "click") =>
  lease.acquireNative({ holder, owner, priority: "agent", reason });

test("one native focus has exactly one holder; a second agent queues", async () => {
  const lease = createDeviceLease();
  const first = await agent(lease, "runner-a");
  assert.equal(first.holder, "runner-a");
  assert.equal(first.priority, "agent");
  let secondResolved = false;
  const second = agent(lease, "runner-b").then((h) => {
    secondResolved = true;
    return h;
  });
  await Promise.resolve();
  assert.equal(secondResolved, false, "runner-b must wait, not grab native focus");
  assert.equal(lease.state().waiting.length, 1);
  assert.throws(
    () => lease.assertNative("runner-b", "koswork"),
    (e) => e instanceof DeviceLeaseError && e.code === "DEVICE_LEASE_LOST"
  );
  lease.releaseNative("runner-a", "koswork");
  const granted = await second;
  assert.equal(granted.holder, "runner-b");
  assert.equal(granted.generation > first.generation, true);
  lease.releaseNative("runner-b", "koswork");
  assert.equal(lease.state().native, null);
});

test("human takeover evicts the holding agent and cancels queued agents", async () => {
  const lease = createDeviceLease();
  await agent(lease, "runner-a");
  const queued = agent(lease, "runner-b");
  const rejected = assert.rejects(queued, (e) => e.code === "DEVICE_LEASE_TAKEN_OVER");
  const taken = lease.takeOver({ holder: "local-user", reason: "human input" });
  assert.equal(taken.evicted.holder, "runner-a");
  assert.equal(taken.current.priority, "human");
  assert.equal(lease.state().waiting.length, 0, "human takeover clears the queue");
  assert.throws(
    () => lease.assertNative("runner-a", "koswork"),
    (e) => e.code === "DEVICE_LEASE_LOST"
  );
  await rejected;
});

test("human waiter jumps ahead of an agent waiter", async () => {
  const lease = createDeviceLease();
  await agent(lease, "runner-a");
  const agentWait = agent(lease, "runner-b");
  const humanWait = lease.acquireNative({
    holder: "local-user",
    owner: "local-user",
    priority: "human"
  });
  assert.deepEqual(
    lease.state().waiting.map((w) => w.priority),
    ["human", "agent"]
  );
  lease.releaseNative("runner-a", "koswork");
  const human = await humanWait;
  assert.equal(human.holder, "local-user");
  lease.releaseNative("local-user", "local-user");
  const later = await agentWait;
  assert.equal(later.holder, "runner-b");
  lease.releaseNative("runner-b", "koswork");
});

test("abort and disconnect never leave a late input path open", async () => {
  const lease = createDeviceLease();
  await agent(lease, "runner-a");
  const controller = new AbortController();
  const waiting = lease.acquireNative({
    holder: "runner-b",
    owner: "koswork",
    priority: "agent",
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(waiting, (e) => e.code === "DEVICE_LEASE_ABORTED");
  lease.releaseNative("runner-a", "koswork");
  const active = await agent(lease, "runner-c");
  const stopped = lease.stop();
  assert.equal(stopped.evicted.holder, "runner-c");
  assert.throws(
    () => lease.assertNative("runner-c", "koswork"),
    (e) => e.code === "DEVICE_STOPPED"
  );
  await assert.rejects(agent(lease, "runner-d"), (e) => e.code === "DEVICE_STOPPED");
  assert.equal(lease.state().stopped, true);
});

test("DOM leases are isolated by context and never touch native focus", async () => {
  const lease = createDeviceLease();
  await agent(lease, "runner-a");
  const domA = lease.acquireDom({ holder: "runner-a", owner: "koswork", context: "tab-a" });
  const domB = lease.acquireDom({ holder: "runner-b", owner: "stars", context: "tab-b" });
  assert.equal(domA.kind, LEASE_KIND.DOM);
  assert.equal(lease.state().dom.length, 2);
  assert.equal(lease.state().native.holder, "runner-a", "native holder unchanged");
  assert.throws(
    () => lease.acquireDom({ holder: "runner-b", owner: "stars", context: "tab-a" }),
    (e) => e.code === "DEVICE_LEASE_HELD_BY_OTHER"
  );
  assert.equal(lease.releaseDom("runner-a", "tab-a").holder, "runner-a");
  lease.releaseNative("runner-a", "koswork");
  lease.releaseDom("runner-b", "tab-b");
  assert.equal(lease.state().dom.length, 0);
});

test("re-entrant acquisition by the holder is a no-op; wrong owner cannot release", async () => {
  const lease = createDeviceLease();
  const first = await agent(lease, "runner-a");
  const again = await agent(lease, "runner-a");
  assert.equal(again.generation, first.generation);
  assert.throws(
    () => lease.releaseNative("runner-a", "stars"),
    (e) => e.code === "DEVICE_LEASE_HELD_BY_OTHER"
  );
  await assert.rejects(
    lease.acquireNative({ holder: "runner-a", owner: "koswork", priority: "invalid" }),
    (e) => e.code === "DEVICE_LEASE_INVALID"
  );
  lease.releaseNative("runner-a", "koswork");
});
