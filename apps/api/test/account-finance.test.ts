import { afterEach, describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { loadServerConfig } from "@cosmora/config";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { AccountFinanceSummarySchema, type AccountFinanceSummary } from "@cosmora/contracts";
import {
  GeneralChatStore,
  IdentityStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import {
  AccountStore,
  CanonicalUsageConflictError
} from "../src/account-settings/account-store.js";
import { accountFinanceSummary } from "../src/account-settings/finance-summary.js";
import { registerAccountRoutes } from "../src/account-settings/routes.js";
import { BearerSessionIdentityResolver, LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";
import { buildApp } from "../src/app.js";

const dbs: ReturnType<typeof openDatabase>[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});
const fixture = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const store = new AccountStore(db.sqlite);
  store.migrate();
  return { db, store, report: (owner = "owner") => accountFinanceSummary(db.sqlite, owner) };
};
function retained(
  store: AccountStore,
  id: string,
  overrides: {
    owner?: string;
    status?: string;
    input?: number | null;
    output?: number | null;
    cost?: number | null;
    estimate?: number | null;
    currency?: string | null;
  } = {}
) {
  const {
    owner = "owner",
    status = "committed",
    input = 10,
    output = 5,
    cost = null,
    estimate = null,
    currency = null
  } = overrides;
  store.sqlite
    .prepare(
      `INSERT INTO kosmora_retained_accounting
    (source,usage_id,run_id,owner_id,status,provider_id,model_requested,registry_version,attempt,
     estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
     estimated_cost_amount,calculated_cost_amount,currency,created_at,updated_at)
     VALUES('general',?,?,?,?,'private-provider','private-model','fixture',0,20,80,?,?,?,?,?, '2026-10-28T00:00:00.000Z','2026-10-28T00:00:00.000Z')
  `
    )
    .run(id, id, owner, status, input, output, estimate, cost, currency);
}

describe("owner financial summary", () => {
  it("has an explicit empty state and never claims verified provider invoices", async () => {
    const { report } = await fixture();
    const value = report();
    expect(Value.Check(AccountFinanceSummarySchema, value)).toBe(true);
    expect(value).toMatchObject({
      coverage: "empty",
      provider_invoice_reconciled: false,
      currencies: [],
      attempts: { total: 0 },
      invalid_records: 0
    });
  });

  it("separates currencies, real zero costs, unknown prices and missing usage", async () => {
    const { store, report } = await fixture();
    retained(store, "usd", { cost: 0.25, currency: "USD" });
    retained(store, "rub", { cost: 10, currency: "RUB" });
    retained(store, "free", { cost: 0, currency: "USD" });
    retained(store, "no-price");
    retained(store, "no-usage", { input: null, output: null, cost: 3, currency: "USD" });
    retained(store, "other", { owner: "other", cost: 999, currency: "USD" });
    const value = report();
    expect(value.coverage).toBe("partial");
    expect(value.attempts.total).toBe(5);
    expect(value.tokens).toEqual({
      actual_input: 40,
      actual_output: 20,
      unknown_committed_attempts: 1,
      unsettled_upper_bound: 100
    });
    expect(value.currencies).toEqual([
      {
        currency: "RUB",
        calculated_committed_amount: 10,
        estimated_unsettled_amount: 0,
        priced_committed_attempts: 1,
        priced_unsettled_attempts: 0
      },
      {
        currency: "USD",
        calculated_committed_amount: 0.25,
        estimated_unsettled_amount: 0,
        priced_committed_attempts: 2,
        priced_unsettled_attempts: 0
      }
    ]);
    expect(value.unknown_cost).toEqual({ committed_attempts: 2, unsettled_attempts: 0 });
    expect(JSON.stringify(value)).not.toMatch(/private-provider|private-model|other/);
  });

  it("uses all history, not the capped usage panel, without changing ledgers", async () => {
    const { store, report } = await fixture();
    for (let n = 0; n < 180; n++) retained(store, `r${n}`, { cost: 1, currency: "USD" });
    const before = store.sqlite.prepare("SELECT total_changes() n").get();
    const value = report();
    expect(value.attempts.total).toBe(180);
    expect(value.coverage).toBe("complete");
    expect(value.currencies[0]?.calculated_committed_amount).toBe(180);
    expect(store.sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
    expect(Value.Check(AccountFinanceSummarySchema, value)).toBe(true);
  });

  it("joins live chat and project ledgers to the owner, independently of retained history", async () => {
    const { db, report } = await fixture();
    const chats = new GeneralChatStore(db.sqlite);
    const projects = new ProjectStore(db.sqlite);
    for (const [owner, cost] of [
      ["owner", 1],
      ["other", 1000]
    ] as const) {
      const chat = chats.createChat("test", `chat-${owner}`, owner);
      const project = projects.createProject("test", `project-${owner}`, owner);
      const reservation = {
        attempt: 0,
        registry_version: "fixture",
        provider_id: "provider",
        model_id: "model",
        estimated_input_tokens: 20,
        max_output_tokens: 80,
        estimated_cost: { amount: cost, currency: "USD" as const }
      };
      chats.reserveModelUsage(chat.run.id, reservation, owner);
      projects.reserveModelUsage(project.run.id, reservation, owner);
      chats.completeRun(
        chat.run.id,
        "provider",
        "model",
        { inputTokens: 2, outputTokens: 3 },
        { attempt: 0, calculatedCost: { amount: cost, currency: "USD" } }
      );
      projects.completeRun(
        project.run.id,
        "provider",
        "model",
        { inputTokens: 4, outputTokens: 5 },
        { attempt: 0, calculatedCost: { amount: cost, currency: "USD" } }
      );
    }
    const value = report();
    expect(value.attempts).toMatchObject({ total: 2, committed: 2 });
    expect(value.tokens).toMatchObject({ actual_input: 6, actual_output: 8 });
    expect(value.currencies[0]?.calculated_committed_amount).toBe(2);
  });

  it("keeps failed/cancelled attempts reserved and does not double-count their shadow holds", async () => {
    const { store, report } = await fixture();
    retained(store, "failed", {
      status: "failed",
      input: null,
      output: null,
      estimate: 0.5,
      currency: "USD"
    });
    retained(store, "cancelled", { status: "cancelled", input: null, output: null });
    store.reserve("owner", "failed", 0, 100, "main", "", "p", "m");
    const orphan = store.reserve("owner", "orphan", 0, 200, "main", "", "p", "m");
    store.uncertainReservation(orphan, "main");
    const value = report();
    expect(value.attempts).toMatchObject({ total: 2, unsettled: 2 });
    expect(value.holds).toEqual({
      reserved: 1,
      uncertain: 1,
      orphaned_attempts: 1,
      orphaned_upper_bound: 200
    });
    expect(value.tokens.unsettled_upper_bound).toBe(200);
    expect(value.currencies[0]).toMatchObject({
      calculated_committed_amount: 0,
      estimated_unsettled_amount: 0.5
    });
    expect(value.unknown_cost.unsettled_attempts).toBe(1);
  });

  it("reports relay/media usage without inventing their monetary cost or refunding uncertain jobs", async () => {
    const { store, report } = await fixture();
    const relay = store.reserve("owner", "relay", 0, 100, "to_en", "c", "p", "m");
    store.completeReservation(relay, "to_en", 2, 3);
    store.sqlite
      .prepare(
        `INSERT INTO kosmora_media_usage
      (operation_id,owner_id,kind,provider_id,model_id,hold_id,status,reserved_tokens,input_tokens,output_tokens,created_at)
      VALUES(?, 'owner','image','p','m',? ,?, 200000,?,?, '2026-10-28T00:00:00.000Z')`
      )
      .run("media-done", "h1", "committed", 4, 5);
    store.sqlite
      .prepare(
        `INSERT INTO kosmora_media_usage
      (operation_id,owner_id,kind,provider_id,model_id,hold_id,status,reserved_tokens,created_at)
      VALUES('media-cancelled','owner','image','p','m','h2','cancelled',200000,'2026-10-28T00:00:00.000Z')`
      )
      .run();
    const value = report();
    expect(value.attempts).toEqual({
      total: 2,
      committed: 2,
      unsettled: 0,
      cancelled_before_dispatch: 1
    });
    expect(value.tokens.actual_input).toBe(6);
    expect(value.tokens.actual_output).toBe(8);
    expect(value.unknown_cost.committed_attempts).toBe(2);
    expect(value.currencies).toEqual([]);
    expect(value.coverage).toBe("unknown");
  });

  it("flags malformed historical counters/currencies without presenting them as known costs", async () => {
    const { store, report } = await fixture();
    retained(store, "negative", { input: -1, cost: 10, currency: "USD" });
    retained(store, "bad-unit", { cost: 3, currency: "not-a-currency" });
    const value = report();
    expect(value.invalid_records).toBe(2);
    expect(value.unknown_cost.committed_attempts).toBe(2);
    expect(value.currencies).toEqual([]);
    expect(Value.Check(AccountFinanceSummarySchema, value)).toBe(true);
  });

  it("exposes a no-store HTTP report bound to authenticated identity, ignoring owner spoofing", async () => {
    const { store } = await fixture();
    retained(store, "ours", { cost: 1, currency: "USD" });
    retained(store, "theirs", { owner: "other", cost: 900, currency: "RUB" });
    const app = Fastify();
    apps.push(app);
    registerAccountRoutes(
      app,
      store,
      () => ({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: "owner" }),
      { provider: "fixture", model: "fixture", capabilities: {} }
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/personal-settings/usage/finance?owner_id=other"
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const value = response.json<AccountFinanceSummary>();
    expect(value.currencies).toHaveLength(1);
    expect(value.currencies[0]).toMatchObject({ currency: "USD", calculated_committed_amount: 1 });
    expect(Value.Check(AccountFinanceSummarySchema, value)).toBe(true);
  });

  it("the real API denies anonymous access and isolates two authenticated owners", async () => {
    const { db, store } = await fixture();
    const identity = new IdentityStore(db.sqlite);
    const issue = (owner: string) => {
      identity.registerActor(owner, owner, "owner");
      return identity.issueSession({
        ownerId: owner,
        actorId: owner,
        assurance: "single_factor",
        ttlMs: 60000
      }).token;
    };
    const first = issue("owner"),
      second = issue("other");
    retained(store, "first", { cost: 2, currency: "USD" });
    retained(store, "second", { owner: "other", cost: 100, currency: "RUB" });
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      accountStore: store,
      accountModel: { provider: "fixture", model: "fixture", capabilities: {} }
    });
    apps.push(app);
    const url = "/api/v1/personal-settings/usage/finance";
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    for (const [token, unit, value] of [
      [first, "USD", 2],
      [second, "RUB", 100]
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<AccountFinanceSummary>().currencies).toMatchObject([
        { currency: unit, calculated_committed_amount: value }
      ]);
      expect(response.body).not.toContain(token);
    }
  });
});

describe("canonical usage replay integrity", () => {
  it("preserves money and uncertain holds across a real SQLite close/reopen, then settles known evidence once", async () => {
    const parent = realpathSync(tmpdir());
    const directory = realpathSync(mkdtempSync(path.join(parent, "kosmora-finance-restart-")));
    const filename = path.join(directory, "finance.sqlite");
    let db: ReturnType<typeof openDatabase> | undefined;
    try {
      db = openDatabase(filename);
      await runMigrations(db);
      const first = new AccountStore(db.sqlite);
      first.migrate();
      first.reserve("owner", "priced", 0, 100, "main", "", "p", "m");
      first.reserve("owner", "unknown", 0, 100, "main", "", "p", "m");
      retained(first, "priced", { cost: 0.5, currency: "USD" });
      retained(first, "unknown");
      db.close();
      db = undefined;
      db = openDatabase(filename);
      const restored = new AccountStore(db.sqlite);
      expect(
        accountFinanceSummary(db.sqlite, "owner").currencies[0]?.calculated_committed_amount
      ).toBe(0.5);
      expect(restored.reconcileKnownCanonicalHolds()).toBe(1);
      expect(restored.reconcileKnownCanonicalHolds()).toBe(0);
      expect(restored.sqlite.prepare("SELECT run_id FROM kosmora_usage_holds").all()).toEqual([
        { run_id: "unknown" }
      ]);
      expect(restored.summary("owner").total_counted_tokens).toBe(115);
    } finally {
      db?.close();
      const checked = realpathSync(directory);
      if (
        path.dirname(checked) !== parent ||
        !path.basename(checked).startsWith("kosmora-finance-restart-")
      )
        throw Error("Refusing to clean an unexpected test directory");
      rmSync(checked, { recursive: true, force: true });
    }
  });
  it("releases only valid owner-matched retained canonical holds, once, without erasing uncertain accounting", async () => {
    const { store } = await fixture();
    const rows = [
      ["priced", { cost: 0.5, currency: "USD" }],
      ["unpriced", {}],
      ["bad-count", { input: -1, cost: 1, currency: "USD" }],
      ["bad-unit", { cost: 1, currency: "BAD" }],
      ["other-owner", { owner: "other", cost: 1, currency: "USD" }]
    ] as const;
    for (const [id, row] of rows) {
      store.reserve("owner", id, 0, 100, "main", "", "p", "m");
      retained(store, id, row);
    }
    expect(store.reconcileKnownCanonicalHolds()).toBe(1);
    expect(store.reconcileKnownCanonicalHolds()).toBe(0);
    expect(store.sqlite.prepare("SELECT count(*) n FROM kosmora_usage_holds").get()).toEqual({
      n: 4
    });
    expect(
      store.sqlite.prepare("SELECT count(*) n FROM kosmora_retained_accounting").get()
    ).toEqual({ n: 5 });
  });
  it("accepts identical document replay, rejects conflicting evidence and preserves the original charge", async () => {
    const { store, report } = await fixture();
    store.reserve("owner", "document", 0, 100, "main", "", "p", "m");
    const record = () =>
      store.completeAuxiliary("owner", "document", 0, "document", "p", "m", 10, 5, 0.25, "USD");
    record();
    record();
    expect(() =>
      store.completeAuxiliary("owner", "document", 0, "document", "p", "m", 10, 5, 99, "USD")
    ).toThrow(CanonicalUsageConflictError);
    expect(() =>
      store.completeAuxiliary(
        "owner",
        "document",
        0,
        "document",
        "p",
        "wrong-model",
        10,
        5,
        0.25,
        "USD"
      )
    ).toThrow(CanonicalUsageConflictError);
    expect(report().currencies[0]?.calculated_committed_amount).toBe(0.25);
    expect(report().attempts.total).toBe(1);
    expect(store.sqlite.prepare("SELECT count(*) n FROM kosmora_usage_holds").get()).toEqual({
      n: 0
    });
  });

  it("rejects invalid monetary evidence before releasing the reservation", async () => {
    const { store } = await fixture();
    const hold = store.reserve("owner", "document", 0, 100, "main", "", "p", "m");
    for (const cost of [null, NaN, Infinity, -1]) {
      expect(() =>
        store.completeAuxiliary("owner", "document", 0, "document", "p", "m", 1, 2, cost, "USD")
      ).toThrow();
    }
    expect(() =>
      store.completeAuxiliary("owner", "document", 0, "document", "p", "m", 1, 2, 1, "BAD")
    ).toThrow();
    expect(store.sqlite.prepare("SELECT id FROM kosmora_usage_holds").get()).toEqual({ id: hold });
  });

  it("reuses the same relay reservation, prevents conflicting replays and preserves a committed result against late uncertainty", async () => {
    const { store } = await fixture();
    const id = store.reserve("owner", "relay", 0, 100, "to_en", "c", "p", "m");
    expect(store.reserve("owner", "relay", 0, 100, "to_en", "c", "p", "m")).toBe(id);
    expect(() => store.reserve("other", "relay", 0, 100, "to_en", "c", "p", "m")).toThrow(
      /CONFLICT/
    );
    expect(() => store.reserve("owner", "relay", 0, 100, "to_en", "c", "p", "other")).toThrow(
      /CONFLICT/
    );
    store.uncertainReservation(id, "to_en");
    store.completeReservation(id, "to_en", 10, 5);
    store.completeReservation(id, "to_en", 10, 5);
    expect(() => store.completeReservation(id, "to_en", 11, 5)).toThrow(
      CanonicalUsageConflictError
    );
    store.uncertainReservation(id, "to_en");
    store.completeReservation(id, "to_en", null, null);
    expect(store.summary("owner").translation_tokens_or_upper_bound).toBe(15);
    expect(
      store.sqlite.prepare("SELECT status FROM kosmora_relay_usage WHERE id=?").get(id)
    ).toEqual({ status: "committed" });
  });

  it("retains unknown relay usage as a hold and refuses malformed counters", async () => {
    const { store } = await fixture();
    const id = store.reserve("owner", "relay", 0, 100, "to_en", "c", "p", "m");
    for (const value of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => store.completeReservation(id, "to_en", value, 1)).toThrow();
    store.completeReservation(id, "to_en", null, 1);
    expect(store.summary("owner").translation_tokens_or_upper_bound).toBe(100);
    expect(
      store.sqlite.prepare("SELECT status FROM kosmora_relay_usage WHERE id=?").get(id)
    ).toEqual({ status: "uncertain" });
  });
});
