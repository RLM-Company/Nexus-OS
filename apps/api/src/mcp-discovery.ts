import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";

const VERSION = "2025-11-25";
const SUPPORTED = new Set([VERSION, "2025-06-18"]);
const LIMIT = 64 * 1024;
const NAME = /^[A-Za-z0-9_.-]{1,128}$/u;

export type McpDocumentSource = { id: string; name: string; uri: string };

export interface McpDiscovery {
  projectId: string;
  ownerId: string;
  revision: string;
  document?: { name: string; uri: string };
  documents?: readonly McpDocumentSource[];
  readDocument?(this: void, documentId?: string): Promise<string>;
  discover(): Promise<{ tools: string[]; hasMore: boolean }>;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP_INVALID_RESPONSE");
  return value as Record<string, unknown>;
};

async function responseObject(response: Response, id: string): Promise<Record<string, unknown>> {
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!response.body || !["application/json", "text/event-stream"].includes(mime ?? "")) {
    await response.body?.cancel();
    throw new Error("MCP_INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > LIMIT) throw new Error("MCP_RESPONSE_LIMIT");
      body += decoder.decode(chunk.value, { stream: true });
      if (mime !== "text/event-stream") continue;
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/u.exec(body))) {
        const event = body.slice(0, boundary.index);
        body = body.slice(boundary.index + boundary[0].length);
        const data = event
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /u, ""))
          .join("\n");
        if (!data) continue;
        const message = record(JSON.parse(data));
        if (message.id === id) return message;
      }
    }
    if (mime === "application/json") return record(JSON.parse(body + decoder.decode()));
    throw new Error("MCP_INVALID_RESPONSE");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Configuration belongs to the deploy operator. No URL or credential comes from a request. */
