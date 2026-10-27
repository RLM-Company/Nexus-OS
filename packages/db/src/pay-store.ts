import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type PayOrderStatus = "created" | "pending" | "succeeded" | "canceled";

export interface PayOrder {
  id: string;
  owner_id: string;
  customer_ref: string;
  plan_code: string;
  amount_minor: number;
  currency: "RUB";
  idempotency_key: string;
  status: PayOrderStatus;
  provider_payment_id: string | null;
  confirmation_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaySummary {
  currency: "RUB";
  orders_total: number;
  awaiting_payment: number;
  succeeded_count: number;
  canceled_count: number;
  succeeded_gross_minor: number;
}

export class PayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayConflictError";
  }
}

type PayRow = PayOrder;

const isAmount = (amount: number): boolean =>
  Number.isSafeInteger(amount) && amount >= 100 && amount <= 100_000_000;

const assertText = (value: string, max: number, name: string): void => {
  if (typeof value !== "string" || value.trim() !== value || !value || value.length > max) {
    throw new Error(`Invalid ${name}`);
  }
};

export class PayStore {
  constructor(private readonly sqlite: DatabaseSync) {}

  assertWritable(ownerId: string): void {
    if (
      this.sqlite
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(ownerId)
    )
      throw new PayConflictError("OWNER_DATA_FENCED");
  }

