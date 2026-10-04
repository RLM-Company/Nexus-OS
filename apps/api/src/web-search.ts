import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
export class WebSearch {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  constructor(origin = "", fetchImplementation: typeof fetch = fetch) {
    if (origin && !["http://search:8080", "http://127.0.0.1:8080"].includes(origin))
      throw new Error("Invalid internal search origin");
    this.#origin = origin;
    this.#fetch = fetchImplementation;
  }
  get configured() {
    return this.#origin !== "";
  }
  async search(
    query: string
  ): Promise<{ query: string; searched_at: string; items: SearchResult[] }> {
    if (!this.configured || !query.trim() || query.length > 240)
      throw new Error("Search unavailable");
    const params = new URLSearchParams({
      q: query.trim(),
      format: "json",
      categories: "general",
      safesearch: "1"
    });
    const response = await this.#fetch(`${this.#origin}/search?${params}`, {
      redirect: "error",
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok || !response.body) throw new Error("Search unavailable");
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 400_000) {
          await reader.cancel();
          throw new Error("Search response too large");
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(parts).toString("utf8")) as {
      results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
    };
    if (!Array.isArray(body.results)) throw new Error("Invalid search response");
    const items: SearchResult[] = [];
    const seen = new Set<string>();
    for (const item of body.results) {
      if (typeof item.url !== "string" || item.url.length > 1500 || typeof item.title !== "string")
        continue;
      try {
        const url = new URL(item.url);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          seen.has(url.href)
        )
          continue;
        seen.add(url.href);
        const clean = (value: string, limit: number) =>
          value
            .replace(/<[^>]*>/g, "")
            .split("")
            .map((character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character
            )
            .join("")
            .slice(0, limit);
        items.push({
          url: url.href,
          title: clean(item.title, 180),
          snippet: clean(typeof item.content === "string" ? item.content : "", 700)
        });
        if (items.length >= 5) break;
      } catch {
        /* Ignore malformed links from the external engine. */
      }
    }
    return { query: query.trim(), searched_at: new Date().toISOString(), items };
  }
}
export function registerWebSearchRoutes(app: FastifyInstance, search: WebSearch) {
  app.get("/api/v1/web-search/status", () => ({ configured: search.configured }));
  app.post<{ Body: { q: string } }>(
    "/api/v1/web-search",
    {
      schema: {
        body: Type.Object(
          { q: Type.String({ minLength: 1, maxLength: 240 }) },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      try {
        return await search.search(request.body.q);
      } catch {
        return reply.code(503).send({
          error: {
            code: "SEARCH_UNAVAILABLE",
            message: "Поиск сейчас недоступен. Попробуйте позже."
          }
        });
      }
    }
  );
}
