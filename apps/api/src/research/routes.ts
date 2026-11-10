import { ResearchService } from "./service";

export interface ResearchApiRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}

export interface ResearchApiResponse {
  status: number;
  body: unknown;
}

export function createResearchRouter(service: ResearchService = new ResearchService()) {
  return async function handleResearchRoute(req: ResearchApiRequest): Promise<ResearchApiResponse> {
    try {
      if (req.method === "POST" && req.path === "/api/research/sessions") {
        const body = req.body || {};
        const session = service.createSession({
          projectId: typeof body.projectId === "string" ? body.projectId : null,
          title: String(body.title || "Исследование"),
          goal: String(body.goal || ""),
          options: Array.isArray(body.options) ? body.options.map(String) : [],
          criteria: Array.isArray(body.criteria) ? body.criteria.map(String) : [],
          maxQueriesPerQuestion:
            typeof body.maxQueriesPerQuestion === "number" ? body.maxQueriesPerQuestion : undefined,
          maxTotalQueries:
            typeof body.maxTotalQueries === "number" ? body.maxTotalQueries : undefined,
        });
        return { status: 201, body: session };
      }

      const sourceMatch = req.path.match(/^\/api\/research\/sessions\/([^/]+)\/sources$/);
      if (req.method === "POST" && sourceMatch) {
        const sessionId = sourceMatch[1];
        const body = req.body || {};
        const result = service.registerSourceSnapshot(sessionId, {
          url: String(body.url || ""),
          title: String(body.title || ""),
          textContent: String(body.textContent || ""),
          publishedDate: typeof body.publishedDate === "string" ? body.publishedDate : null,
          fetchedAt: typeof body.fetchedAt === "string" ? body.fetchedAt : undefined,
          readingLimitations: Array.isArray(body.readingLimitations)
            ? body.readingLimitations.map(String)
            : [],
        });
        return { status: 200, body: result };
      }

      const evidenceMatch = req.path.match(/^\/api\/research\/sessions\/([^/]+)\/evidence$/);
      if (req.method === "POST" && evidenceMatch) {
        const sessionId = evidenceMatch[1];
        const body = req.body || {};
        const session = service.attachVerifiableEvidence(sessionId, {
          sourceId: String(body.sourceId || ""),
          optionName: String(body.optionName || ""),
          criterion: String(body.criterion || ""),
          claimedValue: String(body.claimedValue || ""),
          verbatimQuote: String(body.verbatimQuote || ""),
          startUtf16: typeof body.startUtf16 === "number" ? body.startUtf16 : undefined,
          endUtf16: typeof body.endUtf16 === "number" ? body.endUtf16 : undefined,
        });
        return { status: 200, body: session };
      }

      const finalizeMatch = req.path.match(/^\/api\/research\/sessions\/([^/]+)\/finalize$/);
      if (req.method === "POST" && finalizeMatch) {
        const sessionId = finalizeMatch[1];
        const session = service.finalizeAndHandoffToProject(sessionId);
        return { status: 200, body: session };
      }

      const getMatch = req.path.match(/^\/api\/research\/sessions\/([^/]+)$/);
      if (req.method === "GET" && getMatch) {
        const session = service.getSession(getMatch[1]);
        return { status: 200, body: session };
      }

      return { status: 404, body: { error: "ROUTE_NOT_FOUND" } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 400, body: { error: message } };
    }
  };
}
