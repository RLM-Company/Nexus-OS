import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { ClockCalculationSchema, type ClockCalculation } from "@cosmora/contracts";
import type { RuntimeClock } from "@cosmora/model-gateway";

/** Uses the app's existing verified identity hook. No model dispatch or mutable clock. */
export function registerRuntimeClockRoutes(app: FastifyInstance, clock: RuntimeClock) {
  app.get<{ Querystring: { time_zone?: string } }>(
    "/api/v1/clock",
    {
      schema: {
        querystring: Type.Object(
          { time_zone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return clock.snapshot(undefined, request.query.time_zone);
      } catch (error) {
        const invalidZone = error instanceof Error && error.message === "CLOCK_INVALID_TIME_ZONE";
        return reply
          .code(invalidZone ? 400 : 503)
          .send({ error: { code: invalidZone ? "CLOCK_INVALID_TIME_ZONE" : "CLOCK_UNAVAILABLE" } });
      }
    }
  );
  app.post<{ Body: ClockCalculation }>(
    "/api/v1/clock/calculate",
    { schema: { body: ClockCalculationSchema } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return { result: clock.calculate(request.body), clock: clock.snapshot() };
      } catch (error) {
        const invalidInput = error instanceof Error && error.message === "CLOCK_INVALID_INPUT";
        return reply
          .code(invalidInput ? 400 : 503)
          .send({ error: { code: invalidInput ? "CLOCK_INVALID_INPUT" : "CLOCK_UNAVAILABLE" } });
      }
    }
  );
}
