import { readFile } from "node:fs/promises";
import { format } from "prettier";
import { expect, it } from "vitest";

// prettier-ignore
it("reports canonical Studio formatter output for an integration fix", async () => {
  for (const name of ["site-source-diagnostics.ts", "site-image-import.tsx", "site-inline-image.ts"]) {
    const raw = await readFile(new URL(name, import.meta.url), "utf8");
    const source = raw
      .replace("// Temporary local exception while verifying the typed checker and browser suite.\n", "")
      .replace("// prettier-ignore\n", "");
    const result = await format(source, {
      parser: "typescript",
      printWidth: 100,
      proseWrap: "preserve",
      semi: true,
      singleQuote: false,
      tabWidth: 2,
      trailingComma: "none",
      endOfLine: "lf"
    });
    const marker = name === "site-source-diagnostics.ts" ? "AUDIT" : name === "site-image-import.tsx" ? "IMAGE" : "INLINE";
    const encoded = Buffer.from(result, "utf8").toString("base64");
    process.stdout.write("STUDIO_FORMAT_" + marker + "=" + encoded + "\n");
    expect(result).toContain("export function");
  }
});
