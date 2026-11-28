"use strict";

/**
 * Device-wide action lease for one native cursor/keyboard focus.
 *
 * Why: `tab-ownership.cjs` already protects a single tab from two claimants and
 * allows independent DOM work in different tabs. What was missing is the
 * *device* level: exactly one agent may drive the shared native focus at a
 * time, human input always wins, and an agent never moves the cursor/focus
 * while a lease belongs to someone else.
 *
 * Scope: this is a pure state machine (no Electron, no timers). Engine/shell
 * call it around native input actions; DOM-only reads in isolated contexts do
 * not need the lease. It grants no new permissions — it only orders access to
 * a resource the caller already controls.
 */

const LEASE_KIND = Object.freeze({
  NATIVE: "native", // moves the system cursor/focus; exclusive device-wide
  DOM: "dom" // isolated renderer context; may run concurrently in different tabs
});

const PRIORITY = Object.freeze({ human: 2, agent: 1 });

class DeviceLeaseError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * @param {{ now?: () => number }} [options]
 */
function createDeviceLease({ now = Date.now } = {}) {
  // The single native focus slot. Exactly one holder at a time.
  let native = null;
  // FIFO queue of waiters for the native slot (priority: human over agent).
  const waiters = [];
  // Active DOM leases keyed by an opaque isolation context (e.g. tab id).
  const dom = new Map();
  let generation = 0;
  let stopped = false;

  const snapshot = (entry) =>
    entry ? { ...entry, at: entry.at, generation: entry.generation } : null;

  function emit() {
    // state() is read by the engine; no external callback here so the module
    // stays pure and deterministic in fixture tests.
    generation++;
  }

  function insertWaiter(waiter) {
    // Humans jump the queue of agents; order is otherwise FIFO.
    const at = waiters.findIndex((w) => PRIORITY[w.priority] < PRIORITY[waiter.priority]);
    if (at < 0) waiters.push(waiter);
    else waiters.splice(at, 0, waiter);
  }

  function drain() {
    if (stopped || native || waiters.length === 0) return;
    const next = waiters.shift();
    if (next.resolve === undefined) {
      // A cancel() waiter that was already resolved: skip defensively.
      return drain();
    }
    if (next.signal?.aborted) return drain();
    native = {
      holder: next.holder,
      owner: next.owner,
      priority: next.priority,
      kind: LEASE_KIND.NATIVE,
      reason: next.reason ?? null,
      at: now(),
      generation
    };
    next.cleanup?.();
    next.resolve(snapshot(native));
    emit();
  }

  /**
   * Acquire the native focus. Returns a Promise that resolves to a lease handle
   * when the slot is free, or rejects on abort/stop with a typed error.
   * `reason` is a human-readable operation label for diagnostics only.
   */
  function acquireNative({ holder, owner, priority = "agent", reason = null, signal }) {
    if (stopped) return Promise.reject(new DeviceLeaseError("DEVICE_STOPPED"));
    if (!holder || !["agent", "human"].includes(priority))
      return Promise.reject(new DeviceLeaseError("DEVICE_LEASE_INVALID"));
    if (signal?.aborted) return Promise.reject(new DeviceLeaseError("DEVICE_LEASE_ABORTED"));

    // Re-entrant acquisition by the current holder returns the same handle.
    // Validation above still applies (e.g. an invalid priority is rejected even
    // for the holding agent), so no unvalidated shortcut exists.
    if (native && native.holder === holder && native.owner === owner) {
      return Promise.resolve(snapshot(native));
    }

    return new Promise((resolve, reject) => {
      const waiter = { holder, owner, priority, reason, signal, resolve, reject };
      insertWaiter(waiter);
      const onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new DeviceLeaseError("DEVICE_LEASE_ABORTED"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiter.cleanup = () => signal?.removeEventListener("abort", onAbort);
      drain();
    });
  }

  /** Release a native lease. Only the holder (or a forced stop) may release it. */
  function releaseNative(holder, owner) {
    if (!native) return null;
    if (native.holder !== holder || native.owner !== owner)
      throw new DeviceLeaseError("DEVICE_LEASE_HELD_BY_OTHER");
    const released = snapshot(native);
    native = null;
    emit();
    drain();
    return released;
  }

  /**
   * Human takeover: the current holder is evicted regardless of priority and
   * all queued native waiters are cancelled. Pending actions must observe the
   * generation change and stop before any further input (no blind retries).
   */
  function takeOver({ holder = "local-user", owner, reason = "human takeover" } = {}) {
    const evicted = native ? snapshot(native) : null;
    native = null;
    for (const waiter of waiters.splice(0)) {
      waiter.cleanup?.();
      waiter.reject(new DeviceLeaseError("DEVICE_LEASE_TAKEN_OVER"));
    }
    native = {
      holder,
      owner: owner ?? holder,
      priority: "human",
      kind: LEASE_KIND.NATIVE,
      reason,
      at: now(),
      generation
    };
    emit();
    return { evicted, current: snapshot(native) };
  }

  /** Verify that a holder still owns the native slot before every native input. */
  function assertNative(holder, owner) {
    if (stopped) throw new DeviceLeaseError("DEVICE_STOPPED");
    if (!native || native.holder !== holder || native.owner !== owner)
      throw new DeviceLeaseError("DEVICE_LEASE_LOST");
    return snapshot(native);
  }

  /**
   * DOM-only leases are isolated by context (tab id). Two agents may hold DOM
   * leases in different contexts concurrently; they never touch native focus.
   */
  function acquireDom({ holder, owner, context }) {
    if (stopped) throw new DeviceLeaseError("DEVICE_STOPPED");
    if (!holder || !context) throw new DeviceLeaseError("DEVICE_LEASE_INVALID");
    const existing = dom.get(context);
    if (existing && (existing.holder !== holder || existing.owner !== owner))
      throw new DeviceLeaseError("DEVICE_LEASE_HELD_BY_OTHER");
    const lease = {
      holder,
      owner: owner ?? null,
      context,
      kind: LEASE_KIND.DOM,
      at: now(),
      generation
    };
    dom.set(context, lease);
    emit();
    return snapshot(lease);
  }

  function releaseDom(holder, context) {
    const existing = dom.get(context);
    if (!existing) return null;
    if (existing.holder !== holder) throw new DeviceLeaseError("DEVICE_LEASE_HELD_BY_OTHER");
    dom.delete(context);
    emit();
    return snapshot(existing);
  }

  /** Called on disconnect/stop: cancel waiters, drop all leases, block new ones. */
  function stop() {
    stopped = true;
    const evicted = native ? snapshot(native) : null;
    native = null;
    for (const waiter of waiters.splice(0)) {
      waiter.cleanup?.();
      waiter.reject(new DeviceLeaseError("DEVICE_STOPPED"));
    }
    dom.clear();
    emit();
    return { evicted };
  }

  function state() {
    return {
      native: snapshot(native),
      waiting: waiters.map((w) => ({
        holder: w.holder,
        owner: w.owner,
        priority: w.priority,
        reason: w.reason ?? null
      })),
      dom: [...dom.values()].map(snapshot),
      generation,
      stopped
    };
  }

  return {
    LEASE_KIND,
    acquireNative,
    releaseNative,
    takeOver,
    assertNative,
    acquireDom,
    releaseDom,
    stop,
    state
  };
}

module.exports = { DeviceLeaseError, LEASE_KIND, createDeviceLease };
