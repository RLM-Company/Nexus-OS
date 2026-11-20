/** Opt-in: read the public MCP specification wiki and save it in a temporary project. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  PolicyStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { buildApp } from "../src/app.js";
import { configuredMcpDiscovery } from "../src/mcp-discovery.js";

async function main() {
  assert.equal(process.env.COSMORA_MCP_ACCEPT_PUBLIC_READ, "1", "MCP_PUBLIC_READ_OPT_IN_REQUIRED");
  const endpoint = "https://mcp.deepwiki.com/mcp";
  const repository = "modelcontextprotocol/modelcontextprotocol";
  const origin = "https://kosmora.example";
  const owner = "local-owner";
  const database = openDatabase(":memory:");
  let app: ReturnType<typeof buildApp> | undefined;
  const methods: string[] = [];
  try {
    await runMigrations(database);
    const projects = new ProjectStore(database.sqlite);
    const { project } = projects.createProject("MCP public read acceptance", randomUUID());
    const policy = new PolicyStore(database.sqlite);
    const stop = new EmergencyStopStore(database.sqlite);
    const profile = policy.ensureProfile(project.id)!;
    const pilot = configuredMcpDiscovery(
      {
        KOSMORA_MCP_URL: endpoint,
        KOSMORA_MCP_OWNER: owner,
        KOSMORA_MCP_PROJECT: project.id,
        KOSMORA_MCP_DEEPWIKI_REPO: repository,
        KOSMORA_MCP_DOCUMENT_NAME: "mcp-wiki-outline.txt"
      },
      (target, init) => {
        assert(target instanceof URL);
        assert.equal(target.href, endpoint);
        if (init?.method === "POST") {
          assert(typeof init.body === "string");
          const rpc = JSON.parse(init.body) as { method: string; params?: unknown };
          assert(["initialize", "notifications/initialized", "tools/call"].includes(rpc.method));
          if (rpc.method === "tools/call")
            assert.deepEqual(rpc.params, {
              name: "read_wiki_structure",
              arguments: { repoName: repository }
            });
          methods.push(rpc.method);
        } else {
          assert.equal(init?.method, "DELETE");
          methods.push("session-close");
        }
        return fetch(target, init);
      }
    );
    assert(pilot?.readDocument);
    app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test", WEB_ORIGIN: origin }),
      database,
      projectStore: projects,
      policyStore: policy,
      emergencyStopStore: stop,
      mcpDiscovery: pilot
    });
    const client = app;
    const path = `/api/v1/projects/${project.id}/integrations/mcp/document`;
    const post = (action: string, payload: object) =>
      client.inject({
        method: "POST",
        url: path + "/" + action,
        payload,
        headers: { origin }
      });
    const restricted = await post("preview", { request_id: randomUUID() });
    assert.match(
      restricted.json<{ status: string }>().status,
      /^(DENIED|PAUSED|WAITING_CONFIRMATION)$/u
    );
    assert.deepEqual(methods, []);

    policy.updateProfile({
      projectId: project.id,
      baseLevel: "A5",
      overrides: [],
      expectedVersion: profile.version
    });
    const readId = randomUUID();
    const read = await post("preview", { request_id: readId });
    assert.equal(read.statusCode, 200, "MCP_PUBLIC_PREVIEW_FAILED");
    const preview = read.json<{
      preview_id: string;
      source: string;
      text: string;
      operation_id: string;
    }>();
    assert.equal(preview.source, "https://deepwiki.com/" + repository);
    assert(preview.text.includes("Protocol Specification"));
    assert.equal(projects.getMaterials(project.id, owner)?.attachments.length, 0);
    const readEntry = policy.getOperation(project.id, `mcp:${pilot.revision}:preview:${readId}`);
    assert.equal(readEntry?.operation_id, preview.operation_id);
    assert(!JSON.stringify(readEntry).includes(preview.text));
    const saveId = randomUUID();
    const payload = { request_id: saveId, preview_id: preview.preview_id };
    const saved = await post("save", payload);
    assert.equal(saved.statusCode, 200, "MCP_PUBLIC_SAVE_FAILED");
    const receipt = saved.json<{ version: number; operation_id: string }>();
    const materials = projects.getMaterials(project.id, owner);
    assert.deepEqual(materials?.attachments, [
      { name: "mcp-wiki-outline.txt", content: preview.text }
    ]);
    assert.equal(
      policy.getOperation(project.id, `mcp:${pilot.revision}:save:${saveId}`)?.operation_id,
      receipt.operation_id
    );
    const replay = await post("save", payload);
    assert.deepEqual(replay.json(), saved.json());
    const beforeStop = methods.length;
    stop.activateProject(project.id, "acceptance stop", owner, owner);
    const denied = await post("preview", { request_id: randomUUID() });
    assert.equal(denied.statusCode, 409);
    assert.deepEqual(denied.json(), { error: { code: "MCP_STOPPED" } });
    assert.equal(methods.length, beforeStop);
    assert.deepEqual(projects.getMaterials(project.id, owner), materials);
    assert.equal(methods.filter((method) => method === "tools/call").length, 1);
    console.log(
      JSON.stringify(
        {
          source: preview.source,
          outbound: methods,
          bytes: Buffer.byteLength(preview.text),
          sha256: createHash("sha256").update(preview.text).digest("hex"),
          preview_operation: preview.operation_id,
          save_operation: receipt.operation_id,
          material_version: receipt.version,
          save_replay: replay.statusCode,
          after_project_stop: denied.statusCode,
          saved_copy_matches: true
        },
        null,
        2
      )
    );
  } finally {
    await app?.close();
    database.close();
  }
}

await main();
