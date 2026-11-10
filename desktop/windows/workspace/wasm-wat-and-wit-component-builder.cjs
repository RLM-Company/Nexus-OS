"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * W3C WebAssembly Text Format (.wat S-expression) & Bytecode Alliance WIT
 * Component Interface (.wit) Bundle Builder for Kosmora Desktop Workspace.
 */
class WasmWatAndWitComponentBuilder {
  static buildBundle(spec) {
    const packageNamespace = spec.packageNamespace || "kosmora:sandbox@1.0.0";
    const worldName = spec.worldName || "cognitive-plugin";
    const memoryPages = spec.memoryPages || 1;
    const exportedFunctions = Array.isArray(spec.exportedFunctions) ? spec.exportedFunctions : [];

    const watLines = [
      `(module`,
      `  ;; Kosmora WebAssembly S-Expression Module (${packageNamespace})`,
      `  (memory (export "memory") ${memoryPages})`
    ];

    const witLines = [
      `package ${packageNamespace};`,
      ``,
      `interface runtime-ops {`
    ];

    for (const fn of exportedFunctions) {
      const paramsWat = (fn.params || [])
        .map((p) => `(param $${p.name} ${p.wasmType || "i32"})`)
        .join(" ");
      const resultWat = fn.resultWasmType ? `(result ${fn.resultWasmType})` : "";
      const bodyWat = fn.bodySExpr || `local.get 0`;

      watLines.push(
        `  (func (export "${fn.name}") ${paramsWat} ${resultWat}`,
        `    ${bodyWat}`,
        `  )`
      );

      const paramsWit = (fn.params || [])
        .map((p) => `${p.name}: ${p.witType || "s32"}`)
        .join(", ");
      const resultWit = fn.resultWitType ? ` -> ${fn.resultWitType}` : "";
      witLines.push(`  ${fn.name}: func(${paramsWit})${resultWit};`);
    }

    watLines.push(`)`);
    witLines.push(`}`, ``, `world ${worldName} {`, `  export runtime-ops;`, `}`);

    const watText = watLines.join("\n") + "\n";
    const witText = witLines.join("\n") + "\n";

    const bundleSha256 = crypto
      .createHash("sha256")
      .update(watText)
      .update(witText)
      .digest("hex");

    return {
      watText,
      witText,
      bundleSha256
    };
  }

  static writeBundleFiles(outputDir, baseName, spec) {
    fs.mkdirSync(outputDir, { recursive: true });
    const built = WasmWatAndWitComponentBuilder.buildBundle(spec);
    const watPath = path.join(outputDir, `${baseName}.wat`);
    const witPath = path.join(outputDir, `${baseName}.wit`);
    fs.writeFileSync(watPath, built.watText, "utf8");
    fs.writeFileSync(witPath, built.witText, "utf8");
    return {
      ...built,
      watPath,
      witPath
    };
  }
}

module.exports = { WasmWatAndWitComponentBuilder };
