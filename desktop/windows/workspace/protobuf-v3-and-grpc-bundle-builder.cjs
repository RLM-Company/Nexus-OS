"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Protocol Buffers v3 (.proto) & gRPC Service Descriptor (.grpc.json) Bundle Builder
 * for Kosmora Desktop Workspace.
 */
class ProtobufV3AndGrpcBundleBuilder {
  static buildBundle(spec) {
    const packageName = spec.packageName || "kosmora.kernel.v1";
    const goPackage = spec.goPackage || "github.com/rlm/kosmora/gen/kernel/v1;kernelv1";
    const enums = Array.isArray(spec.enums) ? spec.enums : [];
    const messages = Array.isArray(spec.messages) ? spec.messages : [];
    const services = Array.isArray(spec.services) ? spec.services : [];

    const protoLines = [
      `syntax = "proto3";`,
      `package ${packageName};`,
      `option go_package = "${goPackage}";`
    ];

    for (const en of enums) {
      protoLines.push("");
      protoLines.push(`enum ${en.name} {`);
      for (const v of en.values || []) {
        protoLines.push(`  ${v.name} = ${v.number};`);
      }
      protoLines.push(`}`);
    }

    for (const msg of messages) {
      protoLines.push("");
      protoLines.push(`message ${msg.name} {`);
      for (const f of msg.fields || []) {
        const prefix = f.repeated ? "repeated " : f.optional ? "optional " : "";
        protoLines.push(`  ${prefix}${f.protoType} ${f.name} = ${f.tagNumber};`);
      }
      protoLines.push(`}`);
    }

    for (const svc of services) {
      protoLines.push("");
      protoLines.push(`service ${svc.name} {`);
      for (const rpc of svc.methods || []) {
        const reqStream = rpc.clientStreaming ? "stream " : "";
        const resStream = rpc.serverStreaming ? "stream " : "";
        protoLines.push(
          `  rpc ${rpc.name}(${reqStream}${rpc.requestType}) returns (${resStream}${rpc.responseType});`
        );
      }
      protoLines.push(`}`);
    }

    const protoText = protoLines.join("\n") + "\n";
    const descriptorObject = {
      syntax: "proto3",
      package: packageName,
      enums,
      messages,
      services
    };
    const descriptorJsonText = JSON.stringify(descriptorObject, null, 2) + "\n";

    const bundleSha256 = crypto
      .createHash("sha256")
      .update(protoText)
      .update(descriptorJsonText)
      .digest("hex");

    return {
      protoText,
      descriptorObject,
      descriptorJsonText,
      bundleSha256
    };
  }

  static writeBundleFiles(outputDir, baseName, spec) {
    fs.mkdirSync(outputDir, { recursive: true });
    const built = ProtobufV3AndGrpcBundleBuilder.buildBundle(spec);
    const protoPath = path.join(outputDir, `${baseName}.proto`);
    const grpcJsonPath = path.join(outputDir, `${baseName}.grpc.json`);
    fs.writeFileSync(protoPath, built.protoText, "utf8");
    fs.writeFileSync(grpcJsonPath, built.descriptorJsonText, "utf8");
    return {
      ...built,
      protoPath,
      grpcJsonPath
    };
  }
}

module.exports = { ProtobufV3AndGrpcBundleBuilder };
