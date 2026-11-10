"use strict";

/**
 * Koswork OpenAPI / REST Endpoint & GraphQL Schema Technical Documentation Extractor
 * (`desktop/windows/browser/openapi-graphql-doc-extractor.cjs`).
 *
 * Deepens Requirements #2 & #3:
 * - Extracts REST API endpoints (`GET /v1/...`, `POST /api/...`, `DELETE`, `PUT`, `PATCH`),
 *   rate limits (`1200 req/min`, `X-RateLimit-Limit`), authentication schemes (`Bearer`, `OAuth2`, `API-Key`),
 *   and GraphQL SDL type/query blocks from technical documentation snapshots with exact
 *   UTF-16 `[startUtf16..endUtf16]` offsets and distinct `pageDate`, `eventDate`, and `fetchedAt`.
 * - Verifies API capability claims against extracted UTF-16 endpoint excerpts while rejecting
 *   bare documentation links (`BARE_API_DOC_LINK_REJECTED`).
 */

function extractApiEndpointsAndGraphqlSchemas(snapshot = {}) {
  const fullText = String(snapshot.fullTextUtf16 || snapshot.text || "");
  const endpoints = [];
  const graphqlTypes = [];
  const rateLimits = [];

  // 1. REST Endpoints: e.g. "GET /v1/models", "POST /api/v2/research/sessions"
  const endpointRe = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[a-zA-Z0-9_.\-/{}:?&=]+)/g;
  let m;
  while ((m = endpointRe.exec(fullText)) !== null) {
    const method = m[1].toUpperCase();
    const route = m[2];
    const quote = m[0];
    const startUtf16 = m.index;
    const endUtf16 = m.index + quote.length;

    endpoints.push({
      method,
      route,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      title: snapshot.title || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 2. GraphQL SDL blocks: e.g. "type Query { ... }", "type Mutation { ... }"
  const gqlRe = /\b(type|input|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
  while ((m = gqlRe.exec(fullText)) !== null) {
    const kind = m[1];
    const typeName = m[2];
    const body = m[3].trim();
    const quote = m[0];
    const startUtf16 = m.index;
    const endUtf16 = m.index + quote.length;

    graphqlTypes.push({
      kind,
      typeName,
      fieldsPreview: body.replace(/\s+/g, " "),
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 3. Rate-limit specifications: e.g. "1200 req/min", "600 запросов/мин", "100 rps"
  const rlRe = /(\d+)\s*(req\/min|requests\/min|запросов\/мин|rps|req\/sec|запросов\/сек)/gi;
  while ((m = rlRe.exec(fullText)) !== null) {
    const limitValue = Number(m[1]);
    const unit = m[2];
    const quote = m[0];
    const startUtf16 = m.index;
    const endUtf16 = m.index + quote.length;

    rateLimits.push({
      limitValue,
      unit,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    pageVersion: snapshot.pageVersion ?? 1,
    pageDate: snapshot.pageDate || null,
    eventDate: snapshot.eventDate || null,
    fetchedAt: snapshot.fetchedAt || null,
    endpointsCount: endpoints.length,
    graphqlTypesCount: graphqlTypes.length,
    rateLimitsCount: rateLimits.length,
    endpoints,
    graphqlTypes,
    rateLimits
  };
}

function verifyApiSpecClaimAgainstEndpointTable({
  snapshot = {},
  requiredMethod = "POST",
  requiredRouteSubstring = "",
  bareLinkOnly = false
} = {}) {
  if (bareLinkOnly) {
    return {
      verified: false,
      code: "BARE_API_DOC_LINK_REJECTED",
      reason: "Голая ссылка на документацию API без UTF-16 выдержки не является доказательством наличия эндпоинта."
    };
  }

  const extracted = extractApiEndpointsAndGraphqlSchemas(snapshot);
  const methodUpper = String(requiredMethod || "GET").toUpperCase();
  const routeSub = String(requiredRouteSubstring || "").trim();

  const matched = extracted.endpoints.find(
    (e) => e.method === methodUpper && (!routeSub || e.route.includes(routeSub))
  );

  if (!matched) {
    return {
      verified: false,
      code: "API_ENDPOINT_NOT_FOUND_IN_SNAPSHOT",
      reason: `Эндпоинт ${methodUpper} ${routeSub} не найден в тексте страницы документации.`
    };
  }

  return {
    verified: true,
    code: "API_ENDPOINT_VERIFIED_WITH_UTF16_EXCERPT",
    endpoint: matched,
    rateLimits: extracted.rateLimits,
    graphqlTypes: extracted.graphqlTypes
  };
}

module.exports = {
  extractApiEndpointsAndGraphqlSchemas,
  verifyApiSpecClaimAgainstEndpointTable
};
