import { expect, it } from "vitest";
import {
  clearPendingCreation,
  pendingCreationKey,
  readPendingCreation,
  savePendingCreation
} from "./skill-creation";
const scope = "a".repeat(64),
  other = "b".repeat(64);
const pending = {
  requestId: "a1c163ee-105e-46fd-b9cc-35f4cc50252a",
  draft: { name: " История ", summary: " Анализ ", instructions: " Кириллица 😀\r\n<literal> " }
};
const normalized = {
  ...pending,
  draft: { name: "История", summary: "Анализ", instructions: "Кириллица 😀\r\n<literal>" }
};
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    }
  };
}
it("retains the exact normalized attempt across remounts without leaking into another owner scope", () => {
  const store = storage();
  expect(readPendingCreation(store, scope)).toBeNull();
  savePendingCreation(store, scope, pending);
  expect(readPendingCreation(store, scope)).toEqual(normalized);
  expect(readPendingCreation(store, other)).toBeNull();
  clearPendingCreation(store, other);
  expect(readPendingCreation(store, scope)).toEqual(normalized);
  clearPendingCreation(store, scope);
  expect(readPendingCreation(store, scope)).toBeNull();
});
it("fails closed on corrupt/oversized local attempts and invalid identity scopes", () => {
  const store = storage();
  for (const raw of [
    "broken",
    "null",
    JSON.stringify({ ...pending, requestId: "other" }),
    JSON.stringify({ ...pending, draft: { ...pending.draft, instructions: "\u0000" } }),
    "x".repeat(125_001)
  ]) {
    store.setItem(pendingCreationKey(scope), raw);
    expect(() => readPendingCreation(store, scope)).toThrow("незавершённую попытку");
  }
  expect(() => pendingCreationKey("")).toThrow("аккаунт");
  expect(() => savePendingCreation(store, scope, { ...pending, requestId: "wrong" })).toThrow(
    "ключ"
  );
});
it("requires durable readback before dispatch can proceed, including unavailable or silently dropped storage", () => {
  const store = storage();
  expect(() =>
    savePendingCreation(
      {
        ...store,
        setItem: () => {
          throw Error("quota");
        }
      },
      scope,
      pending
    )
  ).toThrow("quota");
  expect(() => savePendingCreation({ ...store, setItem: () => {} }, scope, pending)).toThrow(
    "сохранить попытку"
  );
});
