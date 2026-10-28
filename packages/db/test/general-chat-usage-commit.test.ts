import { afterEach, describe, expect, it } from "vitest";
import { GeneralChatStore, openDatabase, runMigrations } from "../src/index.js";

const databases: Array<ReturnType<typeof openDatabase>> = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = openDatabase(":memory:");
  databases.push(db);
  await runMigrations(db);
  const store = new GeneralChatStore(db.sqlite);
  const { run } = store.createChat("Question", "early-main-usage");
  store.reserveModelUsage(run.id, {
    attempt: 1,
    registry_version: "fixture",
    provider_id: "fixture",
    model_id: "alias",
    estimated_input_tokens: 100,
    max_output_tokens: 500,
    estimated_cost: { amount: 0.1, currency: "USD" }
  });
  const usage = { inputTokens: 25, outputTokens: 15 };
  const accounting = { attempt: 1, calculatedCost: { amount: 0.001, currency: "USD" as const } };
  return { db, store, run, usage, accounting };
}
describe("canonical chat usage before message completion", () => {
  it("retains main billing after failure, cancellation, restart recovery and late failure events", async () => {
    const f = await fixture();
    f.store.commitModelUsage(f.run.id, "fixture", "resolved", f.usage, f.accounting);
    expect(f.store.getRun(f.run.id)?.status).toBe("queued");
    f.store.failRun(f.run.id, "RELAY_UNAVAILABLE");
    f.store.failModelUsage(f.run.id, 1, "LATE_ERROR");
    f.store.recoverInterruptedRuns();
    f.store.cancelRun(f.run.id);
    expect(f.store.getModelUsageForRun(f.run.id)[0]).toMatchObject({
      status: "committed",
      actual_input_tokens: 25,
      actual_output_tokens: 15,
      calculated_cost_amount: 0.001
    });
    expect(f.store.getRun(f.run.id)?.status).toBe("failed");
  });
  it("accepts an exact replay without another write and refuses contradictory completion evidence", async () => {
    const f = await fixture();
    f.store.commitModelUsage(f.run.id, "fixture", "resolved", f.usage, f.accounting);
    const original = f.store.getModelUsageForRun(f.run.id);
    const writes = f.db.sqlite.prepare("SELECT total_changes() n").get()!.n;
    f.store.commitModelUsage(f.run.id, "fixture", "resolved", f.usage, f.accounting);
    expect(f.db.sqlite.prepare("SELECT total_changes() n").get()!.n).toBe(writes);
    for (const [provider, model, usage, accounting] of [
      ["wrong-provider", "resolved", f.usage, f.accounting],
      ["fixture", "changed-model", f.usage, f.accounting],
      ["fixture", "resolved", { ...f.usage, inputTokens: 26 }, f.accounting],
      [
        "fixture",
        "resolved",
        f.usage,
        { ...f.accounting, calculatedCost: { amount: 0.002, currency: "USD" as const } }
      ]
    ] as const)
      expect(() =>
        f.store.commitModelUsage(f.run.id, provider, model, usage, accounting)
      ).toThrow();
    expect(f.store.getModelUsageForRun(f.run.id)).toEqual(original);
  });
  it("rolls the ledger back if updating parent metadata fails", async () => {
    const f = await fixture();
    const original = f.store.getModelUsageForRun(f.run.id);
    f.db.sqlite.exec(
      "CREATE TEMP TRIGGER reject_usage_parent BEFORE UPDATE ON general_chat_runs BEGIN SELECT RAISE(ABORT,'fixture metadata failure'); END"
    );
    expect(() =>
      f.store.commitModelUsage(f.run.id, "fixture", "resolved", f.usage, f.accounting)
    ).toThrow("fixture metadata failure");
    expect(f.store.getModelUsageForRun(f.run.id)).toEqual(original);
  });
  it("refuses invalid counters and leaves unknown price unknown", async () => {
    const f = await fixture();
    for (const inputTokens of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])
      expect(() =>
        f.store.commitModelUsage(
          f.run.id,
          "fixture",
          "resolved",
          { inputTokens, outputTokens: 15 },
          f.accounting
        )
      ).toThrow();
    f.store.commitModelUsage(f.run.id, "fixture", "resolved", f.usage, {
      attempt: 1,
      calculatedCost: null
    });
    expect(f.store.getModelUsageForRun(f.run.id)[0]).toMatchObject({
      status: "committed",
      actual_input_tokens: 25,
      calculated_cost_amount: null,
      currency: "USD"
    });
  });
});
