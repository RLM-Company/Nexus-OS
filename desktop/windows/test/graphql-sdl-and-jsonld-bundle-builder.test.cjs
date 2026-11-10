"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  GraphqlSdlAndJsonLdBundleBuilder
} = require("../workspace/graphql-sdl-and-jsonld-bundle-builder.cjs");

test("GraphQL SDL & W3C JSON-LD 1.1 Bundle Builder emits valid .graphql schema and .jsonld linked data context", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-gql-jsonld-"));
  try {
    const res = GraphqlSdlAndJsonLdBundleBuilder.writeBundleFiles(tmpDir, "kosmora-kg", {
      schemaName: "KosmoraKernelOntology",
      baseIri: "https://kosmora.ai/ontology#",
      types: [
        {
          name: "AgentTask",
          fields: [
            { name: "id", gqlType: "ID!" },
            { name: "status", gqlType: "String!" }
          ]
        }
      ],
      queries: [
        {
          name: "getTask",
          args: [{ name: "id", gqlType: "ID!" }],
          returnType: "AgentTask"
        }
      ],
      mutations: [
        {
          name: "dispatchTask",
          args: [{ name: "status", gqlType: "String!" }],
          returnType: "AgentTask!"
        }
      ],
      entities: [{ "@id": "urn:task:1", "@type": "AgentTask", status: "COMPLETED" }]
    });

    assert.ok(res.graphqlSdlText.includes("type AgentTask @semantic"));
    assert.ok(res.graphqlSdlText.includes("getTask(id: ID!): AgentTask"));
    assert.equal(res.jsonLdDocument["@context"]["@version"], 1.1);
    assert.equal(fs.existsSync(res.graphqlPath), true);
    assert.equal(fs.existsSync(res.jsonldPath), true);
    assert.equal(res.bundleSha256.length, 64);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
