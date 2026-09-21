import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ApiErrorSchema,
  AssistantProfileListResponseSchema,
  AssistantProfileSchema,
  CreateAssistantProfileRequestSchema,
  DeleteAssistantProfileRequestSchema,
  DeleteAssistantProfileResponseSchema,
  UpdateAssistantProfileRequestSchema,
  type ApiError,
  type IdentityContext
} from "@cosmora/contracts";
import {
  AssistantProfileConflictError,
  AssistantProfileValidationError,
  type AssistantProfileStore
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";

export interface AssistantProfileRouteOptions {
  app: FastifyInstance;
  store: AssistantProfileStore;
  identityFor(request: FastifyRequest): IdentityContext;
}

const error = (requestId: string, code: ApiError["error"]["code"], message: string): ApiError => ({
  error: { code, message, request_id: requestId, retryable: false }
});

export const registerAssistantProfileRoutes = (options: AssistantProfileRouteOptions): void => {
  const app = options.app.withTypeProvider<TypeBoxTypeProvider>();
  const params = Type.Object(
    { profileId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\s]+$" }) },
    { additionalProperties: false }
  );

  app.get(
    "/api/v1/assistant-profiles",
    { schema: { response: { 200: AssistantProfileListResponseSchema } } },
    (request) => ({ items: options.store.list(options.identityFor(request).owner_id) })
  );

  app.post(
    "/api/v1/assistant-profiles",
    {
      schema: {
        body: CreateAssistantProfileRequestSchema,
        response: {
          200: AssistantProfileSchema,
          201: AssistantProfileSchema,
          400: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const created = options.store.create(
          request.body.profile_id,
          request.body,
          options.identityFor(request).owner_id
        );
        return reply.status(created.duplicate ? 200 : 201).send(created.profile);
      } catch (cause) {
        if (cause instanceof AssistantProfileValidationError) {
          return reply
            .status(400)
            .send(error(request.id, "VALIDATION_ERROR", "Assistant profile text is required"));
        }
        if (cause instanceof AssistantProfileConflictError) {
          return reply
            .status(409)
            .send(
              error(
                request.id,
                "ASSISTANT_PROFILE_CONFLICT",
                "Assistant profile changed or the profile limit was reached"
              )
            );
        }
        throw cause;
      }
    }
  );

  app.put(
    "/api/v1/assistant-profiles/:profileId",
    {
      schema: {
        params,
        body: UpdateAssistantProfileRequestSchema,
        response: {
          200: AssistantProfileSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const updated = options.store.update(
          request.params.profileId,
          request.body,
          options.identityFor(request).owner_id
        );
        if (!updated) {
          return reply
            .status(404)
            .send(error(request.id, "ASSISTANT_PROFILE_NOT_FOUND", "Assistant profile not found"));
        }
        return updated;
      } catch (cause) {
        if (cause instanceof AssistantProfileValidationError) {
          return reply
            .status(400)
            .send(error(request.id, "VALIDATION_ERROR", "Assistant profile text is required"));
        }
        if (cause instanceof AssistantProfileConflictError) {
          return reply
            .status(409)
            .send(
              error(request.id, "ASSISTANT_PROFILE_CONFLICT", "Assistant profile version changed")
            );
        }
        throw cause;
      }
    }
  );

  app.delete(
    "/api/v1/assistant-profiles/:profileId",
    {
      schema: {
        params,
        body: DeleteAssistantProfileRequestSchema,
        response: {
          200: DeleteAssistantProfileResponseSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const deleted = options.store.delete(
          request.params.profileId,
          request.body.expected_version,
          options.identityFor(request).owner_id
        );
        if (deleted === null) {
          return reply
            .status(404)
            .send(error(request.id, "ASSISTANT_PROFILE_NOT_FOUND", "Assistant profile not found"));
        }
        return { profile_id: request.params.profileId, deleted: true as const };
      } catch (cause) {
        if (cause instanceof AssistantProfileConflictError) {
          return reply
            .status(409)
            .send(
              error(request.id, "ASSISTANT_PROFILE_CONFLICT", "Assistant profile version changed")
            );
        }
        throw cause;
      }
    }
  );
};
