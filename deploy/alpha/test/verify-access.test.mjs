import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { validateTlsCertificate, verifyAccess } from "../verify-access.mjs";

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
  const authorization = `Basic ${Buffer.from(`owner:${password}`).toString("base64")}`;
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    if (overrides.redirect && !overrides.authenticatedRedirect) {
      response.writeHead(302, { location: "/redirect-target" }).end();
      return;
    }
    if (request.headers.authorization !== authorization) {
      response.writeHead(overrides.unprotected ? 200 : 401).end();
      return;
    }
    if (overrides.authenticatedRedirect && request.url === "/api/v1/health") {
      response.writeHead(302, { location: "/redirect-target" }).end();
      return;
    }
    if (request.url === "/") {
      response.writeHead(200).end("Owner interface");
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
    tls_certificate_expires_at: null,
    model_requests_paused: true
  });
  assert.equal(requests.length, 6);
  assert.deepEqual(
    requests.slice(0, 2).map((request) => request.authorization),
    [undefined, undefined]
  );
  assert.ok(requests.every((request) => !/chat|work|run/u.test(request.path)));
});

test("validates TLS certificate dates and minimum remaining lifetime", () => {
  assert.deepEqual(
    validateTlsCertificate(
      {
        valid_from: "Sep 30 00:00:00 2026 GMT",
        valid_to: "Oct 03 00:00:00 2026 GMT"
      },
      now
    ),
    { expires_at: "2026-10-03T00:00:00.000Z" }
  );

  for (const certificate of [
    { valid_from: "not-a-date", valid_to: "Oct 03 00:00:00 2026 GMT" },
    { valid_from: "Oct 02 00:00:00 2026 GMT", valid_to: "Oct 03 00:00:00 2026 GMT" },
    { valid_from: "Sep 30 00:00:00 2026 GMT", valid_to: "Oct 01 00:00:00 2026 GMT" },
    { valid_from: "Sep 30 00:00:00 2026 GMT", valid_to: "Oct 02 00:00:00 2026 GMT" }
  ]) {
    assert.throws(() => validateTlsCertificate(certificate, now), /TLS certificate/u);
  }
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
