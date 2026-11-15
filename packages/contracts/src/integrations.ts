import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { CapabilityIdSchema, type CapabilityId } from "./policy.js";

/**
 * Universal, validated connector description for the Integrations section.
 *
 * This is a manifest, not a transport: it describes which external application
 * an operation belongs to, which capabilities it needs, and how a result must be
 * verified. It deliberately contains no credentials, tokens, endpoints or
 * network handles. Registering a connector never grants rights; execution is
 * performed only through GuardedToolRuntime after policy evaluation.
 */

export const ConnectorOperationKindSchema = Type.Union([
  Type.Literal("read"),
  Type.Literal("write")
]);
export type ConnectorOperationKind = Static<typeof ConnectorOperationKindSchema>;

export const ConnectorResultCheckSchema = Type.Union([
  Type.Literal("bytes.sha256"),
  Type.Literal("version"),
  Type.Literal("fresh_observation")
]);
export type ConnectorResultCheck = Static<typeof ConnectorResultCheckSchema>;

export const ConnectorAuthKindSchema = Type.Union([
  Type.Literal("oauth.pkce"),
  Type.Literal("server.token"),
  Type.Literal("computer.control")
]);
export type ConnectorAuthKind = Static<typeof ConnectorAuthKindSchema>;

export const ConnectorOperationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: ConnectorOperationKindSchema,
    summary: Type.String({ minLength: 1, maxLength: 256 }),
    capability_ids: Type.Array(CapabilityIdSchema, { minItems: 1, uniqueItems: true }),
    result_checks: Type.Array(ConnectorResultCheckSchema, { minItems: 1, uniqueItems: true })
  },
  { additionalProperties: false }
);
export type ConnectorOperation = Static<typeof ConnectorOperationSchema>;

export const ConnectorDescriptorSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    version: Type.Integer({ minimum: 1 }),
    app: Type.String({ minLength: 1, maxLength: 128 }),
    /** Where the existing implementation lives; documentation only, not a URI to call. */
    implementation: Type.String({ minLength: 1, maxLength: 256 }),
    auth_kind: ConnectorAuthKindSchema,
    operations: Type.Array(ConnectorOperationSchema, { minItems: 1 }),
    /**
     * Honest lifecycle state of the owner grant. The first slice never connects
     * a transport on its own, so the only valid initial value is not_connected.
     */
    state: Type.Union([
      Type.Literal("not_connected"),
      Type.Literal("needs_confirmation"),
      Type.Literal("connected"),
      Type.Literal("revoked")
    ])
  },
  { additionalProperties: false }
);
export type ConnectorDescriptor = Static<typeof ConnectorDescriptorSchema>;

export function parseConnectorDescriptor(value: unknown): ConnectorDescriptor {
  if (!Value.Check(ConnectorDescriptorSchema, value))
    throw new Error("INVALID_CONNECTOR_DESCRIPTOR");
  const seen = new Set<string>();
  for (const operation of (value as ConnectorDescriptor).operations) {
    if (seen.has(operation.id)) throw new Error("DUPLICATE_CONNECTOR_OPERATION");
    seen.add(operation.id);
  }
  const serialized = JSON.stringify(value);
  if (
    /api[_-]?key|bearer\s|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret/i.test(
      serialized
    )
  )
    throw new Error("CONNECTOR_CREDENTIAL_FORBIDDEN");
  return structuredClone(value) as ConnectorDescriptor;
}

/** Capabilities required by one operation of a connector. */
export function connectorOperationCapabilities(
  descriptor: ConnectorDescriptor,
  operationId: string
): readonly CapabilityId[] {
  const operation = descriptor.operations.find((item) => item.id === operationId);
  if (!operation) throw new Error("CONNECTOR_OPERATION_NOT_FOUND");
  return operation.capability_ids;
}

/** Honest per-project status; never reports a connected grant that does not exist. */
export const ConnectorStatusSchema = Type.Object(
  {
    project_id: Type.String({ minLength: 1, maxLength: 128 }),
    connectors: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 128 }),
          app: Type.String({ minLength: 1, maxLength: 128 }),
          state: ConnectorDescriptorSchema.properties.state,
          /** True only after a vetted transport is explicitly bound by the app. */
          transport_wired: Type.Boolean(),
          operations: Type.Integer({ minimum: 0 })
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
);
export type ConnectorStatus = Static<typeof ConnectorStatusSchema>;
