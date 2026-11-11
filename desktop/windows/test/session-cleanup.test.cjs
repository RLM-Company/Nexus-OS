"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

const { clearBrowserSessionData } = require("../session-cleanup.cjs");

function recordingSession({ storageError = null, cacheError = null } = {}) {
  const calls = [];
  return {
    calls,
    fake: {
      async clearStorageData() {
        calls.push("clearStorageData");
        if (storageError) throw storageError;
      },
      async clearCache() {
        calls.push("clearCache");
        if (cacheError) throw cacheError;
      }
    }
  };
}

test("очистка сеанса выполняет storage и cache на одном сеансе и по порядку", async () => {
  const { calls, fake } = recordingSession();
  let getSessionCount = 0;
  await clearBrowserSessionData(() => {
    getSessionCount++;
    return fake;
  });
  assert.equal(getSessionCount, 1);
  assert.deepEqual(calls, ["clearStorageData", "clearCache"]);
});

test("ошибка clearStorageData не скрывается и не приводит к clearCache", async () => {
  const failure = new Error("storage refused");
  const { fake } = recordingSession({ storageError: failure });
  await assert.rejects(() => clearBrowserSessionData(() => fake), failure);
});

test("ошибка clearCache не скрывается", async () => {
  const failure = new Error("cache refused");
  const { fake } = recordingSession({ cacheError: failure });
  await assert.rejects(() => clearBrowserSessionData(() => fake), failure);
});
