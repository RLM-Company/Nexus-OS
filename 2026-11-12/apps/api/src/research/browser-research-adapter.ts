import { createRequire } from "node:module";
import { type CandidateClaimExtraction, sha256Hex } from "./research-synthesis.js";
import { canonicalizeSourceUrl } from "./research-store.js";

const require = createRequire(import.meta.url);
// Reuse the existing desktop browser search & bookmark store (`desktop/windows/browser/search-pagination-and-bookmarks.cjs`)
// without creating a second browser store
const { KosworkSearchAndBrowserStore } = require("../../../../desktop/windows/browser/search-pagination-and-bookmarks.cjs");

export interface DeterministicFixturePage {
  url: string;
  title: string;
  publishedAt?: string | null;
  fetchedAt?: string;
  pageVersion?: string;
  contentText: string;
  depth?: number;
  outlinks?: Array<{ url: string; depth?: number }>;
  claims: CandidateClaimExtraction[];
}

export interface BrowserSearchCandidate {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  snippet: string;
  depth: number;
  initialExpectedVersion: string | null;
}

export interface BrowserReadSnapshot {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  fetchedAt: string;
  publishedAt: string | null;
  pageVersion: string;
  contentSha256: string;
  contentText: string;
  depth: number;
  httpStatus: number;
  outlinks: Array<{ url: string; depth: number }>;
  extractedClaims: CandidateClaimExtraction[];
}

export interface ResearchBrowserAdapter {
  searchSources(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal }
  ): Promise<BrowserSearchCandidate[]>;
  readSourcePage(
    url: string,
    options?: { depth?: number; signal?: AbortSignal }
  ): Promise<BrowserReadSnapshot>;
}

/**
 * Deterministic Fixture & Browser Adapter that reuses `KosworkSearchAndBrowserStore`
 * and supports:
 * - Stable canonical URL deduplication while preserving `originalUrl`
 * - Mutable page versions (`updateFixturePage`) to test page-change detection between search and read / across retries
 * - Programmable transient read failures (`injectReadFailureOnce`) and step hooks (`onBeforeReadUrl`)
 *   to test mid-read cancellation and step-checkpoint crash recovery without paid network calls.
 */
export class DeterministicResearchBrowserAdapter implements ResearchBrowserAdapter {
  private readonly pagesByCanonical = new Map<string, DeterministicFixturePage>();
  private readonly failOnceUrls = new Set<string>();
  private readonly browserStore = new KosworkSearchAndBrowserStore();
  public readCallCountByCanonical = new Map<string, number>();
  public searchCallCount = 0;
  public onBeforeReadUrl?: (canonicalUrl: string, originalUrl: string) => Promise<void> | void;

  constructor(initialPages: DeterministicFixturePage[] = DEFAULT_DETERMINISTIC_FIXTURE_PAGES) {
    for (const page of initialPages) {
      this.registerFixturePage(page);
    }
  }

  public registerFixturePage(page: DeterministicFixturePage): void {
    const canonical = canonicalizeSourceUrl(page.url);
    const computedVersion =
      page.pageVersion ?? `pv-${sha256Hex(page.contentText).slice(0, 12)}`;
    this.pagesByCanonical.set(canonical, {
      ...page,
      pageVersion: computedVersion
    });
  }

  public updateFixturePage(
    url: string,
    patch: {
      contentText: string;
      pageVersion?: string;
      fetchedAt?: string;
      claims?: CandidateClaimExtraction[];
    }
  ): void {
    const canonical = canonicalizeSourceUrl(url);
    const existing = this.pagesByCanonical.get(canonical);
    if (!existing) {
      throw new Error(`FIXTURE_PAGE_NOT_FOUND:${canonical}`);
    }
    const nextVersion =
      patch.pageVersion ?? `pv-${sha256Hex(patch.contentText).slice(0, 12)}`;
    this.pagesByCanonical.set(canonical, {
      ...existing,
      contentText: patch.contentText,
      pageVersion: nextVersion,
      fetchedAt: patch.fetchedAt ?? new Date().toISOString(),
      claims: patch.claims ?? existing.claims
    });
  }

  public injectReadFailureOnce(url: string): void {
    this.failOnceUrls.add(canonicalizeSourceUrl(url));
  }

