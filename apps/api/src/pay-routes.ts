import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import { PayConflictError, type PayStore } from "@cosmora/db";
import type { PayGateway } from "./pay-gateway.js";

export interface PayRouteOptions {
  store: PayStore;
  gateway?: PayGateway;
  plans: Record<string, number>;
  identityFor: (request: FastifyRequest) => IdentityContext;
  stopped?: () => boolean;
}

const errorBody = (requestId: string, code: string, message: string, retryable = false) => ({
  error: { code, message, request_id: requestId, retryable }
});

export function registerPayRoutes(app: FastifyInstance, options: PayRouteOptions): void {
  const { store, gateway, plans, identityFor } = options;
  let closing = false;
  const active = new Set<Promise<unknown>>();
  const admitted = <T>(fn: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new PayConflictError("PAY_CLOSING"));
    const run = fn();
    active.add(run);
    void run.finally(() => active.delete(run)).catch(() => {});
    return run;
  };
  app.addHook("preClose", async () => {
    closing = true;
    await Promise.allSettled([...active]);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith("/api/v1/pay/"))
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff");
    return payload;
  });
  app.get("/api/v1/pay/status", () => ({
    configured: Boolean(gateway),
    checkout_enabled: Boolean(gateway) && !closing && !options.stopped?.(),
    uncertain_creation_retry: "manual_reconciliation",
    automatic_subscriptions: false
  }));

  app.get("/api/v1/pay/summary", (request) => store.summary(identityFor(request).owner_id));

  app.get<{ Querystring: { limit?: number } }>(
    "/api/v1/pay/orders",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          additionalProperties: false
        }
      }
    },
    (request) => ({
      items: store.listOrders(identityFor(request).owner_id, request.query.limit ?? 50)
    })
  );

  app.post<{ Body: { customer_ref: string; plan_code: string } }>(
    "/api/v1/pay/checkout",
    {
      schema: {
        body: {
          type: "object",
          required: ["customer_ref", "plan_code"],
          additionalProperties: false,
          properties: {
            customer_ref: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^[a-zA-Z0-9:_-]+$"
            },
            plan_code: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" }
          }
        }
      }
    },
    async (request, reply) =>
      admitted(async () => {
        if (!gateway) {
          return reply
            .code(503)
            .send(
              errorBody(
                request.id,
                "PAY_PROVIDER_UNAVAILABLE",
                "Payment provider is not configured; no charge was attempted",
                true
              )
            );
        }
        if (options.stopped?.())
          return reply.code(409).send(errorBody(request.id, "CONFLICT", "Payments are stopped"));
        const rawIdempotency = request.headers["idempotency-key"];
        if (typeof rawIdempotency !== "string" || !/^[a-zA-Z0-9_-]{12,64}$/.test(rawIdempotency)) {
          return reply
            .code(400)
            .send(
              errorBody(
                request.id,
                "VALIDATION_ERROR",
                "An Idempotency-Key of 12 to 64 characters is required"
              )
            );
        }
        const planPrice = Object.hasOwn(plans, request.body.plan_code)
          ? plans[request.body.plan_code]
          : undefined;
        if (
          typeof planPrice !== "number" ||
          !Number.isSafeInteger(planPrice) ||
          planPrice < 100 ||
          planPrice > 100_000_000
        ) {
          return reply
            .code(400)
            .send(errorBody(request.id, "VALIDATION_ERROR", "Plan is not configured"));
        }
        const identity = identityFor(request);
        let order;
        try {
          order = store.createOrder({
            ownerId: identity.owner_id,
            customerRef: request.body.customer_ref,
            planCode: request.body.plan_code,
            amountMinor: planPrice,
            idempotencyKey: rawIdempotency
          });
          if (!order.provider_payment_id) {
            if (!store.claimDispatch(identity.owner_id, order.id))
              throw new PayConflictError(
                "PAYMENT_CREATE_UNCERTAIN: reconcile the original payment before any further creation"
              );
            // Stable provider UUID plus durable one-time local admission. No replay after timeout/restart.
            const remote = await gateway.createPayment({
              orderId: order.id,
              amountMinor: order.amount_minor
            });
            if (
              remote.currency !== order.currency ||
              remote.amountMinor !== order.amount_minor ||
              remote.status !== "pending" ||
              remote.paid ||
              !remote.confirmationUrl
            ) {
              throw new PayConflictError("Provider returned invalid checkout evidence");
            }
            order = store.attachProviderPayment(
              identity.owner_id,
              order.id,
              remote.id,
              remote.confirmationUrl
            );
          }
        } catch (error) {
          if (error instanceof PayConflictError) {
            return reply.code(409).send(errorBody(request.id, "CONFLICT", error.message));
          }
          request.log.error({ requestId: request.id }, "Payment creation failed");
          return reply
            .code(502)
            .send(
              errorBody(
                request.id,
                "PROVIDER_ERROR",
                "Payment creation outcome is uncertain; manual reconciliation is required",
                false
              )
            );
        }
        return order;
      })
  );

  app.post<{ Params: { orderId: string } }>(
    "/api/v1/pay/orders/:orderId/verify",
    {
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: { type: "string", minLength: 1, maxLength: 64 } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) =>
      admitted(async () => {
        const identity = identityFor(request);
        try {
          store.assertWritable(identity.owner_id);
        } catch {
          return reply.code(423).send(errorBody(request.id, "CONFLICT", "OWNER_DATA_FENCED"));
        }
        const order = store.getOrder(identity.owner_id, request.params.orderId);
        if (!order)
          return reply
            .code(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Payment order not found"));
        if (!gateway || !order.provider_payment_id) {
          return reply
            .code(503)
            .send(
              errorBody(
                request.id,
                "PAY_PROVIDER_UNAVAILABLE",
                "Verified provider status is not available",
                true
              )
            );
        }
        try {
          // Only a fresh, authenticated server-to-server provider GET can mark a payment paid.
          const remote = await gateway.getPayment(order.provider_payment_id);
          return store.applyVerifiedStatus(identity.owner_id, order.id, remote);
        } catch (error) {
          if (error instanceof PayConflictError) {
            return reply.code(409).send(errorBody(request.id, "CONFLICT", error.message));
          }
          request.log.error({ requestId: request.id }, "Payment verification failed");
          return reply
            .code(502)
            .send(
              errorBody(
                request.id,
                "PROVIDER_ERROR",
                "Could not verify payment with the provider",
                true
              )
            );
        }
      })
  );
}
