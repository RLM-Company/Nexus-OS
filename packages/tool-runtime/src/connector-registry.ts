import type { ConnectorDescriptor, ConnectorOperation, ConnectorStatus } from "@cosmora/contracts";
import type {
  GuardedTool,
  GuardedToolRuntime,
  ToolExecutionContext,
  ToolInvocationResult
} from "./index.js";

/**
 * Transport for a single connector operation. The first slice does not invent a
 * network stack: a transport is supplied only by an existing, vetted integration
 * (GitHub / Drive / Office). Invocation still goes through GuardedToolRuntime,
 * so policy verdict, confirmation, idempotency, owner/project scope, replay and
 * RECOVERY_REQUIRED are inherited rather than reimplemented.
 *
 * Secrets are resolved inside the existing integration, never held by the
 * registry, descriptor, input or returned result.
 */
export interface ConnectorTransport {
  /** The transport may commit its receipt in the same database transaction as the effect. */
  mayCompleteInTransaction?: boolean;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ConnectorInvocation<Input> {
  toolId: string;
  operationId?: string;
  projectId: string;
  actorId: string;
  objectIds: string[];
  purpose: string;
  idempotencyKey: string;
  input: Input;
}

interface RegisteredConnector {
  descriptor: ConnectorDescriptor;
  toolId: string;
  operation: ConnectorOperation;
  transport?: ConnectorTransport | undefined;
}

/** Deterministic tool id for one connector/operation pair. */
export const connectorToolId = (descriptorId: string, operationId: string): string =>
  `integration.${descriptorId}.${operationId}`;

/**
 * Minimal universal connector registry built over GuardedToolRuntime.
 *
 * Two deliberate honesty rules:
 *  - register() only accepts a validated descriptor; by default a connector is
 *    a catalog entry with transport_wired=false and state not_connected.
 *  - bindTransport() is the only way to make an operation executable, and it is
 *    explicit. Without it GuardedToolRuntime returns PAUSED (fail-closed) and no
 *    external call can happen.
 */
export class ConnectorRegistry {
  readonly #runtime: GuardedToolRuntime;
  readonly #connectors = new Map<string, RegisteredConnector>();
  readonly #wiredTools = new Set<string>();
  #registeredTools = false;

  constructor(runtime: GuardedToolRuntime) {
    this.#runtime = runtime;
  }

  /** Register validated descriptors. Rejects duplicates and malformed input. */
  register(descriptors: readonly ConnectorDescriptor[]): void {
    if (this.#registeredTools) throw new Error("CONNECTOR_REGISTRY_ALREADY_BOUND");
    for (const descriptor of descriptors) {
      const ids = new Set<string>();
      for (const operation of descriptor.operations) {
        if (ids.has(operation.id)) throw new Error("DUPLICATE_CONNECTOR_OPERATION");
        ids.add(operation.id);
      }
      for (const operation of descriptor.operations) {
        const toolId = connectorToolId(descriptor.id, operation.id);
        if (this.#connectors.has(toolId))
          throw new Error(`Connector ${descriptor.id} is already registered`);
        this.#connectors.set(toolId, { descriptor, toolId, operation });
      }
    }
  }

  list(): readonly ConnectorDescriptor[] {
    const descriptors = new Map<string, ConnectorDescriptor>();
    for (const entry of this.#connectors.values())
      descriptors.set(entry.descriptor.id, entry.descriptor);
    return [...descriptors.values()];
  }

  /**
   * Bind a vetted transport to one operation. This does not connect a grant or
   * store credentials; it only makes the operation eligible for policy-checked
   * execution. Call once, before bindToRuntime()/invoke().
   */
  bindTransport(toolId: string, transport: ConnectorTransport): void {
    if (this.#registeredTools) throw new Error("CONNECTOR_REGISTRY_ALREADY_BOUND");
    const entry = this.#connectors.get(toolId);
    if (!entry) throw new Error("CONNECTOR_OPERATION_NOT_FOUND");
    if (entry.transport) throw new Error("CONNECTOR_TRANSPORT_ALREADY_BOUND");
    entry.transport = transport;
  }

  /** Register wired operations as GuardedTools. Idempotent per instance. */
  bindToRuntime(): void {
    if (this.#registeredTools) return;
    for (const entry of this.#connectors.values()) {
      if (!entry.transport) continue;
      const transport = entry.transport;
      const tool: GuardedTool<unknown, unknown> = {
        id: entry.toolId,
        ...(transport.mayCompleteInTransaction ? { mayCompleteInTransaction: true } : {}),
        resolveCapabilities: () => entry.operation.capability_ids,
        execute: (input, context) => transport.execute(input, context)
      };
      this.#runtime.register(tool);
      this.#wiredTools.add(entry.toolId);
    }
    this.#registeredTools = true;
  }

  isWired(toolId: string): boolean {
    return this.#wiredTools.has(toolId);
  }

  /** Route one operation through the guarded runtime (no second policy stack). */
  invoke<Input, Output>(
    invocation: ConnectorInvocation<Input>
  ): Promise<ToolInvocationResult<Output>> {
    return this.#runtime.invoke<Input, Output>({
      toolId: invocation.toolId,
      ...(invocation.operationId === undefined ? {} : { operationId: invocation.operationId }),
      projectId: invocation.projectId,
      actorId: invocation.actorId,
      objectIds: invocation.objectIds,
      purpose: invocation.purpose,
      idempotencyKey: invocation.idempotencyKey,
      input: invocation.input
    });
  }

  /**
   * Honest status. A descriptor alone never yields state=connected; a bound but
   * unconfirmed transport stays not_connected. `operations` always counts the
   * described operations, `transport_wired` only reports whether a vetted
   * transport was bound. No tokens or fake metrics.
   */
  status(projectId: string): ConnectorStatus {
    const grouped = new Map<
      string,
      { app: string; state: ConnectorDescriptor["state"]; operations: number; wired: number }
    >();
    for (const entry of this.#connectors.values()) {
      const current = grouped.get(entry.descriptor.id);
      const wired = this.#wiredTools.has(entry.toolId) ? 1 : 0;
      if (!current) {
        grouped.set(entry.descriptor.id, {
          app: entry.descriptor.app,
          state: entry.descriptor.state,
          operations: 1,
          wired
        });
      } else {
        current.operations += 1;
        current.wired += wired;
      }
    }
    return {
      project_id: projectId,
      connectors: [...grouped.entries()].map(([id, info]) => ({
        id,
        app: info.app,
        state: info.state,
        transport_wired: info.wired > 0,
        operations: info.operations
      }))
    };
  }
}