  public async searchSources(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal }
  ): Promise<BrowserSearchCandidate[]> {
    if (options?.signal?.aborted) {
      throw new Error("RESEARCH_CANCELLED");
    }
    this.searchCallCount += 1;

    const allEntries = Array.from(this.pagesByCanonical.values());
    // Include an intentional tracking-param duplicate URL in raw search output to verify stable deduplication
    const rawSearchItems = [
      ...allEntries.map((p) => ({
        title: p.title,
        url: p.url,
        snippet: p.contentText.slice(0, 160),
        depth: p.depth ?? 1,
        pageVersion: p.pageVersion ?? null
      })),
      ...(allEntries.length > 0
        ? [
            {
              title: `${allEntries[0].title} (UTM duplicate)`,
              url: `${allEntries[0].url}${allEntries[0].url.includes("?") ? "&" : "?"}utm_source=serp_dup&fbclid=123`,
              snippet: allEntries[0].contentText.slice(0, 160),
              depth: allEntries[0].depth ?? 1,
              pageVersion: allEntries[0].pageVersion ?? null
            }
          ]
        : [])
    ];

    // Record in the shared desktop browser store
    this.browserStore.recordAndPaginateSearch({
      query,
      results: rawSearchItems.map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet
      })),
      page: 1,
      pageSize: Math.max(10, rawSearchItems.length)
    });

    const seenCanonical = new Set<string>();
    const deduplicated: BrowserSearchCandidate[] = [];
    const maxResults = options?.maxResults ?? 10;

    for (const item of rawSearchItems) {
      const canonicalUrl = canonicalizeSourceUrl(item.url);
      if (seenCanonical.has(canonicalUrl)) {
        continue;
      }
      seenCanonical.add(canonicalUrl);
      deduplicated.push({
        originalUrl: item.url,
        canonicalUrl,
        title: item.title,
        snippet: item.snippet,
        depth: item.depth,
        initialExpectedVersion: item.pageVersion
      });
      if (deduplicated.length >= maxResults) break;
    }

    return deduplicated;
  }

  public async readSourcePage(
    url: string,
    options?: { depth?: number; signal?: AbortSignal }
  ): Promise<BrowserReadSnapshot> {
    const canonicalUrl = canonicalizeSourceUrl(url);
    if (this.onBeforeReadUrl) {
      await this.onBeforeReadUrl(canonicalUrl, url);
    }
    if (options?.signal?.aborted) {
      throw new Error("RESEARCH_CANCELLED");
    }

    if (this.failOnceUrls.has(canonicalUrl)) {
      this.failOnceUrls.delete(canonicalUrl);
      throw new Error(`SOURCE_READ_TRANSIENT_ERROR:${canonicalUrl}`);
    }

    const page = this.pagesByCanonical.get(canonicalUrl);
    if (!page) {
      throw new Error(`SOURCE_NOT_FOUND:${canonicalUrl}`);
    }

    const prevCount = this.readCallCountByCanonical.get(canonicalUrl) ?? 0;
    this.readCallCountByCanonical.set(canonicalUrl, prevCount + 1);

    const contentSha256 = sha256Hex(page.contentText);
    const pageVersion = page.pageVersion ?? `pv-${contentSha256.slice(0, 12)}`;

    return {
      originalUrl: url,
      canonicalUrl,
      title: page.title,
      fetchedAt: page.fetchedAt ?? "2026-11-10T18:00:00.000Z",
      publishedAt: page.publishedAt ?? null,
      pageVersion,
      contentSha256,
      contentText: page.contentText,
      depth: options?.depth ?? page.depth ?? 1,
      httpStatus: 200,
      outlinks: (page.outlinks ?? []).map((o) => ({
        url: o.url,
        depth: o.depth ?? (options?.depth ?? 1) + 1
      })),
      extractedClaims: page.claims
    };
  }
}

export const DEFAULT_DETERMINISTIC_FIXTURE_PAGES: DeterministicFixturePage[] = [
  {
    url: "https://docs.kosmora.local/oriondb/2026-pricing?ref=official",
    title: "OrionDB 2026 — Официальная спецификация и тарифы",
    publishedAt: "2026-10-20T00:00:00.000Z",
    fetchedAt: "2026-11-10T18:00:01.000Z",
    pageVersion: "pv-orion-2026-v1",
    depth: 1,
    contentText:
      "Официальная документация OrionDB (редакция 2026). Для корпоративного тарифа OrionDB базовая стоимость составляет $29/мес при годовой подписке. Гарантированный уровень доступности OrionDB составляет SLA 99.99%.",
    outlinks: [
      {
        url: "https://benchmarks.kosmora.local/oriondb/deep-latency-2026",
        depth: 2
      }
    ],
    claims: [
      {
        subject: "OrionDB",
        criterion: "Базовая стоимость",
        claimedValue: "$29/мес",
        verbatimQuote:
          "Для корпоративного тарифа OrionDB базовая стоимость составляет $29/мес при годовой подписке."
      },
      {
        subject: "OrionDB",
        criterion: "SLA доступности",
        claimedValue: "99.99%",
        verbatimQuote: "Гарантированный уровень доступности OrionDB составляет SLA 99.99%."
      }
    ]
  },
  {
    url: "https://archive.kosmora.local/oriondb/2025-pricing",
    title: "Архивный прайс-лист OrionDB (2025)",
    publishedAt: "2025-05-15T00:00:00.000Z",
    fetchedAt: "2026-11-10T18:00:02.000Z",
    pageVersion: "pv-orion-2025-v1",
    depth: 1,
    contentText:
      "Архивный обзор OrionDB за 2025 год. Для корпоративного тарифа OrionDB базовая стоимость составляет $49/мес.",
    claims: [
      {
        subject: "OrionDB",
        criterion: "Базовая стоимость",
        claimedValue: "$49/мес",
        verbatimQuote:
          "Для корпоративного тарифа OrionDB базовая стоимость составляет $49/мес."
      }
    ]
  },
  {
    url: "https://benchmarks.kosmora.local/oriondb/deep-latency-2026",
    title: "Независимый бенчмарк задержек OrionDB (глубина 2)",
    publishedAt: "2026-10-25T00:00:00.000Z",
    fetchedAt: "2026-11-10T18:00:03.000Z",
    pageVersion: "pv-orion-bench-v1",
    depth: 2,
    contentText:
      "Результаты нагрузочного тестирования OrionDB: задержка чтения p95 удерживается на уровне 8 мс.",
    claims: [
      {
        subject: "OrionDB",
        criterion: "Задержка p95",
        claimedValue: "8 мс",
        verbatimQuote:
          "Результаты нагрузочного тестирования OrionDB: задержка чтения p95 удерживается на уровне 8 мс."
      }
    ]
  }
];
