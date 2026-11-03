import { expect, it } from "vitest";
import { WebSearch } from "../src/web-search.js";
import { registerWebSearchRoutes } from "../src/web-search.js";
import Fastify from "fastify";

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

it("allows a fixed DuckDuckGo engine for the first-party browser without changing default search", async () => {
  const calls: string[] = [];
  const search = new WebSearch("http://search:8080", (url) => {
    calls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    return Promise.resolve(new Response(JSON.stringify({ results: [] })));
  });
  await search.search("Kosmora", undefined, "duckduckgo");
  await search.search("Kosmora");
  expect(new URL(calls[0]!).searchParams.get("engines")).toBe("duckduckgo");
  expect(new URL(calls[1]!).searchParams.has("engines")).toBe(false);
});

it("HTTP search accepts only the supported fixed engine and returns unavailable instead of fake results", async () => {
  const app = Fastify();
  registerWebSearchRoutes(app, new WebSearch());
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/web-search",
          payload: { q: "test", engine: "duckduckgo" }
        })
      ).statusCode
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/web-search",
          payload: { q: "test", engine: "https://untrusted.example/" }
        })
      ).statusCode
    ).toBe(400);
  } finally {
    await app.close();
  }
});

it("does not present a blocked upstream engine as a successful empty search", async () => {
  const search = new WebSearch("http://search:8080", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ results: [], unresponsive_engines: [["duckduckgo", "blocked"]] })
      )
    )
  );
  await expect(search.search("query", undefined, "duckduckgo")).rejects.toThrow(
    "Search unavailable"
  );
});
