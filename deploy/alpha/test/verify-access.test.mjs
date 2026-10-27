import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { verifyAccess } from "../verify-access.mjs";

const now = Date.parse("2026-10-01T00:00:00Z");
const password = "fixture-owner-password";
const currentSession = {
  current: true,
  status: "active",
  actor_kind: "owner",
  owner_id: "hosted-alpha-owner",
  actor_id: "hosted-alpha-owner",
  expires_at: "2026-10-07T00:00:00Z"
};

async function fixture(t, overrides = {}) {
  const requests = [];
  let unauthenticatedNavigations = 0;
  const authorization = `Basic ${Buffer.from(`owner:${password}`).toString("base64")}`;
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    if (overrides.form) {
      if (request.url === "/login") {
        response.writeHead(200).end("Owner login form");
        return;
      }
      if (request.url === "/__owner/login") {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          const valid = new URLSearchParams(body).get("password") === password;
          response
            .writeHead(
              valid ? 303 : 422,
              valid
                ? {
                    location: "/",
                    "set-cookie":
                      "__Host-cosmora-owner=" +
                      "a".repeat(64) +
                      "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800"
                  }
                : {}
            )
            .end();
        });
        return;
      }
      if (request.headers.cookie !== "__Host-cosmora-owner=" + "a".repeat(64)) {
        if (request.url === "/") unauthenticatedNavigations += 1;
        response
          .writeHead(
            request.url === "/" &&
              !(overrides.concurrentAuthFailure && unauthenticatedNavigations > 1)
              ? 303
              : 401,
            request.url === "/" ? { location: "/login" } : {}
          )
          .end();
        return;
      }
    }
    if (overrides.redirect && !overrides.authenticatedRedirect) {
      response.writeHead(302, { location: "/redirect-target" }).end();
      return;
    }
    if (!overrides.form && request.headers.authorization !== authorization) {
      response.writeHead(overrides.unprotected ? 200 : 401).end();
      return;
    }
    if (overrides.authenticatedRedirect && request.url === "/api/v1/health") {
      response.writeHead(302, { location: "/redirect-target" }).end();
      return;
    }
    if (request.url === "/") {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          overrides.markup ??
            '<link rel="stylesheet" href="/_next/static/chunks/app.css"><script src="/_next/static/chunks/app.js"></script>Owner interface'
        );
      return;
    }
    if (request.url.startsWith("/_next/static/")) {
      response
        .writeHead(
          overrides.assetStatus ?? 200,
          overrides.assetRedirect
            ? { location: "/redirect-target" }
            : {
                "content-type":
                  overrides.assetType ??
                  (request.url.endsWith(".css") ? "text/css" : "application/javascript")
              }
        )
        .end("fixture asset");
      return;
    }
    const bodies = {
      "/api/v1/health": overrides.health ?? { status: "ok", database: "ok" },
      "/api/v1/identity/sessions": overrides.sessions ?? { items: [currentSession] },
      "/api/v1/operations/status": overrides.operations ?? {
        process_stop: { active: true, reason: "private-stop-reason" }
      }
    };
    response.writeHead(
      request.url === "/api/v1/identity/sessions" && overrides.sessionStatus
        ? overrides.sessionStatus
        : 200,
      { "content-type": "application/json" }
    );
    response.end(JSON.stringify(bodies[request.url] ?? { error: "private-error-detail" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests
  };
}

test("verifies password protection, current owner expiry and stop without model requests", async (t) => {
  const { origin, requests } = await fixture(t);
  assert.deepEqual(await verifyAccess({ origin, password, now }), {
    session_expires_at: currentSession.expires_at.replace("Z", ".000Z"),
    model_requests_paused: true
  });
  assert.equal(requests.length, 10);
  assert.deepEqual(
    requests.slice(0, 2).map((request) => request.authorization),
    [undefined, undefined]
  );
  assert.ok(requests.every((request) => !/chat|work|run/u.test(request.path)));
});

test("asset verification rejects missing references, wrong MIME and redirects without following them", async (t) => {
  for (const overrides of [
    { markup: "Bare HTML with no client assets" },
    { assetStatus: 404 },
    { assetType: "text/html" },
    { assetStatus: 302, assetRedirect: true }
  ]) {
    const f = await fixture(t, overrides);
    await assert.rejects(verifyAccess({ origin: f.origin, password, now }));
    assert.ok(f.requests.every((request) => request.path !== "/redirect-target"));
  }
});

test("asset references cannot send owner credentials to another origin", async (t) => {
  const f = await fixture(t, {
    markup:
      '<script src="https://other.example/_next/static/chunks/app.js"></script><link href="/_next/static/chunks/app.css">'
  });
  await assert.rejects(verifyAccess({ origin: f.origin, password, now }), /same protected origin/);
  assert.ok(f.requests.every((request) => !request.path.startsWith("/_next/static/")));
});

test("concurrent asset loading rechecks the unauthenticated navigation boundary", async (t) => {
  const f = await fixture(t, { form: true, concurrentAuthFailure: true });
  await assert.rejects(
    verifyAccess({ origin: f.origin, password, now, authMode: "form" }),
    /password protection failed/
  );
  assert.ok(f.requests.some((request) => request.path.endsWith(".css")));
});

test("verifies the form session without following login redirects or exposing Basic credentials", async (t) => {
  const { origin, requests } = await fixture(t, { form: true });
  const result = await verifyAccess({ origin, password, now, authMode: "form" });
  assert.equal(result.model_requests_paused, true);
  assert.equal(result.session_expires_at, "2026-10-07T00:00:00.000Z");
  assert.ok(requests.every((request) => request.authorization === undefined));
  assert.ok(requests.some((request) => request.path === "/__owner/login"));
});
test("form verifier rejects wrong passwords and a revoked downstream owner session", async (t) => {
  const good = await fixture(t, { form: true });
  await assert.rejects(
    verifyAccess({ origin: good.origin, password: "incorrect", now, authMode: "form" }),
    /form login failed/u
  );
  const revoked = await fixture(t, { form: true, sessionStatus: 401 });
  await assert.rejects(
    verifyAccess({ origin: revoked.origin, password, now, authMode: "form" }),
    /Authenticated access failed/u
  );
});

test("healthy public health cannot conceal an expired bearer session", async (t) => {
  const { origin } = await fixture(t, { sessionStatus: 401 });
  await assert.rejects(verifyAccess({ origin, password, now }), /Authenticated access failed/u);
});

test("rejects expiring, invalid or wrong-owner current sessions", async (t) => {
  for (const change of [
    { expires_at: "2026-10-02T00:00:00Z" },
    { expires_at: "2026-10-01T23:00:00Z" },
    { expires_at: "2026-10-01T00:00:00Z" },
    { expires_at: "not-a-date" },
    { status: "revoked" },
    { actor_kind: "agent" },
    { owner_id: "another-owner" },
    { actor_id: "another-actor" },
    { current: false }
  ]) {
    const { origin } = await fixture(t, {
      sessions: { items: [{ ...currentSession, ...change }] }
    });
    await assert.rejects(verifyAccess({ origin, password, now }), /Owner session|owner session/u);
  }
  const ambiguous = await fixture(t, { sessions: { items: [currentSession, currentSession] } });
  await assert.rejects(
    verifyAccess({ origin: ambiguous.origin, password, now }),
    /owner session is unavailable/u
  );
});

test("rejects unprotected and degraded services", async (t) => {
  const unprotected = await fixture(t, { unprotected: true });
  await assert.rejects(
    verifyAccess({ origin: unprotected.origin, password, now }),
    /password protection failed/u
  );
  const degraded = await fixture(t, { health: { status: "ok", database: "error" } });
  await assert.rejects(verifyAccess({ origin: degraded.origin, password, now }), /SQLite/u);
});

test("does not follow redirects or send credentials to a redirect target", async (t) => {
  const { origin, requests } = await fixture(t, { redirect: true });
  await assert.rejects(verifyAccess({ origin, password, now }), /redirect/u);
  assert.deepEqual(requests, [{ path: "/", authorization: undefined }]);
  const authenticated = await fixture(t, { authenticatedRedirect: true });
  await assert.rejects(verifyAccess({ origin: authenticated.origin, password, now }), /redirect/u);
  assert.ok(authenticated.requests.every((request) => request.path !== "/redirect-target"));
});

test("rejects malformed stop status and accepts an explicitly cleared stop", async (t) => {
  const malformed = await fixture(t, { operations: {} });
  await assert.rejects(
    verifyAccess({ origin: malformed.origin, password, now }),
    /execution status is unavailable/u
  );
  const cleared = await fixture(t, { operations: { process_stop: null } });
  assert.equal(
    (await verifyAccess({ origin: cleared.origin, password, now })).model_requests_paused,
    false
  );
});

test("rejects origins with embedded credentials or public cleartext HTTP", async () => {
  for (const origin of [
    "https://owner:secret@example.com",
    "http://example.com",
    "https://example.com/private",
    "https://example.com/?password=secret"
  ]) {
    await assert.rejects(verifyAccess({ origin, password, now }), /HTTPS origin/u);
  }
});
