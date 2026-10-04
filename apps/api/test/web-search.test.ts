import { expect, it } from "vitest";
import { WebSearch } from "../src/web-search.js";

it("bounds search results and never follows provider links or redirects", async () => {
  const calls: string[] = [];
  const search = new WebSearch("http://search:8080", (url, options) => {
    calls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    expect(options?.redirect).toBe("error");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          results: [
            { title: "<b>Docs</b>", url: "https://example.org/docs", content: "Text" },
            { title: "Duplicate", url: "https://example.org/docs" },
            { title: "Attack", url: "javascript:alert(1)" },
            { title: "Credential", url: "https://user:password@example.org/" }
          ]
        })
      )
    );
  });
  const result = await search.search("TypeScript docs");
  expect(result.items).toEqual([
    { title: "Docs", url: "https://example.org/docs", snippet: "Text" }
  ]);
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0]!).searchParams.get("q")).toBe("TypeScript docs");
  expect(() => new WebSearch("https://example.org")).toThrow();
  await expect(new WebSearch().search("query")).rejects.toThrow();
});
