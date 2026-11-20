/** Opt-in: read public DeepWiki outlines and save copies in a temporary project. */
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
  const documents = [
    {
      repo: "modelcontextprotocol/modelcontextprotocol",
      name: "mcp-wiki-outline.txt",
      heading: "Protocol Specification"
    },
    {
      repo: "octocat/Hello-World",
      name: "hello-world-outline.txt",
      heading: "Repository Structure"
    }
  ];
  if (process.env.COSMORA_MCP_ACCEPT_MULTIPLE !== "1") documents.length = 1;
  const origin = "https://kosmora.example";
  const owner = "local-owner";
  const database = openDatabase(":memory:");
  let app: ReturnType<typeof buildApp> | undefined;
  const methods: string[] = [];
  const readRepositories: string[] = [];
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
        ...(documents.length === 1
          ? {
              KOSMORA_MCP_DEEPWIKI_REPO: documents[0]!.repo,
              KOSMORA_MCP_DOCUMENT_NAME: documents[0]!.name
            }
          : {
              KOSMORA_MCP_DEEPWIKI_DOCUMENTS_JSON: JSON.stringify(
                documents.map(({ repo, name }) => ({ repo, name }))
              )
            })
      },
      (target, init) => {
        assert(target instanceof URL);
        assert.equal(target.href, endpoint);
        if (init?.method === "POST") {
          assert(typeof init.body === "string");
          const rpc = JSON.parse(init.body) as { method: string; params?: unknown };
          assert(["initialize", "notifications/initialized", "tools/call"].includes(rpc.method));
          if (rpc.method === "tools/call") {
            const expected = documents[readRepositories.length];
            assert(expected, "UNEXPECTED_PROVIDER_READ");
            assert.deepEqual(rpc.params, {
              name: "read_wiki_structure",
              arguments: { repoName: expected.repo }
            });
            readRepositories.push(expected.repo);
          }
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
    const candidates = pilot.documents;
    assert.equal(candidates?.length, documents.length);
    const selectors = candidates.map(({ id }) => (documents.length > 1 ? { document_id: id } : {}));
    const restricted = await post("preview", { request_id: randomUUID(), ...selectors[0] });
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
    if (documents.length > 1) {
      const unknown = await post("preview", {
        request_id: randomUUID(),
        document_id: "0".repeat(32)
      });
      assert.equal(unknown.statusCode, 404);
      assert.deepEqual(methods, []);
    }
    const receipts: {
      source: string;
      bytes: number;
      sha256: string;
      preview_operation: string;
      save_operation: string;
      material_version: number;
    }[] = [];
    const savedAttachments: { name: string; content: string }[] = [];
    for (const [index, item] of documents.entries()) {
      const selector = selectors[index];
      const readId = randomUUID();
      const read = await post("preview", { request_id: readId, ...selector });
      assert.equal(read.statusCode, 200, "MCP_PUBLIC_PREVIEW_FAILED");
      const preview = read.json<{
        preview_id: string;
        source: string;
        text: string;
        operation_id: string;
      }>();
      assert.equal(preview.source, "https://deepwiki.com/" + item.repo);
      assert(preview.text.includes(item.heading));
      assert.equal(projects.getMaterials(project.id, owner)?.attachments.length, index);
      const readEntry = policy.getOperation(project.id, `mcp:${pilot.revision}:preview:${readId}`);
      assert.equal(readEntry?.operation_id, preview.operation_id);
      assert(!JSON.stringify(readEntry).includes(preview.text));
      if (index === 0 && documents.length > 1) {
        const substituted = await post("save", {
          request_id: randomUUID(),
          preview_id: preview.preview_id,
          ...selectors[1]
        });
        assert.equal(substituted.statusCode, 409);
        assert.equal(projects.getMaterials(project.id, owner)?.attachments.length, 0);
      }

      const saveId = randomUUID();
      const payload = { request_id: saveId, preview_id: preview.preview_id, ...selector };
      const saved = await post("save", payload);
      assert.equal(saved.statusCode, 200, "MCP_PUBLIC_SAVE_FAILED");
      const receipt = saved.json<{ version: number; operation_id: string }>();
      savedAttachments.push({ name: item.name, content: preview.text });
      assert.deepEqual(projects.getMaterials(project.id, owner)?.attachments, savedAttachments);
      assert.equal(
        policy.getOperation(project.id, `mcp:${pilot.revision}:save:${saveId}`)?.operation_id,
        receipt.operation_id
      );
      const replay = await post("save", payload);
      assert.deepEqual(replay.json(), saved.json());
      receipts.push({
        source: preview.source,
        bytes: Buffer.byteLength(preview.text),
        sha256: createHash("sha256").update(preview.text).digest("hex"),
        preview_operation: preview.operation_id,
        save_operation: receipt.operation_id,
        material_version: receipt.version
      });
    }
    const beforeStop = methods.length;
    stop.activateProject(project.id, "acceptance stop", owner, owner);
    const denied = await post("preview", { request_id: randomUUID(), ...selectors[0] });
    assert.equal(denied.statusCode, 409);
    assert.deepEqual(denied.json(), { error: { code: "MCP_STOPPED" } });
    assert.equal(methods.length, beforeStop);
    assert.deepEqual(projects.getMaterials(project.id, owner)?.attachments, savedAttachments);
    assert.deepEqual(
      readRepositories,
      documents.map(({ repo }) => repo)
    );
    const imports = await client.inject({ url: path + "/imports" });
    assert.equal(imports.statusCode, 200);
    const history = imports.json<{
      items: {
        operation_id: string;
        source: string;
        sha256: string;
        version: number;
        copy: string;
      }[];
    }>().items;
    assert.deepEqual(
      history.map(({ operation_id, source, sha256, version, copy }) => ({
        operation_id,
        source,
        sha256,
        version,
        copy
      })),
      [...receipts].reverse().map((receipt) => ({
        operation_id: receipt.save_operation,
        source: receipt.source,
        sha256: receipt.sha256,
        version: receipt.material_version,
        copy: "matched"
      }))
    );
    for (const { content } of savedAttachments) assert(!imports.body.includes(content));
    assert.equal(methods.length, beforeStop);
    console.log(
      JSON.stringify(
        {
          documents: receipts,
          outbound: methods,
          repositories_read: readRepositories,
          saved_copies_match: true,
          verified_import_receipts: history.length,
          after_project_stop: denied.statusCode
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
