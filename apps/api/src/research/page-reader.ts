import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { canonicalResearchUrl, extractResearchText, RESEARCH_LIMITS } from "@cosmora/core";

const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const)
  blockedV4.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 23],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["fec0::", 10],
  ["100::", 64]
] as const)
  blockedV6.addSubnet(network, prefix, "ipv6");

export class ResearchNetworkError extends Error {
  constructor(readonly code: "NETWORK_DENIED" | "ROBOTS_DENIED" | "UNAVAILABLE") {
    super(code);
  }
}
const deny = (code: ResearchNetworkError["code"]): never => {
  throw new ResearchNetworkError(code);
};

export function validatePublicHost(hostname: string): void {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !name ||
    name.length > 253 ||
    !name.includes(".") ||
    [
      "localhost",
      "local",
      "internal",
      "test",
      "invalid",
      "onion",
      "lan",
      "private",
      "home.arpa"
    ].some((domain) => name === domain || name.endsWith(`.${domain}`)) ||
    isIP(name) ||
    /[^\w.-]/.test(name)
  )
    deny("NETWORK_DENIED");
}

export function isPublicAddress(address: string, family: number): boolean {
  // Only global IPv6 unicast (2000::/3) is routable for research, regardless of DNS answers.
  if (family === 6 && !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  return (
    (family === 4 || family === 6) &&
    isIP(address) === family &&
    !(family === 4 ? blockedV4.check(address, "ipv4") : blockedV6.check(address, "ipv6"))
  );
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })) as ResolvedAddress[];

/** Reject the whole DNS answer if even one address is private; pin the chosen address for TCP. */
export async function resolvePublicAddress(
  hostname: string,
  resolver: Resolver = systemResolver
): Promise<ResolvedAddress> {
  validatePublicHost(hostname);
  const addresses = await resolver(hostname);
  if (
    !addresses.length ||
    addresses.length > 20 ||
    addresses.some(({ address, family }) => !isPublicAddress(address, family))
  )
    return deny("NETWORK_DENIED");
  return addresses[0]!;
}

export function robotsPermits(
  content: string,
  path: string,
  userAgent = "KosmoraResearch"
): boolean {
  // RFC 9309: longest applicable rule, Allow wins ties; use only our agent or wildcard groups.
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let agents: string[] = [],
    rules: { allow: boolean; pattern: string }[] = [];
  const finish = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]?.trim() ?? "";
    if (!line) {
      if (rules.length) finish();
      continue;
    }
    const match = /^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase(),
      value = match[2]!.trim();
    if (key === "user-agent") {
      if (rules.length) finish();
      agents.push(value.toLowerCase());
    } else if (agents.length && value) {
      rules.push({ allow: key === "allow", pattern: value });
    }
  }
  finish();
  const name = userAgent.toLowerCase();
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && name.includes(agent))
  );
  const applicable = specific.length
    ? specific
    : groups.filter((group) => group.agents.includes("*"));
  let winner = { length: -1, allow: true };
  let inspected = 0;
  for (const group of applicable)
    for (const rule of group.rules) {
      if (
        ++inspected > 100 ||
        rule.pattern.length > 256 ||
        (rule.pattern.match(/\*/g) ?? []).length > 4
      )
        return false;
      const end = rule.pattern.endsWith("$");
      const pattern = end ? rule.pattern.slice(0, -1) : rule.pattern;
      const safe = pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      if (new RegExp(`^${safe}${end ? "$" : ""}`).test(path)) {
        const length = pattern.replace(/\*/g, "").length;
        if (length > winner.length || (length === winner.length && rule.allow))
          winner = { length, allow: rule.allow };
      }
    }
  return winner.allow;
}

export type Transport = (
  url: URL,
  address: ResolvedAddress,
  limit: number,
  signal: AbortSignal
) => Promise<{ status: number; contentType: string; body: string }>;

export const pinnedTransport: Transport = (url, address, limit, signal) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        hostname: url.hostname,
        family: address.family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          "user-agent": "KosmoraResearch/1.0",
          accept: "text/html,text/plain,application/xhtml+xml",
          "accept-encoding": "identity"
        },
        lookup: (_hostname, _opts, cb) => cb(null, address.address, address.family),
        timeout: RESEARCH_LIMITS.maxRequestMilliseconds,
        signal
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const reported = Number(response.headers["content-length"]);
        if (Number.isFinite(reported) && reported > limit) {
          response.destroy();
          reject(new ResearchNetworkError("UNAVAILABLE"));
          return;
        }
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.destroy();
          reject(new ResearchNetworkError("UNAVAILABLE"));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            response.destroy();
            reject(new ResearchNetworkError("UNAVAILABLE"));
          } else chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: String(response.headers["content-type"] ?? "").toLowerCase(),
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    request.once("timeout", () => request.destroy(new ResearchNetworkError("UNAVAILABLE")));
    request.once("error", reject);
    request.end();
  });

export interface ResearchPageReaderOptions {
  resolver?: Resolver;
  transport?: Transport;
}
export class ResearchPageReader {
  readonly #resolver: Resolver;
  readonly #transport: Transport;
  constructor(options: ResearchPageReaderOptions = {}) {
    this.#resolver = options.resolver ?? systemResolver;
    this.#transport = options.transport ?? pinnedTransport;
  }
  async read(rawUrl: string, signal: AbortSignal): Promise<string> {
    const canonical = canonicalResearchUrl(rawUrl);
    if (!canonical) return deny("NETWORK_DENIED");
    const url = new URL(canonical);
    if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) deny("NETWORK_DENIED");
    const address = await new Promise<ResolvedAddress>((resolve, reject) => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
      if (deadline.aborted) {
        reject(new ResearchNetworkError("UNAVAILABLE"));
        return;
      }
      const abort = () => reject(new ResearchNetworkError("UNAVAILABLE"));
      deadline.addEventListener("abort", abort, { once: true });
      void resolvePublicAddress(url.hostname, this.#resolver)
        .then(resolve, reject)
        .finally(() => deadline.removeEventListener("abort", abort));
    });
    const robotsUrl = new URL("/robots.txt", url);
    // The same pinned address is used for robots.txt and the page. Never follow redirects.
    const robots = await this.#transport(
      robotsUrl,
      address,
      RESEARCH_LIMITS.maxRobotsBytes,
      signal
    );
    if (robots.status !== 404) {
      if (robots.status !== 200 || !robotsPermits(robots.body, url.pathname + url.search))
        deny("ROBOTS_DENIED");
    }
    const response = await this.#transport(url, address, RESEARCH_LIMITS.maxPageBytes, signal);
    if (
      response.status !== 200 ||
      !/^(text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/.test(response.contentType)
    )
      deny("UNAVAILABLE");
    return response.contentType.startsWith("text/plain")
      ? response.body.slice(0, RESEARCH_LIMITS.maxExtractCharacters)
      : extractResearchText(response.body);
  }
}
