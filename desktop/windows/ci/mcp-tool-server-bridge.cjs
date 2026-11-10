"use strict";

/**
 * Zero-dependency Model Context Protocol (MCP) & JSON-RPC 2.0 Local Tool Server Bridge
 * for Koswork Windows Desktop.
 * Supports `initialize`, `tools/list`, and `tools/call` with strict JSON Schema validation
 * and mutating-tool consent gating.
 */

class McpToolServerBridge {
  constructor(options = {}) {
    this.serverName = options.serverName || "koswork-local-mcp-server";
    this.serverVersion = options.serverVersion || "1.0.0";
    this.tools = new Map();
  }

  /**
   * Registers an MCP tool with JSON Schema input validation and handler.
   */
  registerTool(spec) {
    if (!spec || !spec.name || typeof spec.handler !== "function") {
      throw new Error("INVALID_MCP_TOOL_SPEC: name and handler are required");
    }
    this.tools.set(spec.name, {
      name: spec.name,
      description: spec.description || "",
      readOnly: spec.readOnly !== false,
      inputSchema: spec.inputSchema || { type: "object", properties: {}, required: [] },
      handler: spec.handler
    });
  }

  validateArguments(schema, args) {
    const errors = [];
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return ["Arguments must be a JSON object"];
    }

    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const reqKey of required) {
      if (!(reqKey in args) || args[reqKey] === undefined || args[reqKey] === null) {
        errors.push(`Missing required parameter '${reqKey}'`);
      }
    }

    const props = schema.properties || {};
    for (const [key, val] of Object.entries(args)) {
      const propSchema = props[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          errors.push(`Unknown parameter '${key}' is not allowed`);
        }
        continue;
      }

      if (propSchema.type === "string" && typeof val !== "string") {
        errors.push(`Parameter '${key}' must be a string`);
      } else if (propSchema.type === "number" && typeof val !== "number") {
        errors.push(`Parameter '${key}' must be a number`);
      } else if (propSchema.type === "boolean" && typeof val !== "boolean") {
        errors.push(`Parameter '${key}' must be a boolean`);
      }

      if (typeof val === "number") {
        if (propSchema.minimum !== undefined && val < propSchema.minimum) {
          errors.push(`Parameter '${key}' (${val}) is below minimum ${propSchema.minimum}`);
        }
        if (propSchema.maximum !== undefined && val > propSchema.maximum) {
          errors.push(`Parameter '${key}' (${val}) exceeds maximum ${propSchema.maximum}`);
        }
      }
    }

    return errors;
  }

  /**
   * Processes a JSON-RPC 2.0 request envelope (`initialize`, `tools/list`, `tools/call`).
   */
  async handleJsonRpcRequest(request, context = {}) {
    if (!request || request.jsonrpc !== "2.0" || !request.method) {
      return {
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC 2.0 Request" }
      };
    }

    const id = request.id ?? null;

    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: {
            name: this.serverName,
            version: this.serverVersion
          },
          capabilities: {
            tools: { listChanged: false }
          }
        }
      };
    }

    if (request.method === "tools/list") {
      const toolList = Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        readOnlyHint: t.readOnly,
        inputSchema: t.inputSchema
      }));
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: toolList }
      };
    }

    if (request.method === "tools/call") {
      const toolName = request.params?.name;
      const toolArgs = request.params?.arguments ?? {};
      const tool = this.tools.get(toolName);

      if (!tool) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `MCP tool not found: ${toolName}` }
        };
      }

      if (!tool.readOnly && !context.userConsentGranted) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32001,
            message: `MCP_CONSENT_REQUIRED: Mutating tool '${toolName}' requires explicit user consent`
          }
        };
      }

      const validationErrors = this.validateArguments(tool.inputSchema, toolArgs);
      if (validationErrors.length > 0) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: `Invalid tool arguments: ${validationErrors.join("; ")}`
          }
        };
      }

      try {
        const output = await tool.handler(toolArgs, context);
        const textOutput = typeof output === "string" ? output : JSON.stringify(output);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: textOutput }],
            isError: false
          }
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
            isError: true
          }
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${request.method}` }
    };
  }
}

module.exports = {
  McpToolServerBridge
};
