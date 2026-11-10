"use strict";

const http = require("node:http");
const { buildApiSyncBundleFromDesktopCycle } = require("./work-executor-sqlite-bridge.cjs");

/**
 * Koswork Full-Stack Desktop-to-HTTP API Roundtrip Verifier
 * (`desktop/windows/browser/fullstack-api-roundtrip-verifier.cjs`).
 *
 * Connects the desktop Browser Research Cycle (`executeMultiSiteResearchWorkflow` +
 * `buildApiSyncBundleFromDesktopCycle`) with a live HTTP API server implementing
 * the `/api/koswork/browser-research/sessions` contract:
 * 1. `POST /api/koswork/browser-research/sessions` — validates and stores the synced
 *    desktop session, rejecting any `"confirmed"` claim that lacks a valid UTF-16 excerpt
 *    with `422 Unprocessable Entity` (`BARE_LINK_NOT_PROOF`).
 * 2. `GET /api/koswork/browser-research/sessions/:sessionId` — returns the stored
 *    session with distinct `pageDate`, `eventDate`, and `fetchedAt`.
 * 3. `DELETE /api/koswork/browser-research/sessions/:sessionId` — purges session data.
 */

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body, "utf8")
  });
  res.end(body);
}

async function startBrowserResearchApiSyncServer() {
  const sessions = new Map();

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = parsedUrl.pathname;

    if (req.method === "POST" && pathname === "/api/koswork/browser-research/sessions") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const excerptMap = new Map(
            (payload.excerpts || []).map((e) => [e.excerptId, e])
          );

          for (const claim of payload.claims || []) {
            if (claim.verificationStatus === "confirmed") {
              const exc = claim.excerptId ? excerptMap.get(claim.excerptId) : null;
              if (
                !exc ||
                !exc.quote ||
                !Number.isInteger(exc.startUtf16) ||
                !Number.isInteger(exc.endUtf16) ||
                exc.endUtf16 <= exc.startUtf16
              ) {
                sendJson(res, 422, {
                  error: "BARE_LINK_NOT_PROOF",
                  message:
                    "Ссылка сама по себе не является доказательством утверждения: требуется UTF-16 выдержка."
                });
                return;
              }
            }
          }

          sessions.set(payload.sessionId, payload);
          sendJson(res, 201, {
            saved: true,
            sessionId: payload.sessionId,
            sourcesCount: (payload.sources || []).length,
            excerptsCount: (payload.excerpts || []).length,
            claimsCount: (payload.claims || []).length
          });
        } catch (err) {
          sendJson(res, 400, { error: "INVALID_JSON", message: err.message });
        }
      });
      return;
    }

    const sessionMatch = pathname.match(
      /^\/api\/koswork\/browser-research\/sessions\/([^/]+)$/
    );
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      if (req.method === "GET") {
        const stored = sessions.get(sessionId);
        if (!stored) {
          sendJson(res, 404, { error: "SESSION_NOT_FOUND" });
          return;
        }
        sendJson(res, 200, stored);
        return;
      }
      if (req.method === "DELETE") {
        const deleted = sessions.delete(sessionId);
        sendJson(res, 200, { purged: deleted, sessionId });
        return;
      }
    }

    sendJson(res, 404, { error: "NOT_FOUND" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  return {
    baseOrigin: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    sessions,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function httpJsonRequest(url, method = "GET", bodyObj = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuf = bodyObj ? Buffer.from(JSON.stringify(bodyObj), "utf8") : null;
    const req = http.request(
      parsed,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(bodyBuf
            ? {
                "Content-Type": "application/json",
                "Content-Length": bodyBuf.length
              }
            : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 200,
            data: text ? JSON.parse(text) : null
          });
        });
      }
    );
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function runDesktopToApiHttpRoundtrip({ cycleResult, sessionId = "brs-http-e2e-01" } = {}) {
  const apiServer = await startBrowserResearchApiSyncServer();
  try {
    const bundle = buildApiSyncBundleFromDesktopCycle(cycleResult, { sessionId });

    // 1. POST valid desktop research bundle
    const postRes = await httpJsonRequest(
      `${apiServer.baseOrigin}/api/koswork/browser-research/sessions`,
      "POST",
      bundle
    );

    // 2. GET stored session back and verify distinct pageDate / eventDate / fetchedAt
    const getRes = await httpJsonRequest(
      `${apiServer.baseOrigin}/api/koswork/browser-research/sessions/${encodeURIComponent(
        sessionId
      )}`,
      "GET"
    );

    // 3. Verify that POSTing a tampered bundle with a bare-link "confirmed" claim is rejected with 422
    const tamperedBundle = {
      ...bundle,
      sessionId: `${sessionId}-tampered`,
      claims: [
        {
          claimId: "bare-link-claim",
          verificationStatus: "confirmed",
          excerptId: null,
          sourceUrl: "https://corpus.local/bare"
        }
      ]
    };
    const bareLinkRes = await httpJsonRequest(
      `${apiServer.baseOrigin}/api/koswork/browser-research/sessions`,
      "POST",
      tamperedBundle
    );

    // 4. DELETE / purge session
    const delRes = await httpJsonRequest(
      `${apiServer.baseOrigin}/api/koswork/browser-research/sessions/${encodeURIComponent(
        sessionId
      )}`,
      "DELETE"
    );

    return {
      postStatus: postRes.status,
      postData: postRes.data,
      getStatus: getRes.status,
      retrievedSession: getRes.data,
      bareLinkRejectionStatus: bareLinkRes.status,
      bareLinkRejectionCode: bareLinkRes.data?.error,
      deleteStatus: delRes.status,
      purged: Boolean(delRes.data?.purged)
    };
  } finally {
    await apiServer.close();
  }
}

module.exports = {
  startBrowserResearchApiSyncServer,
  runDesktopToApiHttpRoundtrip
};
