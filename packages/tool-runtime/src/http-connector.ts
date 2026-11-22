import type { ConnectorTransport } from "./connector-registry.js";

/**
 * Stage-three item 4: a compatible HTTP API / MCP connector adapter.
 *
 * This is deliberately NOT a new network client with its own permissions:
 * it is a ConnectorTransport that can be bound to ConnectorRegistry, so every
 * invocation still goes through GuardedToolRuntime (policy verdict,
 * confirmation, idempotency, owner/project scope, replay, RECOVERY_REQUIRED).
 *
 * The fetch implementation is injectable. Tests and local acceptance use a
 * fixture; a real deployment must inject a vetted, owner-approved transport.
 * No credentials, tokens or endpoints live in descriptors or in this module.
 */
export type HttpConnectorInput = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export type HttpConnectorResult = {
  status: number;
  ok: boolean;
  body: string;
};

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ status: number; text(): Promise<string> }>;

/** Allowlist of URL prefixes. A connector can never call an arbitrary host. */
export type HttpConnectorOptions = {
  baseUrl: string;
  allowedPrefixes?: readonly string[];
  fetchImpl: HttpFetch;
  maxResponseBytes?: number;
};

const DEFAULT_MAX_BYTES = 256_000;
const SAFE_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

export function createHttpConnectorTransport(options: HttpConnectorOptions): ConnectorTransport {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new Error("INVALID_CONNECTOR_BASE_URL");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:")
    throw new Error("INVALID_CONNECTOR_BASE_URL");
  const prefixes = options.allowedPrefixes ?? [base.pathname.replace(/\/$/, "") + "/"];
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;

  return {
    async execute(input: unknown): Promise<HttpConnectorResult> {
      const value = input as HttpConnectorInput;
      if (!value || typeof value.path !== "string" || !value.path.startsWith("/"))
        throw new Error("INVALID_CONNECTOR_PATH");
      const method = value.method ?? "GET";
      if (!SAFE_METHODS.has(method)) throw new Error("INVALID_CONNECTOR_METHOD");
      const url = new URL(value.path, base);
      if (url.origin !== base.origin || !prefixes.some((prefix) => url.pathname.startsWith(prefix)))
        throw new Error("CONNECTOR_PATH_NOT_ALLOWED");
      const headers: Record<string, string> = { ...(value.headers ?? {}) };
      // Never forward an authorization header from untrusted input; credentials
      // belong to the vetted transport, not to a model-supplied payload.
      delete headers.authorization;
      delete headers["x-api-key"];
      let body: string | undefined;
      if (value.body !== undefined) {
        body = JSON.stringify(value.body);
        headers["content-type"] = "application/json";
      }
      const response = await options.fetchImpl(url.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body })
      });
      const text = await response.text();
      if (text.length > maxBytes) throw new Error("CONNECTOR_RESPONSE_TOO_LARGE");
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        body: text
      };
    }
  };
}

/** MCP-style tool descriptor: a namespaced tool call with a JSON payload.
 * The transport is still HTTP-compatible; MCP semantics are expressed as a
 * method/path convention rather than a second runtime. */
export function mcpToolCall(tool: string, args: unknown): HttpConnectorInput {
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(tool)) throw new Error("INVALID_MCP_TOOL_NAME");
  return { path: `/tools/${encodeURIComponent(tool)}/call`, method: "POST", body: { args } };
}
