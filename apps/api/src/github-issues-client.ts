/** Read-only, fixed-repository GitHub Issues. Never follows issue content URLs. */
export type GithubIssueState = "open" | "closed" | "all";
export type GithubIssueSummary = {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  updated_at: string;
};
export type GithubIssueDetail = GithubIssueSummary & {
  body: string;
  body_total_chars: number;
  body_truncated: boolean;
};
export type GithubIssuePage = {
  repository: string;
  items: GithubIssueSummary[];
  page: number;
  next_page: number | null;
  limited: boolean;
};
export type GithubIssuesErrorCode =
  | "GITHUB_ISSUES_NOT_CONFIGURED"
  | "GITHUB_ISSUES_DENIED"
  | "GITHUB_ISSUES_RATE_LIMITED"
  | "GITHUB_ISSUES_NOT_FOUND"
  | "GITHUB_ISSUES_UNAVAILABLE"
  | "GITHUB_ISSUES_TIMEOUT"
  | "GITHUB_ISSUES_CANCELLED"
  | "GITHUB_ISSUES_LIMIT"
  | "GITHUB_ISSUES_INPUT"
  | "GITHUB_ISSUES_BUSY";
export class GithubIssuesError extends Error {
  constructor(readonly code: GithubIssuesErrorCode) {
    super(code);
  }
}
function fail(code: GithubIssuesErrorCode): never {
  throw new GithubIssuesError(code);
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function excerpt(value: string, limit: number) {
  const end = Math.min(value.length, limit);
  return value.slice(0, end && /[\uD800-\uDBFF]/u.test(value[end - 1]!) ? end - 1 : end);
}
export class GithubIssuesClient {
  #active = 0;
  constructor(
    private readonly options: {
      repository: string;
      configured: boolean;
      /** Authenticated fetch supplied by the existing GithubIntegration, never by a task. */
      fetchImplementation: typeof fetch;
      timeoutMs?: number;
    }
  ) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/u.test(options.repository))
      throw new Error("Invalid configured repository");
  }
  private async read(path: string, external?: AbortSignal): Promise<unknown> {
    if (!this.options.configured) fail("GITHUB_ISSUES_NOT_CONFIGURED");
    if (external?.aborted) fail("GITHUB_ISSUES_CANCELLED");
    if (this.#active >= 4) fail("GITHUB_ISSUES_BUSY");
    this.#active++;
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
    const signal = AbortSignal.any([controller.signal, deadline, ...(external ? [external] : [])]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await abortable(
        this.options.fetchImplementation(`https://api.github.com${path}`, {
          method: "GET",
          redirect: "error",
          signal
        }),
        signal
      );
      if (response.body) reader = response.body.getReader();
      if (response.redirected) fail("GITHUB_ISSUES_UNAVAILABLE");
      if (response.status === 401 || response.status === 403)
        fail(
          response.headers.get("x-ratelimit-remaining") === "0" ||
            response.headers.has("retry-after")
            ? "GITHUB_ISSUES_RATE_LIMITED"
            : "GITHUB_ISSUES_DENIED"
        );
      if (response.status === 429) fail("GITHUB_ISSUES_RATE_LIMITED");
      if (response.status === 404 || response.status === 410) fail("GITHUB_ISSUES_NOT_FOUND");
      if (!response.ok || !response.body) fail("GITHUB_ISSUES_UNAVAILABLE");
      const length = response.headers.get("content-length");
      if (length && (!/^\d+$/u.test(length) || Number(length) > 2_000_000))
        fail("GITHUB_ISSUES_LIMIT");
      if (!reader) fail("GITHUB_ISSUES_UNAVAILABLE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await abortable(reader.read(), signal);
        if (next.done) break;
        size += next.value.length;
        if (size > 2_000_000) fail("GITHUB_ISSUES_LIMIT");
        chunks.push(next.value);
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      ) as unknown;
    } catch (error) {
      if (external?.aborted) fail("GITHUB_ISSUES_CANCELLED");
      if (deadline.aborted) fail("GITHUB_ISSUES_TIMEOUT");
      if (error instanceof GithubIssuesError) throw error;
      return fail("GITHUB_ISSUES_UNAVAILABLE");
    } finally {
      controller.abort();
      // cancel is intentionally not awaited: a hostile/stalled body cannot hold the deadline open.
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      this.#active--;
    }
  }
  private summary(value: unknown): GithubIssueSummary {
    if (
      !record(value) ||
      !Number.isSafeInteger(value.number) ||
      (value.number as number) < 1 ||
      (value.number as number) > 2_147_483_647 ||
      typeof value.title !== "string" ||
      value.title.length > 512 ||
      (value.state !== "open" && value.state !== "closed") ||
      typeof value.updated_at !== "string" ||
      value.updated_at.length > 40 ||
      !Number.isFinite(Date.parse(value.updated_at)) ||
      typeof value.repository_url !== "string" ||
      value.repository_url.toLowerCase() !==
        `https://api.github.com/repos/${this.options.repository}`.toLowerCase()
    )
      return fail("GITHUB_ISSUES_UNAVAILABLE");
    return {
      number: value.number as number,
      title: value.title,
      state: value.state,
      url: `https://github.com/${this.options.repository}/issues/${value.number as number}`,
      updated_at: value.updated_at
    };
  }
  async list(
    input: { state?: GithubIssueState; query?: string; page?: number } = {},
    signal?: AbortSignal
  ): Promise<GithubIssuePage> {
    const state = input.state ?? "open",
      page = input.page ?? 1,
      query = (input.query ?? "").trim();
    // Quote the entire literal query; quotes, escapes and controls cannot introduce search qualifiers.
    if (
      !["open", "closed", "all"].includes(state) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10 ||
      query.length > 160 ||
      [...query].some(
        (char) =>
          char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '"' || char === "\\"
      )
    )
      fail("GITHUB_ISSUES_INPUT");
    const repository = this.options.repository;
    const params = new URLSearchParams({
      per_page: "20",
      page: String(page),
      sort: "updated",
      direction: "desc"
    });
    let path: string;
    if (query) {
      params.delete("direction");
      params.set("order", "desc");
      params.set(
        "q",
        `repo:${repository} is:issue${state === "all" ? "" : ` state:${state}`} in:title,body "${query}"`
      );
      path = `/search/issues?${params}`;
    } else {
      params.set("state", state);
      path = `/repos/${repository}/issues?${params}`;
    }
    const raw = await this.read(path, signal);
    const items = query && record(raw) ? raw.items : raw;
    if (
      !Array.isArray(items) ||
      items.length > 20 ||
      (query &&
        (!record(raw) ||
          !Number.isSafeInteger(raw.total_count) ||
          (raw.total_count as number) < 0 ||
          typeof raw.incomplete_results !== "boolean"))
    )
      fail("GITHUB_ISSUES_UNAVAILABLE");
    const filtered: GithubIssueSummary[] = [];
    const seen = new Set<number>();
    for (const item of items) {
      if (!record(item)) fail("GITHUB_ISSUES_UNAVAILABLE");
      if (item.pull_request !== undefined) continue; // GitHub /issues also includes PRs.
      const summary = this.summary(item);
      if (seen.has(summary.number)) fail("GITHUB_ISSUES_UNAVAILABLE");
      if (state !== "all" && summary.state !== state) fail("GITHUB_ISSUES_UNAVAILABLE");
      seen.add(summary.number);
      filtered.push(summary);
    }
    const more =
      query && record(raw) ? page * 20 < (raw.total_count as number) : items.length === 20;
    return {
      repository,
      items: filtered,
      page,
      next_page: more && page < 10 ? page + 1 : null,
      limited:
        (more && page === 10) ||
        !!(query && record(raw) && ((raw.total_count as number) > 200 || raw.incomplete_results))
    };
  }
  async get(number: number, signal?: AbortSignal): Promise<GithubIssueDetail> {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647)
      fail("GITHUB_ISSUES_INPUT");
    const raw = await this.read(`/repos/${this.options.repository}/issues/${number}`, signal);
    if (!record(raw) || raw.pull_request !== undefined) fail("GITHUB_ISSUES_NOT_FOUND");
    const summary = this.summary(raw);
    if (
      summary.number !== number ||
      (raw.body !== null && typeof raw.body !== "string") ||
      (typeof raw.body === "string" && raw.body.length > 100_000)
    )
      fail("GITHUB_ISSUES_UNAVAILABLE");
    const body = typeof raw.body === "string" ? raw.body : "";
    const preview = excerpt(body, 24_000);
    return {
      ...summary,
      body: preview,
      body_total_chars: body.length,
      body_truncated: preview.length < body.length
    };
  }
}
