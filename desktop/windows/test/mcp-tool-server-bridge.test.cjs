"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { McpToolServerBridge } = require("../ci/mcp-tool-server-bridge.cjs");

test("McpToolServerBridge handles JSON-RPC 2.0 initialize, tools/list, schema validation, and mutating consent gates", async () => {
  const mcp = new McpToolServerBridge({
    serverName: "koswork-desktop-mcp",
    serverVersion: "2.5.0"
  });

  mcp.registerTool({
    name: "vault_read_chunk",
    description: "Reads a verified chunk from the local Vault",
    readOnly: true,
    inputSchema: {
      type: "object",
      required: ["docId", "chunkIndex"],
      additionalProperties: false,
      properties: {
        docId: { type: "string" },
        chunkIndex: { type: "number", minimum: 0, maximum: 500 }
      }
    },
    handler: async (args) => ({
      docId: args.docId,
      chunkIndex: args.chunkIndex,
      text: "Verified chunk content"
    })
  });

  mcp.registerTool({
    name: "workspace_delete_file",
    description: "Deletes a file in the workspace",
    readOnly: false,
    inputSchema: {
      type: "object",
      required: ["fileName"],
      properties: {
        fileName: { type: "string" }
      }
    },
    handler: async (args) => ({ deleted: args.fileName })
  });

  // 1. Initialize handshake
  const initRes = await mcp.handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize"
  });
  assert.equal(initRes.result.serverInfo.name, "koswork-desktop-mcp");

  // 2. List tools
  const listRes = await mcp.handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });
  assert.equal(listRes.result.tools.length, 2);

  // 3. Call read-only tool with valid arguments
  const callOk = await mcp.handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "vault_read_chunk",
      arguments: { docId: "doc_1", chunkIndex: 2 }
    }
  });
  assert.equal(callOk.result.isError, false);
  assert.ok(callOk.result.content[0].text.includes("Verified chunk content"));

  // 4. Schema validation blocks out-of-range chunkIndex
  const callBadSchema = await mcp.handleJsonRpcRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "vault_read_chunk",
      arguments: { docId: "doc_1", chunkIndex: -5 }
    }
  });
  assert.equal(callBadSchema.error.code, -32602);

  // 5. Mutating tool blocked without userConsentGranted, allowed with consent
  const callBlocked = await mcp.handleJsonRpcRequest(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "workspace_delete_file",
        arguments: { fileName: "old.txt" }
      }
    },
    { userConsentGranted: false }
  );
  assert.equal(callBlocked.error.code, -32001);

  const callConsented = await mcp.handleJsonRpcRequest(
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "workspace_delete_file",
        arguments: { fileName: "old.txt" }
      }
    },
    { userConsentGranted: true }
  );
  assert.equal(callConsented.result.isError, false);
});
