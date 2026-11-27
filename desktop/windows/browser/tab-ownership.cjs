"use strict";

// "Stars" primitive: a per-tab ownership marker and a serialized queue of
// screen actions. Independent tabs/processes can own different work; an owned
// tab refuses actions from a different claimant until ownership is released.
// No Electron dependency — pure state machine, reusable by engine/shell and
// directly testable in the desktop fixture suite.

const OWNERS = Object.freeze({ AGENT: "agent", HUMAN: "human" });

class TabOwnershipError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function createTabOwnership({ now = Date.now } = {}) {
  const tabs = new Map();
  const queues = new Map();

  function ensure(tabId) {
    if (!tabs.has(tabId))
      tabs.set(tabId, { owner: null, claimant: null, starred: false, at: now(), generation: 0 });
    return tabs.get(tabId);
  }
  function get(tabId) {
    const state = tabs.get(tabId);
    if (!state) throw new TabOwnershipError("BROWSER_STALE");
    return { ...state };
  }
  function claim(tabId, owner, claimant) {
    if (!Object.values(OWNERS).includes(owner))
      throw new TabOwnershipError("BROWSER_OWNER_INVALID");
    const state = ensure(tabId);
    if (state.owner && (state.owner !== owner || state.claimant !== claimant))
      throw new TabOwnershipError("BROWSER_TAB_OWNED");
    state.owner = owner;
    state.claimant = claimant ?? null;
    state.starred = true;
    state.at = now();
    return get(tabId);
  }
  function release(tabId, owner, claimant) {
    const state = ensure(tabId);
    if (state.owner && (state.owner !== owner || state.claimant !== claimant))
      throw new TabOwnershipError("BROWSER_TAB_OWNED");
    state.owner = null;
    state.claimant = null;
    state.starred = false;
    state.at = now();
    return get(tabId);
  }
  function assertOwner(tabId, owner, claimant) {
    const state = get(tabId);
    if (state.owner && (state.owner !== owner || state.claimant !== claimant))
      throw new TabOwnershipError("BROWSER_TAB_OWNED");
    return state;
  }

  /** Serialize screen actions per tab; independent tabs do not block each other. */
  function enqueue(tabId, owner, claimant, action, run) {
    assertOwner(tabId, owner, claimant);
    const prior = queues.get(tabId) ?? Promise.resolve();
    const next = prior.then(async () => {
      assertOwner(tabId, owner, claimant);
      const result = await run();
      const state = ensure(tabId);
      state.generation++;
      state.at = now();
      return { action, result, generation: state.generation };
    });
    queues.set(
      tabId,
      next.catch(() => {})
    );
    return next;
  }
  function pending(tabId) {
    return queues.has(tabId);
  }
  function forget(tabId) {
    tabs.delete(tabId);
    queues.delete(tabId);
  }
  return {
    OWNERS,
    get,
    claim,
    release,
    assertOwner,
    enqueue,
    pending,
    forget,
    list: () => [...tabs.keys()]
  };
}

module.exports = { OWNERS, TabOwnershipError, createTabOwnership };
