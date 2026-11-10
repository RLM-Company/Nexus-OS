"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ProtobufV3AndGrpcBundleBuilder
} = require("../workspace/protobuf-v3-and-grpc-bundle-builder.cjs");

test("Protobuf v3 & gRPC Service Descriptor Builder emits valid .proto definitions and .grpc.json reflection manifests", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-proto-grpc-"));
  try {
    const res = ProtobufV3AndGrpcBundleBuilder.writeBundleFiles(tmpDir, "kosmora-rpc", {
      packageName: "kosmora.intelligence.v1",
      enums: [
        {
          name: "ExecutionPriority",
          values: [
            { name: "EXECUTION_PRIORITY_UNSPECIFIED", number: 0 },
            { name: "EXECUTION_PRIORITY_REALTIME", number: 1 }
          ]
        }
      ],
      messages: [
        {
          name: "TurnRequest",
          fields: [
            { name: "session_id", protoType: "string", tagNumber: 1 },
            { name: "priority", protoType: "ExecutionPriority", tagNumber: 2 }
          ]
        },
        {
          name: "TurnResponse",
          fields: [
            { name: "answer_markdown", protoType: "string", tagNumber: 1 },
            { name: "citations", protoType: "string", tagNumber: 2, repeated: true }
          ]
        }
      ],
      services: [
        {
          name: "CognitiveOrchestratorService",
          methods: [
            {
              name: "ExecuteTurn",
              requestType: "TurnRequest",
              responseType: "TurnResponse",
              serverStreaming: true
            }
          ]
        }
      ]
    });

    assert.ok(res.protoText.includes('syntax = "proto3";'));
    assert.ok(
      res.protoText.includes("rpc ExecuteTurn(TurnRequest) returns (stream TurnResponse);")
    );
    assert.equal(fs.existsSync(res.protoPath), true);
    assert.equal(fs.existsSync(res.grpcJsonPath), true);
    assert.equal(res.bundleSha256.length, 64);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
