import test from "node:test";
import assert from "node:assert/strict";
import {
  SpeculativeToolRouter,
  parsePartialToolJson,
  isReadOnlyTool,
  DEFAULT_READ_ONLY_TOOLS
} from "../../../packages/core/src/speculative-tool-router.js";

test("parsePartialToolJson extracts tool names and partial or full arguments from streaming chunks", () => {
  // 1. Incomplete XML format
  const xmlChunk1 = "Thinking about the document... <tool_call><name>vault_read</name><args>{\"path\": \"/docs/rep";
  const parsed1 = parsePartialToolJson(xmlChunk1);
  assert.equal(parsed1.name, "vault_read");
  assert.equal(parsed1.complete, false);

  // 2. Complete XML format
  const xmlChunk2 = "<tool_call><name>vault_read</name><args>{\"path\": \"/docs/report.docx\", \"maxChunks\": 5}</args></tool_call>";
  const parsed2 = parsePartialToolJson(xmlChunk2);
  assert.equal(parsed2.name, "vault_read");
  assert.equal(parsed2.complete, true);
  assert.deepEqual(parsed2.args, { path: "/docs/report.docx", maxChunks: 5 });

  // 3. JSON format
  const jsonChunk = "I will search context memory: {\"name\": \"context_memory_search\", \"arguments\": {\"query\": \"budget 2026\", \"limit\": 10}}";
  const parsed3 = parsePartialToolJson(jsonChunk);
  assert.equal(parsed3.name, "context_memory_search");
  assert.equal(parsed3.complete, true);
  assert.deepEqual(parsed3.args, { query: "budget 2026", limit: 10 });
});

test("isReadOnlyTool classifies safe vs mutating operations accurately", () => {
  assert.equal(isReadOnlyTool("vault_read"), true);
  assert.equal(isReadOnlyTool("context_memory_search"), true);
  assert.equal(isReadOnlyTool("browser_page_inspect"), true);
  assert.equal(isReadOnlyTool("dense_vector_search"), true);

  assert.equal(isReadOnlyTool("desktop_click"), false);
  assert.equal(isReadOnlyTool("drive_write"), false);
  assert.equal(isReadOnlyTool("workflow_step_execute"), false);
  assert.equal(isReadOnlyTool("account_payout"), false);
});

test("SpeculativeToolRouter executes safe read-only tools speculatively and yields instant resolution hits", async () => {
  let executeCallCount = 0;
  const router = new SpeculativeToolRouter({
    executors: {
      vault_read: async (args, ctx) => {
        executeCallCount++;
        // Simulate 40ms retrieval latency
        await new Promise(r => setTimeout(r, 40));
        return { content: `Extracted content for ${args.path}`, owner: ctx.ownerId };
      }
    }
  });

  const sessionId = "sess-spec-001";
  const ownerId = "owner-alpha";

  // Stream token chunks
  const chunk1 = "Let me look up the vault file: <tool_call><name>vault_read</name><args>{\"path\": \"/vault/contract.docx\"";
  const events1 = router.pushStreamChunk(sessionId, chunk1, { ownerId, callIndex: 0 });

  assert.ok(events1.some(e => e.type === "intent_detected"));
  assert.ok(events1.some(e => e.type === "speculation_started"));
  assert.equal(executeCallCount, 1);

  // Complete streaming
  const chunk2 = "}</args></tool_call>";
  router.pushStreamChunk(sessionId, chunk2, { ownerId, callIndex: 0 });

  // Wait 50ms for background speculation to finish
  await new Promise(r => setTimeout(r, 50));

  // Now the LLM finalized the tool call with exact same args
  const resolution = await router.resolveFinalToolCall(
    sessionId,
    0,
    { name: "vault_read", args: { path: "/vault/contract.docx" } },
    { ownerId }
  );

  assert.equal(resolution.speculativeHit, true);
  assert.ok(resolution.timeSavedMs > 0, `Expected timeSavedMs > 0, got ${resolution.timeSavedMs}`);
  assert.equal(resolution.result.owner, "owner-alpha");
  assert.equal(resolution.result.content, "Extracted content for /vault/contract.docx");
  assert.equal(executeCallCount, 1, "Executor should not have been called a second time");

  const tel = router.getTelemetry(sessionId);
  assert.equal(tel.speculativeHits, 1);
  assert.equal(tel.speculativeMisses, 0);
  assert.ok(tel.totalTimeSavedMs > 0);
});

test("SpeculativeToolRouter strictly defers mutating actions and does not execute them speculatively", async () => {
  let mutatingExecuted = false;
  const router = new SpeculativeToolRouter({
    executors: {
      desktop_click: async (args) => {
        mutatingExecuted = true;
        return { clicked: true, x: args.x, y: args.y };
      }
    }
  });

  const sessionId = "sess-mutating-002";
  const ownerId = "owner-alpha";

  // Streaming a mutating tool
  const chunk = "<tool_call><name>desktop_click</name><args>{\"x\": 250, \"y\": 400}</args></tool_call>";
  const events = router.pushStreamChunk(sessionId, chunk, { ownerId, callIndex: 0 });

  assert.ok(events.some(e => e.type === "mutating_deferred"));
  assert.equal(mutatingExecuted, false, "Mutating tool must NOT be executed speculatively");

  // When final call is resolved, it executes safely through normal non-speculative path
  const resolution = await router.resolveFinalToolCall(
    sessionId,
    0,
    { name: "desktop_click", args: { x: 250, y: 400 } },
    { ownerId }
  );

  assert.equal(resolution.speculativeHit, false);
  assert.equal(mutatingExecuted, true);
  assert.equal(resolution.result.clicked, true);

  const tel = router.getTelemetry(sessionId);
  assert.equal(tel.mutatingDeferred, 1);
  assert.equal(tel.speculativeHits, 0);
});

test("SpeculativeToolRouter discards speculation on argument mismatch and aborts on session cancellation", async () => {
  let aborted = false;
  let runCount = 0;

  const router = new SpeculativeToolRouter({
    executors: {
      vault_search: async (args, ctx) => {
        runCount++;
        if (ctx.signal) {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
          });
        }
        await new Promise(r => setTimeout(r, 60));
        return { matches: [args.query] };
      }
    }
  });

  const sessionId = "sess-mismatch-003";
  const ownerId = "owner-beta";

  // Initial speculation on "queryA"
  router.pushStreamChunk(sessionId, "<tool_call><name>vault_search</name><args>{\"query\": \"queryA\"}", { ownerId, callIndex: 0 });
  assert.equal(runCount, 1);

  // LLM actually decided to finalize on "queryB"
  const resolution = await router.resolveFinalToolCall(
    sessionId,
    0,
    { name: "vault_search", args: { query: "queryB" } },
    { ownerId }
  );

  assert.equal(resolution.speculativeHit, false);
  assert.deepEqual(resolution.result, { matches: ["queryB"] });
  assert.equal(runCount, 2);

  // Abort test
  const abortSessionId = "sess-abort-004";
  router.pushStreamChunk(abortSessionId, "<tool_call><name>vault_search</name><args>{\"query\": \"cancelMe\"}", { ownerId, callIndex: 0 });
  router.abortSession(abortSessionId);
  assert.equal(aborted, true);
});