export function configuredMcpDiscovery(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch
): McpDiscovery | undefined {
  const { KOSMORA_MCP_URL, KOSMORA_MCP_PROJECT, KOSMORA_MCP_OWNER, KOSMORA_MCP_BEARER } = env;
  if (!KOSMORA_MCP_URL || !KOSMORA_MCP_PROJECT || !KOSMORA_MCP_OWNER) return;
  let endpoint: URL;
  try {
    endpoint = new URL(KOSMORA_MCP_URL);
  } catch {
    return;
  }
  const host = endpoint.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search ||
    endpoint.port ||
    !host.includes(".") ||
    isIP(host) ||
    /(?:^|\.)(?:localhost|internal|local|test)$/u.test(host) ||
    (KOSMORA_MCP_BEARER && !/^[\x21-\x7e]{1,4096}$/u.test(KOSMORA_MCP_BEARER))
  )
    return;

  const uri = env.KOSMORA_MCP_DOCUMENT_URI;
  const name = env.KOSMORA_MCP_DOCUMENT_NAME;
  const repo = env.KOSMORA_MCP_DEEPWIKI_REPO;
  const deepWiki = endpoint.href === "https://mcp.deepwiki.com/mcp" && !KOSMORA_MCP_BEARER;
  const wikiList = env.KOSMORA_MCP_DEEPWIKI_DOCUMENTS_JSON;
  type ConfiguredDocument = McpDocumentSource & { wikiRepo?: string };
  const makeDocument = (uri: unknown, name: unknown): ConfiguredDocument | undefined => {
    if (
      typeof name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,78}\.(txt|md)$/u.test(name) ||
      typeof uri !== "string" ||
      !/^[^\s\p{Cc}]{1,512}$/u.test(uri) ||
      !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(uri) ||
      /[?@#]/u.test(uri)
    )
      return;
    return { id: createHash("sha256").update(uri).digest("hex").slice(0, 32), uri, name };
  };
  const makeWikiDocument = (
    repository: unknown,
    filename: unknown
  ): ConfiguredDocument | undefined => {
    if (
      typeof repository !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(repository)
    )
      return;
    const document = makeDocument("https://deepwiki.com/" + repository, filename);
    if (document) return { ...document, wikiRepo: repository };
  };
  function parseList(raw: string, wiki: boolean): ConfiguredDocument[] {
    if (raw.length > 8192) return [];
    try {
      const items: unknown = JSON.parse(raw);
      if (!Array.isArray(items) || items.length === 0 || items.length > 8) return [];
      const parsed = items.map((item: unknown) => {
        const entry = record(item);
        if (Object.keys(entry).length !== 2) return;
        return wiki
          ? makeWikiDocument(entry.repo, entry.name)
          : makeDocument(entry.uri, entry.name);
      });
      if (
        parsed.every((item) => item !== undefined) &&
        new Set(parsed.map((item) => item.wikiRepo?.toLowerCase() ?? item.id)).size ===
          parsed.length &&
        new Set(parsed.map((item) => item.name.toLowerCase())).size === parsed.length
      )
        return parsed;
    } catch {
      // An invalid allowlist disables document access.
    }
    return [];
  }

  const list = env.KOSMORA_MCP_DOCUMENTS_JSON;
  let documents: ConfiguredDocument[] = [];
  if (wikiList !== undefined) {
    if (deepWiki && list === undefined && !repo && !uri && !name)
      documents = parseList(wikiList, true);
  } else if (list !== undefined) {
    if (!repo && !uri && !name) documents = parseList(list, false);
  } else {
    const document = repo
      ? deepWiki && !uri && makeWikiDocument(repo, name)
      : makeDocument(uri, name);
    if (document) documents = [document];
  }

  async function run<Output>(
    use: (
      capabilities: Record<string, unknown>,
      call: (method: string, params?: object) => Promise<Record<string, unknown>>
    ) => Promise<Output>
  ): Promise<Output> {
    const signal = AbortSignal.timeout(10_000);
    const headers = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(KOSMORA_MCP_BEARER ? { authorization: `Bearer ${KOSMORA_MCP_BEARER}` } : {})
    });
    const send = (method: string, params?: object, id?: string) =>
      request(endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          ...(id ? { id } : {}),
          ...(params ? { params } : {})
        })
      });
    const checked = async (response: Response, id: string) => {
      if (!response.ok || response.redirected) {
        await response.body?.cancel();
        throw new Error("MCP_REMOTE_FAILED");
      }
      const message = await responseObject(response, id);
      if (message.jsonrpc !== "2.0" || message.id !== id || "error" in message)
        throw new Error("MCP_INVALID_RESPONSE");
      return record(message.result);
    };
    try {
      const id = randomUUID();
      const initial = await send(
        "initialize",
        {
          protocolVersion: VERSION,
          capabilities: {},
          clientInfo: { name: "Kosmora", version: "1" }
        },
        id
      );
      const handshake = await checked(initial, id);
      if (
        typeof handshake.protocolVersion !== "string" ||
        !SUPPORTED.has(handshake.protocolVersion)
      )
        throw new Error("MCP_UNSUPPORTED_VERSION");
      const capabilities = record(handshake.capabilities);
      headers.set("MCP-Protocol-Version", handshake.protocolVersion);
      const session = initial.headers.get("mcp-session-id");
      if (session !== null) {
        if (!/^[\x21-\x7e]{1,256}$/u.test(session)) throw new Error("MCP_INVALID_SESSION");
        headers.set("MCP-Session-Id", session);
      }
      const ready = await send("notifications/initialized");
      await ready.body?.cancel();
      if (ready.status !== 202 || ready.redirected) throw new Error("MCP_REMOTE_FAILED");
      return await use(capabilities, async (method, params) => {
        const callId = randomUUID();
        return checked(await send(method, params, callId), callId);
      });
    } finally {
      if (headers.has("MCP-Session-Id")) {
        try {
          const closing = await request(endpoint, {
            method: "DELETE",
            headers,
            signal,
            redirect: "error"
          });
          await closing.body?.cancel();
        } catch {
          // Servers may decline client-initiated session termination.
        }
      }
    }
  }

  return {
    projectId: KOSMORA_MCP_PROJECT,
    ownerId: KOSMORA_MCP_OWNER,
    revision: createHash("sha256")
      .update(
        JSON.stringify([
          endpoint.href,
          KOSMORA_MCP_PROJECT,
          KOSMORA_MCP_OWNER,
          env.KOSMORA_MCP_REVISION ?? "1",
          documents
        ])
      )
      .digest("hex")
      .slice(0, 32),
    discover: () =>
      run(async (capabilities, call) => {
        if (!Object.hasOwn(capabilities, "tools")) return { tools: [], hasMore: false };
        record(capabilities.tools);
        const result = await call("tools/list");
        if (!Array.isArray(result.tools) || result.tools.length > 100)
          throw new Error("MCP_INVALID_RESPONSE");
        const tools = result.tools.map((item: unknown) => {
          const name = record(item).name;
          if (typeof name !== "string" || !NAME.test(name)) throw new Error("MCP_INVALID_RESPONSE");
          return name;
        });
        if (new Set(tools).size !== tools.length) throw new Error("MCP_INVALID_RESPONSE");
        return {
          tools,
          hasMore: typeof result.nextCursor === "string" && result.nextCursor.length > 0
        };
      }),
    ...(documents.length
      ? {
          ...(documents.length === 1
            ? { document: { uri: documents[0]!.uri, name: documents[0]!.name } }
            : {}),
          documents: documents.map(({ id, uri, name }) => ({ id, uri, name })),
          readDocument: (documentId) => {
            const document = documentId
              ? documents.find(({ id }) => id === documentId)
              : documents.length === 1
                ? documents[0]
                : undefined;
            if (!document) return Promise.reject(new Error("MCP_DOCUMENT_UNAVAILABLE"));
            const wikiRepo = document.wikiRepo;
            return run(async (capabilities, call) => {
              if (wikiRepo) {
                record(capabilities.tools);
                const result = await call("tools/call", {
                  name: "read_wiki_structure",
                  arguments: { repoName: wikiRepo }
                });
                if (
                  (result.isError !== undefined && result.isError !== false) ||
                  !Array.isArray(result.content) ||
                  result.content.length !== 1
                )
                  throw new Error("MCP_INVALID_DOCUMENT");
                const item = record(result.content[0]);
                if (
                  item.type !== "text" ||
                  typeof item.text !== "string" ||
                  !item.text.startsWith("Available pages for " + wikiRepo + ":")
                )
                  throw new Error("MCP_INVALID_DOCUMENT");
                return item.text;
              }
              record(capabilities.resources);
              const result = await call("resources/read", { uri: document.uri });
              if (!Array.isArray(result.contents) || result.contents.length !== 1)
                throw new Error("MCP_INVALID_DOCUMENT");
              const item = record(result.contents[0]);
              if (
                item.uri !== document.uri ||
                "blob" in item ||
                typeof item.text !== "string" ||
                (item.mimeType !== undefined &&
                  item.mimeType !== "text/plain" &&
                  item.mimeType !== "text/markdown")
              )
                throw new Error("MCP_INVALID_DOCUMENT");
              return item.text;
            });
          }
        }
      : {})
  };
}
