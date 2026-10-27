import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import { PayConflictError, type PayStore } from "@cosmora/db";
import type { PayGateway } from "./pay-gateway.js";

export interface PayRouteOptions {
  store: PayStore;
  gateway?: PayGateway;
  plans: Record<string, number>;
  identityFor: (request: FastifyRequest) => IdentityContext;
}

const errorBody = (requestId: string, code: string, message: string, retryable = false) =>
  ({ error: { code, message, request_id: requestId, retryable } });

export function registerPayRoutes(app: FastifyInstance, options: PayRouteOptions): void {
  const { store, gateway, plans, identityFor } = options;

  app.get("/api/v1/pay/summary", async (request) =>
    store.summary(identityFor(request).owner_id)
  );

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
    async (request) => ({
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
            customer_ref: { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9:_-]+$" },
            plan_code: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" }
          }
        }
      }
    },
    async (request, reply) => {
      if (!gateway) {
        return reply.code(503).send(errorBody(
          request.id, "PAY_PROVIDER_UNAVAILABLE",
          "Payment provider is not configured; no charge was attempted", true
        ));
      }
      const rawIdempotency = request.headers["idempotency-key"];
      if (typeof rawIdempotency !== "string" ||
          !/^[a-zA-Z0-9_-]{12,64}$/.test(rawIdempotency)) {
        return reply.code(400).send(errorBody(
          request.id, "VALIDATION_ERROR", "An Idempotency-Key of 12 to 64 characters is required"
        ));
      }
      const planPrice = Object.hasOwn(plans, request.body.plan_code)
        ? plans[request.body.plan_code]
        : undefined;
      if (typeof planPrice !== "number" || !Number.isSafeInteger(planPrice) ||
          planPrice < 100 || planPrice > 100_000_000) {
        return reply.code(400).send(errorBody(
          request.id, "VALIDATION_ERROR", "Plan is not configured"
        ));
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
          // Provider receives a stable UUID, so retries cannot create new charges.
          const remote = await gateway.createPayment({
            orderId: order.id, amountMinor: order.amount_minor
          });
          if (remote.currency !== order.currency || remote.amountMinor !== order.amount_minor ||
              !remote.confirmationUrl) {
            throw new PayConflictError("Provider returned invalid checkout evidence");
          }
          order = store.attachProviderPayment(
            identity.owner_id, order.id, remote.id, remote.confirmationUrl
          );
        }
      } catch (error) {
        if (error instanceof PayConflictError) {
          return reply.code(409).send(errorBody(request.id, "CONFLICT", error.message));
        }
        request.log.error({ requestId: request.id }, "Payment creation failed");
        return reply.code(502).send(errorBody(
          request.id, "PROVIDER_ERROR", "Payment provider is unavailable; retry with the same key", true
        ));
      }
      return order;
    }
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
    async (request, reply) => {
      const identity = identityFor(request);
      const order = store.getOrder(identity.owner_id, request.params.orderId);
      if (!order) return reply.code(404).send(errorBody(request.id, "PROJECT_NOT_FOUND", "Payment order not found"));
      if (!gateway || !order.provider_payment_id) {
        return reply.code(503).send(errorBody(
          request.id, "PAY_PROVIDER_UNAVAILABLE", "Verified provider status is not available", true
        ));
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
        return reply.code(502).send(errorBody(
          request.id, "PROVIDER_ERROR", "Could not verify payment with the provider", true
        ));
      }
    }
  );
}
