CREATE TABLE pay_orders (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 customer_ref TEXT NOT NULL,
 plan_code TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor >= 100 AND amount_minor <= 100000000),
 currency TEXT NOT NULL DEFAULT 'RUB' CHECK(currency = 'RUB'),
 idempotency_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('created','pending','succeeded','canceled')),
 provider_payment_id TEXT UNIQUE,
 confirmation_url TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX pay_orders_owner_created ON pay_orders(owner_id, created_at);
--> statement-breakpoint
CREATE TABLE pay_order_dispatches (
 order_id TEXT PRIMARY KEY NOT NULL REFERENCES pay_orders(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL,
 attempted_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pay_dispatch_no_update BEFORE UPDATE ON pay_order_dispatches
BEGIN SELECT RAISE(ABORT, 'pay dispatch immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pay_dispatch_no_delete BEFORE DELETE ON pay_order_dispatches
BEGIN SELECT RAISE(ABORT, 'pay dispatch immutable'); END;
--> statement-breakpoint
CREATE TABLE pay_order_events (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL REFERENCES pay_orders(id) ON DELETE RESTRICT,
 owner_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('created','pending','succeeded','canceled')),
 source TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX pay_events_order_created ON pay_order_events(order_id, created_at);
--> statement-breakpoint
CREATE TRIGGER pay_order_events_immutable_update BEFORE UPDATE ON pay_order_events
BEGIN SELECT RAISE(ABORT, 'pay event immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pay_order_identity_immutable BEFORE UPDATE ON pay_orders
BEGIN
 SELECT RAISE(ABORT,'pay order identity immutable') WHERE NEW.id<>OLD.id OR NEW.owner_id<>OLD.owner_id
 OR NEW.plan_code<>OLD.plan_code OR NEW.amount_minor<>OLD.amount_minor OR NEW.currency<>OLD.currency
 OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.created_at<>OLD.created_at
 OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS NOT OLD.provider_payment_id)
 OR (OLD.status IN ('succeeded','canceled') AND NEW.status<>OLD.status);
END;
--> statement-breakpoint
CREATE TRIGGER pay_order_events_immutable_delete BEFORE DELETE ON pay_order_events
BEGIN SELECT RAISE(ABORT, 'pay event immutable'); END;
