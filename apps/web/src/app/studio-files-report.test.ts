import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createDocxReport } from "./studio-files-report";

describe("document report export", () => {
  it("creates an editable Word package without invalid XML from source control characters", async () => {
    const report = createDocxReport(["Факт & <источник> 😀", "Текст\u0000с символом\ud800"]);
    const archive = unzipSync(new Uint8Array(await report.arrayBuffer()));
    const document = strFromU8(archive["word/document.xml"]!);
    expect(document).toContain("Факт &amp; &lt;источник&gt; 😀");
    expect(document).toContain("Текст\ufffdс символом\ufffd");
    expect(document).not.toContain("\u0000");
    expect(archive["[Content_Types].xml"]).toBeDefined();
    expect(strFromU8(archive["_rels/.rels"]!)).toContain('Target="word/document.xml"');
  });
});
