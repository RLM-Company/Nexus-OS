import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase, PayConflictError, PayStore, runMigrations } from "@cosmora/db";
import { buildApp } from "../src/app.js";
import type { PayGateway, ProviderPayment } from "../src/pay-gateway.js";

class FakeBank implements PayGateway {
  createCalls = 0;
  readCalls = 0;
  status: ProviderPayment["status"] = "pending";
  paid = false;
  wrongAmount = false;

  async createPayment(input: { orderId: string; amountMinor: number }): Promise<ProviderPayment> {
    this.createCalls += 1;
    return {
      id: `bank-${input.orderId}`,
      status: "pending",
      paid: false,
      amountMinor: input.amountMinor,
      currency: "RUB",
      confirmationUrl: `https://bank.example/checkout/${input.orderId}`
    };
  }

  async getPayment(id: string): Promise<ProviderPayment> {
    this.readCalls += 1;
    return {
      id, status: this.status, paid: this.paid,
      amountMinor: this.wrongAmount ? 12300 : 99000,
      currency: "RUB"
    };
  }
}

describe("Kosmora Pay MVP: owner-only billing with verified receipts", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  let database: ReturnType<typeof openDatabase>;
  let store: PayStore;
  let bank: FakeBank;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    store = new PayStore(database.sqlite);
    bank = new FakeBank();
    app = buildApp({
      config,
      database,
      payStore: store,
      payGateway: bank,
      payPlans: { pro: 99000 }
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  const orderHeaders = { "idempotency-key": "unique-order-key-1234" };
  const payload = { customer_ref: "internal-customer-123", plan_code: "pro" };

  const checkout = async () =>
    app.inject({
      method: "POST", url: "/api/v1/pay/checkout", headers: orderHeaders, payload
    });

  it("uses bank checkout, preserves idempotency and records no speculative revenue", async () => {
    const first = await checkout();
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      owner_id: "local-owner", customer_ref: "internal-customer-123",
      plan_code: "pro", amount_minor: 99000, status: "pending"
    });
    expect(first.json().confirmation_url).toMatch(/^https:\/\/bank\.example\/checkout/);
    const repeated = await checkout();
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe(first.json().id);
    expect(bank.createCalls).toBe(1);

    const summary = await app.inject({ method: "GET", url: "/api/v1/pay/summary" });
    expect(summary.json()).toMatchObject({
      orders_total: 1, awaiting_payment: 1,
      succeeded_count: 0, succeeded_gross_minor: 0
    });
  });

  it("refuses changing plan or customer under the same idempotency key", async () => {
    await checkout();
    const reuse = await app.inject({
      method: "POST", url: "/api/v1/pay/checkout", headers: orderHeaders,
      payload: { customer_ref: "another-customer", plan_code: "pro" }
    });
    expect(reuse.statusCode).toBe(409);
    expect(bank.createCalls).toBe(1);
  });

  it("confirms receipts only after reading the bank and handles repeated status checks", async () => {
    const first = await checkout();
    const id = first.json<{ id: string }>().id;
    bank.status = "succeeded";
    bank.paid = true;
    const confirmed = await app.inject({
      method: "POST", url: `/api/v1/pay/orders/${id}/verify`
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "succeeded" });
    const repeated = await app.inject({
      method: "POST", url: `/api/v1/pay/orders/${id}/verify`
    });
    expect(repeated.statusCode).toBe(200);
    expect(store.summary("local-owner")).toMatchObject({
      succeeded_count: 1, succeeded_gross_minor: 99000, awaiting_payment: 0
    });
    const events = database.sqlite.prepare(
      "SELECT status FROM pay_order_events WHERE order_id = ? ORDER BY rowid"
    ).all(id) as unknown as Array<{ status: string }>;
    expect(events.map((event) => event.status)).toEqual(["pending", "succeeded"]);
  });

  it("fails closed on amount mismatch or paid=false, never inventing income", async () => {
    const first = await checkout();
    const id = first.json<{ id: string }>().id;
    bank.status = "succeeded";
    bank.paid = false;
    expect((await app.inject({
      method: "POST", url: `/api/v1/pay/orders/${id}/verify`
    })).statusCode).toBe(409);
    bank.paid = true;
    bank.wrongAmount = true;
    expect((await app.inject({
      method: "POST", url: `/api/v1/pay/orders/${id}/verify`
    })).statusCode).toBe(409);
    expect(store.summary("local-owner").succeeded_gross_minor).toBe(0);
  });

  it("isolates owner data and prevents tampering with append-only events", async () => {
    const own = await checkout();
    const id = own.json<{ id: string }>().id;
    expect(store.getOrder("another-owner", id)).toBeNull();
    expect(store.listOrders("another-owner")).toEqual([]);
    expect(store.summary("another-owner").orders_total).toBe(0);
    expect(() => store.applyVerifiedStatus("another-owner", id, {
      id: `bank-${id}`, status: "succeeded", paid: true,
      amountMinor: 99000, currency: "RUB"
    })).toThrow(PayConflictError);
    expect(() => database.sqlite.prepare(
      "DELETE FROM pay_order_events WHERE order_id = ?"
    ).run(id)).toThrow(/immutable/);
  });

  it("never creates a payment when merchant gateway is absent", async () => {
    await app.close();
    app = buildApp({
      config, database, payStore: store, payPlans: { pro: 99000 }
    });
    const response = await checkout();
    expect(response.statusCode).toBe(503);
    expect(store.summary("local-owner").orders_total).toBe(0);
  });

  it("rejects unknown prices and missing request idempotency", async () => {
    const badPlan = await app.inject({
      method: "POST", url: "/api/v1/pay/checkout",
      headers: { "idempotency-key": "another-key-123456" },
      payload: { customer_ref: "customer-one", plan_code: "imaginary" }
    });
    const badKey = await app.inject({
      method: "POST", url: "/api/v1/pay/checkout",
      payload
    });
    expect(badPlan.statusCode).toBe(400);
    expect(badKey.statusCode).toBe(400);
    expect(bank.createCalls).toBe(0);
  });
});
