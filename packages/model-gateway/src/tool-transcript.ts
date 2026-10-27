import type { ModelRequest } from "@cosmora/contracts";
import { GatewayRunError } from "./types.js";

export const MAX_TOOL_ARGUMENT_BYTES = 65_536;
export const MAX_TOOL_CALLS = 16;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const namePattern = /^[A-Za-z0-9_-]{1,64}$/u;

export const usesTools = (request: ModelRequest): boolean =>
  Boolean(
    request.tools?.length ||
    request.messages.some(
      (message) => message.role === "tool" || message.tool_calls || message.tool_call_id
    )
  );

export const assertToolArguments = (argumentsJson: string): void => {
  if (
    typeof argumentsJson !== "string" ||
    new TextEncoder().encode(argumentsJson).length > MAX_TOOL_ARGUMENT_BYTES
  ) {
    throw new Error("Invalid tool arguments");
  }
  const value: unknown = JSON.parse(argumentsJson);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be a JSON object");
  }
};

export const assertToolCall = (
  id: string,
  name: string,
  argumentsJson: string,
  names: Set<string>
): void => {
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !idPattern.test(id) ||
    !namePattern.test(name) ||
    !names.has(name)
  ) {
    throw new Error("Invalid tool identity");
  }
  assertToolArguments(argumentsJson);
};

/** Prevent forged/orphan/duplicate results and privilege-smuggling via tool transcripts. */
export const assertToolTranscript = (request: ModelRequest, provider: string): Set<string> => {
  try {
    const names = new Set<string>();
    if (request.tools) {
      if (request.tools.length === 0 || request.tools.length > MAX_TOOL_CALLS)
        throw new Error("Invalid tools");
      for (const tool of request.tools) {
        if (
          tool.type !== "function" ||
          typeof tool.function.name !== "string" ||
          !namePattern.test(tool.function.name) ||
          names.has(tool.function.name)
        ) {
          throw new Error("Invalid tools");
        }
        if (
          tool.function.description !== undefined &&
          (typeof tool.function.description !== "string" ||
            tool.function.description.length > 2_000)
        )
          throw new Error("Invalid tools");
        const parameters = tool.function.parameters;
        if (
          !parameters ||
          typeof parameters !== "object" ||
          Array.isArray(parameters) ||
          parameters.type !== "object" ||
          new TextEncoder().encode(JSON.stringify(parameters)).length > MAX_TOOL_ARGUMENT_BYTES
        )
          throw new Error("Invalid tools");
        names.add(tool.function.name);
      }
    }
    const pending = new Set<string>();
    const allIds = new Set<string>();
    for (const message of request.messages) {
      if (message.role === "tool") {
        if (
          message.tool_calls ||
          message.images ||
          !message.tool_call_id ||
          !pending.delete(message.tool_call_id)
        ) {
          throw new Error("Invalid result");
        }
        continue;
      }
      if (message.tool_call_id || pending.size) throw new Error("Missing result");
      if (!message.tool_calls) continue;
      if (
        message.role !== "assistant" ||
        message.images ||
        message.tool_calls.length === 0 ||
        message.tool_calls.length > MAX_TOOL_CALLS
      ) {
        throw new Error("Invalid calls");
      }
      for (const call of message.tool_calls) {
        if (call.type !== "function" || allIds.has(call.id)) throw new Error("Invalid calls");
        assertToolCall(call.id, call.function.name, call.function.arguments, names);
        allIds.add(call.id);
        pending.add(call.id);
      }
    }
    if (pending.size) throw new Error("Missing result");
    return names;
  } catch (cause) {
    throw new GatewayRunError(
      "PROVIDER_ERROR",
      provider,
      "Invalid structured tool transcript",
      false,
      { cause }
    );
  }
};
