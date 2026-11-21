import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  PolicyStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { configuredMcpDiscovery } from "../src/mcp-discovery.js";

const origin = "https://kosmora.example";
const owner = "local-owner";
const documentUri = "fixture://workspace/report";
const otherDocumentUri = "fixture://workspace/notes";
const documentText = "Смета: 19 700 ₽\nАртикул 00123. Кроме доставки.\n";

it("lists tools through HTTP, confines the pilot to its project, and journals one discovery across replay", async () => {
  const database = openDatabase(":memory:");
  await runMigrations(database);
  const projects = new ProjectStore(database.sqlite);
  const project = projects.createProject("MCP fixture", "mcp-fixture").project;
  const another = projects.createProject("Other project", "other-fixture").project;
  const policy = new PolicyStore(database.sqlite);
  const profile = policy.ensureProfile(project.id)!;
  const stop = new EmergencyStopStore(database.sqlite);
  const methods: string[] = [];
  let returnedUri = documentUri;
  let returnedText = documentText;
  let remoteDenied = false;

  const upstream = createServer((req, res) => {
    const data: Buffer[] = [];
    req.on("data", (chunk: Buffer) => data.push(chunk));
    req.on("end", () => {
      if (req.method === "DELETE") {
        const session = req.headers["mcp-session-id"];
        methods.push("DELETE:" + (typeof session === "string" ? session : "missing"));
        res.writeHead(204).end();
        return;
      }
      const rpc = JSON.parse(Buffer.concat(data).toString("utf8")) as {
        id?: string;
        method: string;
        params?: { uri: string };
      };
      methods.push(rpc.method);
      if (remoteDenied) {
        res.writeHead(401).end();
        return;
      }
      if (rpc.method === "initialize") {
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "fixture-session"
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} } }
          })
        );
      } else if (
        req.headers["mcp-protocol-version"] !== "2025-06-18" ||
        req.headers["mcp-session-id"] !== "fixture-session"
      ) {
        res.writeHead(400).end();
      } else if (rpc.method === "notifications/initialized") {
        res.writeHead(202).end();
      } else if (
        rpc.method === "resources/read" &&
        (rpc.params?.uri === documentUri || rpc.params?.uri === otherDocumentUri)
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              contents: [
                {
                  uri: rpc.params?.uri === otherDocumentUri ? otherDocumentUri : returnedUri,
                  text:
                    rpc.params?.uri === otherDocumentUri ? "Other fixture notes." : returnedText,
                  mimeType: "text/plain"
                }
              ]
            }
          })
        );
      } else {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          "data: " +
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                tools: [{ name: "read_fixture", description: "PRIVATE_FIXTURE_TEXT" }],
                nextCursor: "fixture-cursor"
              }
            }) +
            "\n\n"
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address();
  if (!address || typeof address === "string") throw Error("Test MCP address unavailable");
  const pilot = configuredMcpDiscovery(
    {
      KOSMORA_MCP_URL: "https://mcp.example.org/catalog",
      KOSMORA_MCP_OWNER: owner,
      KOSMORA_MCP_PROJECT: project.id,
      KOSMORA_MCP_DOCUMENTS_JSON: JSON.stringify([
        { uri: documentUri, name: "report.txt" },
        { uri: otherDocumentUri, name: "notes.txt" }
      ])
    },
    (_url, init) => fetch(`http://127.0.0.1:${address.port}/catalog`, init)
  )!;
  const appDependencies = {
    config: loadServerConfig({ NODE_ENV: "test", WEB_ORIGIN: origin }),
    database,
    projectStore: projects,
    policyStore: policy,
    emergencyStopStore: stop
  };
  const app = buildApp({ ...appDependencies, mcpDiscovery: pilot });
  const [primaryId, secondaryId] = pilot.documents!.map(({ id }) => id);
  const path = `/api/v1/projects/${project.id}/integrations/mcp`;
  const discover = (id = randomUUID(), requestOrigin = origin) =>
    app.inject({
      method: "POST",
      url: path + "/discover",
      payload: { request_id: id },
      headers: { origin: requestOrigin }
    });
  const documentAction = (
    mode: "preview" | "save" | "save-copy",
    payload: object,
    projectId = project.id
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/integrations/mcp/document/${mode}`,
      payload: { document_id: primaryId, ...payload },
      headers: { origin }
    });
  const requestId = () => ({ request_id: randomUUID() });
  try {
    expect((await app.inject({ url: path })).json()).toEqual({
      configured: true,
      stopped: false,
      documents: [
        { id: primaryId, name: "report.txt" },
        { id: secondaryId, name: "notes.txt" }
      ]
    });
    expect(
      (
        await app.inject({
          url: `/api/v1/projects/${another.id}/integrations/mcp`
        })
      ).json()
    ).toEqual({ configured: false, stopped: false });
    expect((await discover(randomUUID(), "https://other.example")).statusCode).toBe(403);
    expect((await discover()).json<{ status: string }>().status).toMatch(
      /^(WAITING_CONFIRMATION|DENIED|PAUSED)$/u
    );
    expect(
      (await documentAction("preview", requestId())).json<{ status: string }>().status
    ).toMatch(/^(WAITING_CONFIRMATION|DENIED|PAUSED)$/u);
    expect((await documentAction("preview", requestId(), another.id)).statusCode).toBe(503);
    expect(
      (await documentAction("preview", { ...requestId(), document_id: "a".repeat(32) })).statusCode
    ).toBe(404);
    expect(
      (await documentAction("preview", { ...requestId(), document_id: undefined })).statusCode
    ).toBe(404);
    expect(methods).toEqual([]);

    policy.updateProfile({
      projectId: project.id,
      baseLevel: "A5",
      overrides: [],
      expectedVersion: profile.version
    });
    const id = randomUUID();
    const first = await discover(id);
    expect(first.statusCode, first.body).toBe(200);
    const output = first.json<{ operation_id: string }>();
    expect(output.operation_id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(output).toEqual({
      status: "EXECUTED",
      tools: ["read_fixture"],
      hasMore: true,
      operation_id: output.operation_id
    });
    expect(policy.getOperation(project.id, `mcp:${pilot.revision}:${id}`)).toMatchObject({
      operation_id: output.operation_id,
      status: "SUCCEEDED"
    });
    expect(first.body).not.toContain("PRIVATE_FIXTURE_TEXT");
    expect((await discover(id)).json()).toEqual(first.json());
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "DELETE:fixture-session"
    ]);

    expect(
      (await documentAction("save", { ...requestId(), preview_id: randomUUID() })).statusCode
    ).toBe(409);
    returnedUri = "fixture://workspace/wrong";
    expect((await documentAction("preview", requestId())).json()).toMatchObject({
      status: "RECOVERY_REQUIRED"
    });
    returnedUri = documentUri;
    const previewRequest = requestId();
    const previewResponse = await documentAction("preview", previewRequest);
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json<{ preview_id: string; operation_id: string }>();
    expect(preview).toMatchObject({
      status: "EXECUTED",
      name: "report.txt",
      source: documentUri,
      text: documentText
    });
    const entry = policy.getOperation(
      project.id,
      `mcp:${pilot.revision}:preview:${previewRequest.request_id}`
    );
    expect(entry).toMatchObject({ operation_id: preview.operation_id, status: "SUCCEEDED" });
    expect(JSON.stringify(entry)).not.toContain("00123");
    const otherPreview = await documentAction("preview", {
      ...requestId(),
      document_id: secondaryId
    });
    expect(otherPreview.json()).toMatchObject({
      source: otherDocumentUri,
      name: "notes.txt",
      text: "Other fixture notes."
    });
    expect(
      (
        await documentAction("save", {
          ...requestId(),
          document_id: secondaryId,
          preview_id: preview.preview_id
        })
      ).statusCode
    ).toBe(409);
    const initial = projects.getMaterials(project.id, owner)!;
    expect(initial.attachments).toEqual([]);
    projects.setMaterials(project.id, owner, {
      version: initial.version,
      instructions: "Keep this instruction",
      attachments: []
    });
    expect(
      (await documentAction("save", { ...requestId(), preview_id: preview.preview_id })).json()
    ).toMatchObject({ error: { code: "MCP_MATERIALS_CHANGED" } });

    const fresh = (await documentAction("preview", requestId())).json<{ preview_id: string }>();
    const saveRequest = { ...requestId(), preview_id: fresh.preview_id };
    const calls = methods.length;
    const saved = await documentAction("save", saveRequest);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ status: "EXECUTED", version: initial.version + 2 });
    expect((await documentAction("save", saveRequest)).json()).toEqual(saved.json());
    expect(methods).toHaveLength(calls);
    const materials = projects.getMaterials(project.id, owner);
    expect(materials).toMatchObject({
      instructions: "Keep this instruction",
      attachments: [{ name: "report.txt", content: documentText }]
    });
    expect(
      policy.getOperation(project.id, `mcp:${pilot.revision}:save:${saveRequest.request_id}`)
    ).toMatchObject({ status: "SUCCEEDED", result: { version: initial.version + 2 } });

    const again = (await documentAction("preview", requestId())).json<{ preview_id: string }>();
    const dedupRequest = { ...requestId(), preview_id: again.preview_id };
    const deduplicated = await documentAction("save", dedupRequest);
    expect(deduplicated.statusCode, deduplicated.body).toBe(200);
    expect(deduplicated.json()).toMatchObject({
      status: "EXECUTED",
      already_present: true,
      version: materials!.version
    });
    expect((await documentAction("save", dedupRequest)).json()).toEqual(deduplicated.json());
    expect(projects.getMaterials(project.id, owner)).toEqual(materials);

    returnedText = "Different remote revision.";
    const revised = (await documentAction("preview", requestId())).json<{ preview_id: string }>();
    expect(
      (await documentAction("save-copy", { ...requestId(), preview_id: revised.preview_id })).json()
    ).toMatchObject({ error: { code: "MCP_COPY_NOT_OFFERED" } });
    const collision = await documentAction("save", {
      ...requestId(),
      preview_id: revised.preview_id
    });
    expect(collision.statusCode, collision.body).toBe(409);
    expect(collision.json()).toMatchObject({
      error: { code: "MCP_DOCUMENT_NAME_CONFLICT" },
      copy_name: "report-mcp-1.txt"
    });
    expect(projects.getMaterials(project.id, owner)).toEqual(materials);

    const stalePreview = (await documentAction("preview", requestId())).json<{
      preview_id: string;
    }>();
    expect(
      (await documentAction("save", { ...requestId(), preview_id: stalePreview.preview_id }))
        .statusCode
    ).toBe(409);
    const copyRequest = { ...requestId(), preview_id: revised.preview_id };
    const copyCalls = methods.length;
    const copied = await documentAction("save-copy", copyRequest);
    expect(copied.statusCode, copied.body).toBe(200);
    expect(copied.json()).toMatchObject({
      status: "EXECUTED",
      version: materials!.version + 1,
      copy_name: "report-mcp-1.txt"
    });
    expect((await documentAction("save-copy", copyRequest)).json()).toEqual(copied.json());
    expect(
      (
        await documentAction("save-copy", { ...requestId(), preview_id: stalePreview.preview_id })
      ).json()
    ).toMatchObject({ error: { code: "MCP_MATERIALS_CHANGED" } });
    expect(methods).toHaveLength(copyCalls);
    const copiedMaterials = projects.getMaterials(project.id, owner);
    expect(copiedMaterials).toMatchObject({
      instructions: materials!.instructions,
      version: materials!.version + 1,
      attachments: [
        { name: "report.txt", content: documentText },
        { name: "report-mcp-1.txt", content: returnedText }
      ]
    });
    const afterCopy = (await documentAction("preview", requestId())).json<{ preview_id: string }>();
    expect(
      (await documentAction("save", { ...requestId(), preview_id: afterCopy.preview_id })).json()
    ).toMatchObject({
      error: { code: "MCP_DOCUMENT_NAME_CONFLICT" },
      copy_name: "report-mcp-2.txt"
    });

    remoteDenied = true;
    expect((await documentAction("preview", requestId())).json()).toMatchObject({
      status: "RECOVERY_REQUIRED"
    });
    expect((await documentAction("preview", previewRequest)).json()).toMatchObject({
      error: { code: "MCP_PREVIEW_EXPIRED" }
    });
    const beforeStop = methods.length;
    stop.activateProject(project.id, "fixture stop", owner, owner);
    expect((await documentAction("preview", requestId())).json()).toMatchObject({
      error: { code: "MCP_STOPPED" }
    });
    expect((await discover(id)).json()).toMatchObject({ error: { code: "MCP_STOPPED" } });
    expect(
      (
        await documentAction("save-copy", { ...requestId(), preview_id: afterCopy.preview_id })
      ).json()
    ).toMatchObject({ error: { code: "MCP_STOPPED" } });
    expect(methods).toHaveLength(beforeStop);
    expect(projects.getMaterials(project.id, owner)).toEqual(copiedMaterials);

    const historyPath = path + "/document/imports";
    const latest = await app.inject({ url: historyPath });
    expect(latest.statusCode, latest.body).toBe(200);
    const savedOperation = saved.json<{ operation_id: string }>().operation_id;
    const copyOperation = copied.json<{ operation_id: string }>().operation_id;
    const [copiedAt, importedAt] = latest
      .json<{ items: { imported_at: string }[] }>()
      .items.map((item) => item.imported_at);
    expect(importedAt).toMatch(/^\d{4}-/u);
    expect(copiedAt).toMatch(/^\d{4}-/u);
    expect(latest.json()).toEqual({
      items: [
        {
          operation_id: copyOperation,
          imported_at: copiedAt,
          version: initial.version + 3,
          name: "report-mcp-1.txt",
          source: documentUri,
          sha256: createHash("sha256").update(returnedText).digest("hex"),
          copy: "matched"
        },
        {
          operation_id: savedOperation,
          imported_at: importedAt,
          version: initial.version + 2,
          name: "report.txt",
          source: documentUri,
          sha256: createHash("sha256").update(documentText).digest("hex"),
          copy: "matched"
        }
      ]
    });
    expect(latest.body).not.toContain("00123");
    const restarted = buildApp(appDependencies);
    try {
      const restored = await restarted.inject({ url: historyPath });
      expect(restored.json()).toEqual(latest.json());
    } finally {
      await restarted.close();
    }
    const empty = await app.inject({
      url: `/api/v1/projects/${another.id}/integrations/mcp/document/imports`
    });
    expect(empty.json()).toEqual({ items: [] });
    projects.setMaterials(project.id, owner, {
      version: copiedMaterials!.version,
      instructions: materials!.instructions,
      attachments: [{ name: "report.txt", content: "Changed local copy." }]
    });
    expect((await app.inject({ url: historyPath })).json()).toMatchObject({
      items: [{ copy: "missing" }, { copy: "changed" }]
    });
    projects.setMaterials(project.id, owner, {
      version: copiedMaterials!.version + 1,
      instructions: materials!.instructions,
      attachments: []
    });
    expect((await app.inject({ url: historyPath })).json()).toMatchObject({
      items: [{ copy: "missing" }, { copy: "missing" }]
    });
    expect(methods).toHaveLength(beforeStop);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    database.close();
  }
});

it.each([
  "http://mcp.example.org",
  "https://127.0.0.1",
  "https://name.local",
  "https://mcp.example.org/?target=x"
])("keeps unsupported endpoint configuration disabled: %s", (url) => {
  expect(
    configuredMcpDiscovery({
      KOSMORA_MCP_URL: url,
      KOSMORA_MCP_OWNER: "owner",
      KOSMORA_MCP_PROJECT: "project"
    })
  ).toBeUndefined();
});

const wikiEndpoint = "https://mcp.deepwiki.com/mcp";
const wikiRepo = "modelcontextprotocol/modelcontextprotocol";
const wikiEnv = {
  KOSMORA_MCP_URL: wikiEndpoint,
  KOSMORA_MCP_OWNER: "owner",
  KOSMORA_MCP_PROJECT: "project",
  KOSMORA_MCP_DEEPWIKI_REPO: wikiRepo,
  KOSMORA_MCP_DOCUMENT_NAME: "outline.txt"
};

it("reads only the configured public DeepWiki outline and rejects a supplier error or another repository", async () => {
  const calls: string[] = [];
  let result: unknown = {
    content: [{ type: "text", text: "Available pages for " + wikiRepo + ":\n\n- Overview" }]
  };
  const pilot = configuredMcpDiscovery(wikiEnv, (url, init) => {
    if (!(url instanceof URL) || typeof init?.body !== "string")
      throw new Error("Invalid fixture request");
    expect(url.href).toBe(wikiEndpoint);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    const rpc = JSON.parse(init.body) as { id?: string; method: string; params?: object };
    calls.push(rpc.method);
    if (rpc.method === "notifications/initialized")
      return Promise.resolve(new Response(null, { status: 202 }));
    if (rpc.method === "tools/call")
      expect(rpc.params).toEqual({
        name: "read_wiki_structure",
        arguments: { repoName: wikiRepo }
      });
    return Promise.resolve(
      Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result:
          rpc.method === "initialize"
            ? { protocolVersion: "2025-11-25", capabilities: { tools: {} } }
            : result
      })
    );
  });
  expect(pilot?.document).toEqual({ name: "outline.txt", uri: "https://deepwiki.com/" + wikiRepo });
  await expect(pilot?.readDocument?.()).resolves.toContain("Overview");
  expect(calls).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  result = { isError: true, content: [{ type: "text", text: "Repository unavailable" }] };
  await expect(pilot?.readDocument?.()).rejects.toThrow("MCP_INVALID_DOCUMENT");
  result = { content: [{ type: "text", text: "Available pages for another/repo:\n\n- Overview" }] };
  await expect(pilot?.readDocument?.()).rejects.toThrow("MCP_INVALID_DOCUMENT");
});

it.each([
  { KOSMORA_MCP_URL: "https://example.org/mcp" },
  { KOSMORA_MCP_DEEPWIKI_REPO: "../repo" },
  { KOSMORA_MCP_DOCUMENT_URI: "fixture://wrong" },
  { KOSMORA_MCP_BEARER: "synthetic-value" }
])("keeps DeepWiki imports disabled for incompatible configuration", (changes) => {
  expect(configuredMcpDiscovery({ ...wikiEnv, ...changes })?.readDocument).toBeUndefined();
});

it.each([
  [
    { uri: documentUri, name: "a.txt" },
    { uri: documentUri, name: "b.txt" }
  ],
  [
    { uri: documentUri, name: "a.txt" },
    { uri: otherDocumentUri, name: "A.txt" }
  ],
  [{ uri: documentUri, name: "a.txt", tool: "arbitrary" }],
  [{ uri: documentUri, name: "../outside.txt" }]
])("disables the complete document allowlist when it is ambiguous or malformed", (...entries) => {
  const pilot = configuredMcpDiscovery({
    KOSMORA_MCP_URL: "https://mcp.example.org/catalog",
    KOSMORA_MCP_OWNER: owner,
    KOSMORA_MCP_PROJECT: "project",
    KOSMORA_MCP_DOCUMENTS_JSON: JSON.stringify(entries)
  });
  expect(pilot?.readDocument).toBeUndefined();
});

const multipleWikiEnv = {
  KOSMORA_MCP_URL: wikiEndpoint,
  KOSMORA_MCP_OWNER: "owner",
  KOSMORA_MCP_PROJECT: "project",
  KOSMORA_MCP_DEEPWIKI_DOCUMENTS_JSON: JSON.stringify([
    { repo: wikiRepo, name: "mcp.txt" },
    { repo: "octocat/Hello-World", name: "hello.txt" }
  ])
};

it("uses the selected DeepWiki document ID to read exactly one configured repository", async () => {
  const calls: string[] = [];
  const pilot = configuredMcpDiscovery(multipleWikiEnv, (_url, init) => {
    if (typeof init?.body !== "string") throw new Error("Invalid request");
    const rpc = JSON.parse(init.body) as { id?: string; method: string; params?: object };
    calls.push(rpc.method);
    if (!rpc.id) return Promise.resolve(new Response(null, { status: 202 }));
    if (rpc.method === "tools/call")
      expect(rpc.params).toEqual({
        name: "read_wiki_structure",
        arguments: { repoName: "octocat/Hello-World" }
      });
    return Promise.resolve(
      Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result:
          rpc.method === "initialize"
            ? { protocolVersion: "2025-11-25", capabilities: { tools: {} } }
            : {
                content: [
                  { type: "text", text: "Available pages for octocat/Hello-World:\n- Overview" }
                ]
              }
      })
    );
  });
  await expect(pilot?.readDocument?.()).rejects.toThrow("MCP_DOCUMENT_UNAVAILABLE");
  await expect(pilot?.readDocument?.("0".repeat(32))).rejects.toThrow("MCP_DOCUMENT_UNAVAILABLE");
  expect(calls).toEqual([]);
  expect(pilot?.documents?.map(({ name }) => name)).toEqual(["mcp.txt", "hello.txt"]);
  await expect(pilot?.readDocument?.(pilot.documents?.[1]?.id)).resolves.toContain(
    "octocat/Hello-World"
  );
  expect(calls).toEqual(["initialize", "notifications/initialized", "tools/call"]);
});

it.each([
  { KOSMORA_MCP_URL: "https://example.org/mcp" },
  { KOSMORA_MCP_DOCUMENTS_JSON: "[]" },
  { KOSMORA_MCP_BEARER: "synthetic" },
  {
    KOSMORA_MCP_DEEPWIKI_DOCUMENTS_JSON: JSON.stringify([
      { repo: "octocat/Hello-World", name: "hello.txt" },
      { repo: "OCTOCAT/hello-world", name: "duplicate.txt" }
    ])
  }
])(
  "disables a DeepWiki list when it conflicts with the provider or contains duplicates",
  (changes) => {
    expect(configuredMcpDiscovery({ ...multipleWikiEnv, ...changes })?.documents).toBeUndefined();
  }
);
