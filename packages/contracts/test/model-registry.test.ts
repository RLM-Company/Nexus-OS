import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ModelRegistryDocumentSchema, type ModelRegistryDocument } from "../src/index.js";

describe("model registry contract", () => {
  it("validates the versioned bootstrap registry without credentials", () => {
    const path = resolve(import.meta.dirname, "../../../config/model-registry.v1.json");
    const source = readFileSync(path, "utf8");
    const document = JSON.parse(source) as ModelRegistryDocument;

    expect(Value.Check(ModelRegistryDocumentSchema, document)).toBe(true);
    expect(source).not.toMatch(/api[_-]?key|authorization|bearer\s+[a-z0-9]/i);
  });
});