  /** Exactly one local admission, even across restart/connections. An uncertain create requires reconciliation, never another POST. */
  claimDispatch(ownerId: string, id: string): boolean {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.assertWritable(ownerId);
      const order = this.getOrder(ownerId, id);
      if (!order || order.status !== "created" || order.provider_payment_id)
        throw new PayConflictError("Invalid dispatch state");
      const claimed = this.sqlite
        .prepare(
          "INSERT INTO pay_order_dispatches SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM pay_order_dispatches WHERE order_id=?)"
        )
        .run(id, ownerId, new Date().toISOString(), id);
      this.sqlite.exec("COMMIT");
      return Number(claimed.changes) === 1;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  getOrder(ownerId: string, id: string): PayOrder | null {
    const row = this.sqlite
      .prepare("SELECT * FROM pay_orders WHERE owner_id = ? AND id = ?")
      .get(ownerId, id) as PayRow | undefined;
    return row ?? null;
  }

  getByIdempotency(ownerId: string, key: string): PayOrder | null {
    const row = this.sqlite
      .prepare("SELECT * FROM pay_orders WHERE owner_id = ? AND idempotency_key = ?")
      .get(ownerId, key) as PayRow | undefined;
    return row ?? null;
  }

  createOrder(input: {
    ownerId: string;
    customerRef: string;
    planCode: string;
    amountMinor: number;
    idempotencyKey: string;
  }): PayOrder {
    assertText(input.ownerId, 256, "owner");
    assertText(input.customerRef, 128, "customer reference");
    assertText(input.planCode, 64, "plan");
    assertText(input.idempotencyKey, 64, "idempotency key");
    if (!isAmount(input.amountMinor)) throw new Error("Invalid payment amount");
    this.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.assertWritable(input.ownerId);
      const existing = this.getByIdempotency(input.ownerId, input.idempotencyKey);
      if (existing) {
        if (
          existing.customer_ref !== input.customerRef ||
          existing.plan_code !== input.planCode ||
          existing.amount_minor !== input.amountMinor
        ) {
          throw new PayConflictError("Idempotency key was reused for a different order");
        }
        this.sqlite.exec("COMMIT;");
        return existing;
      }
      const timestamp = new Date().toISOString();
      const id = randomUUID();
      this.sqlite
        .prepare(
          `INSERT INTO pay_orders
         (id, owner_id, customer_ref, plan_code, amount_minor, currency, idempotency_key,
          status, provider_payment_id, confirmation_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'RUB', ?, 'created', NULL, NULL, ?, ?)`
        )
        .run(
          id,
          input.ownerId,
          input.customerRef,
          input.planCode,
          input.amountMinor,
          input.idempotencyKey,
          timestamp,
          timestamp
        );
      const created = this.getOrder(input.ownerId, id);
      if (!created) throw new Error("Failed to persist payment order");
      this.sqlite.exec("COMMIT;");
      return created;
    } catch (error) {
      this.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  attachProviderPayment(
    ownerId: string,
    id: string,
    providerId: string,
    confirmationUrl: string
  ): PayOrder {
    assertText(providerId, 128, "provider payment identifier");
    if (
      confirmationUrl.length > 2048 ||
      !confirmationUrl.startsWith("https://") ||
      new URL(confirmationUrl).username !== "" ||
      new URL(confirmationUrl).password !== "" ||
      new URL(confirmationUrl).port !== "" ||
      !new URL(confirmationUrl).hostname.includes(".")
    )
      throw new Error("Invalid secure checkout URL");

    this.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const order = this.getOrder(ownerId, id);
      if (!order) throw new PayConflictError("Order not found");
      if (order.provider_payment_id) {
        if (order.provider_payment_id !== providerId) {
          throw new PayConflictError("Order already bound to another payment");
        }
        this.sqlite.exec("COMMIT;");
        return order;
      }
      if (order.status !== "created") throw new PayConflictError("Invalid order state");
      const timestamp = new Date().toISOString();
      this.sqlite
        .prepare(
          `UPDATE pay_orders SET provider_payment_id = ?, confirmation_url = ?,
         status = 'pending', updated_at = ?
         WHERE id = ? AND owner_id = ? AND provider_payment_id IS NULL AND status = 'created'`
        )
        .run(providerId, confirmationUrl, timestamp, id, ownerId);
      this.sqlite
        .prepare(
          `INSERT INTO pay_order_events
         (id, order_id, owner_id, status, source, created_at)
         VALUES (?, ?, ?, 'pending', 'provider.create', ?)`
        )
        .run(randomUUID(), id, ownerId, timestamp);
      const updated = this.getOrder(ownerId, id);
      if (!updated) throw new Error("Order vanished");
      this.sqlite.exec("COMMIT;");
      return updated;
    } catch (error) {
      this.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  applyVerifiedStatus(
    ownerId: string,
    id: string,
    remote: {
      id: string;
      status: "pending" | "succeeded" | "canceled";
      paid: boolean;
      amountMinor: number;
      currency: string;
    }
  ): PayOrder {
    this.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const order = this.getOrder(ownerId, id);
      if (!order || !order.provider_payment_id) throw new PayConflictError("Unbound payment order");
      if (
        order.provider_payment_id !== remote.id ||
        !["pending", "succeeded", "canceled"].includes(remote.status) ||
        typeof remote.paid !== "boolean" ||
        !Number.isSafeInteger(remote.amountMinor) ||
        order.amount_minor !== remote.amountMinor ||
        order.currency !== remote.currency ||
        (remote.status === "succeeded" && remote.paid !== true)
      )
        throw new PayConflictError("Provider payment evidence does not match order");

      if (order.status === "succeeded" || order.status === "canceled") {
        if (order.status !== remote.status && remote.status !== "pending") {
          throw new PayConflictError(
            "Terminal payment status conflict: manual investigation required"
          );
        }
        this.sqlite.exec("COMMIT;");
        return order;
      }
      if (order.status !== remote.status) {
        const timestamp = new Date().toISOString();
        this.sqlite
          .prepare("UPDATE pay_orders SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
          .run(remote.status, timestamp, id, ownerId);
        this.sqlite
          .prepare(
            `INSERT INTO pay_order_events
           (id, order_id, owner_id, status, source, created_at)
           VALUES (?, ?, ?, ?, 'provider.verified_read', ?)`
          )
          .run(randomUUID(), id, ownerId, remote.status, timestamp);
      }
      const updated = this.getOrder(ownerId, id);
      if (!updated) throw new Error("Order vanished");
      this.sqlite.exec("COMMIT;");
      return updated;
    } catch (error) {
      this.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  listOrders(ownerId: string, limit = 50): PayOrder[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Invalid payment page limit");
    }
    return this.sqlite
      .prepare(
        "SELECT * FROM pay_orders WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
      )
      .all(ownerId, limit) as unknown as PayOrder[];
  }

  summary(ownerId: string): PaySummary {
    const row = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status IN ('created', 'pending') THEN 1 ELSE 0 END), 0) AS awaiting,
       COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS successes,
       COALESCE(SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END), 0) AS canceled,
       COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_minor ELSE 0 END), 0) AS gross
       FROM pay_orders WHERE owner_id = ?`
      )
      .get(ownerId) as {
      total: number;
      awaiting: number;
      successes: number;
      canceled: number;
      gross: number;
    };
    return {
      currency: "RUB",
      orders_total: row.total,
      awaiting_payment: row.awaiting,
      succeeded_count: row.successes,
      canceled_count: row.canceled,
      succeeded_gross_minor: row.gross
    };
  }
}
