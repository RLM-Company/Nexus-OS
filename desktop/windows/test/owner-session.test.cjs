"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchVerifiedOwner, fetchElectronOwner } = require("../owner-session.cjs");
const origin = "https://kosmora.example";
const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (owner_id, current = true) => ({
  owner_id,
  current,
  status: "active",
  actor_kind: "owner",
  expires_at: "2035-01-01T00:00:00.000Z"
});
function response(
  body,
  {
    status = 200,
    url = `${origin}/api/v1/identity/sessions`,
    type = "application/json",
    declaredSize
  } = {}
) {
  const payload = new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));
  const headers = new Headers({
    "content-type": type,
    "content-length": String(declaredSize ?? payload.length)
  });
  return {
    status,
    url,
    headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      }
    })
  };
}

test("desktop owner is server-confirmed, exactly one current active owner", async () => {
  const result = await fetchVerifiedOwner(async (url, init) => {
    assert.equal(url, `${origin}/api/v1/identity/sessions`);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "include");
    return response({ items: [row(ownerA), row(ownerB, false)] });
  }, origin);
  assert.deepEqual(result, {
    state: "verified",
    owner: ownerA,
    expiresAt: Date.parse("2035-01-01T00:00:00.000Z")
  });
  for (const items of [
    [row(ownerA), row(ownerB)],
    [row(ownerA, false)],
    [{ ...row(ownerA), status: "revoked" }],
    [{ ...row(ownerA), expires_at: "2020-01-01T00:00:00.000Z" }]
  ]) {
    assert.deepEqual(await fetchVerifiedOwner(async () => response({ items }), origin), {
      state: "denied"
    });
  }
});

test("session redirects, foreign origins, HTML, bad JSON, oversized bodies never authorize a draft", async () => {
  const valid = { items: [row(ownerA)] };
  const samples = [
    response(valid, { status: 302 }),
    response(valid, { url: "https://evil.example/api/v1/identity/sessions" }),
    response(valid, { type: "text/html" }),
    response("{not-json"),
    response(valid, { declaredSize: 999999 }),
    response("x".repeat(32001), { declaredSize: 0 })
  ];
  for (const reply of samples) {
    assert.deepEqual(await fetchVerifiedOwner(async () => reply, origin), { state: "denied" });
  }
  assert.deepEqual(
    await fetchVerifiedOwner(async () => {
      throw new Error("Network offline");
    }, origin),
    { state: "offline" }
  );
  assert.deepEqual(await fetchVerifiedOwner(async () => response(valid, { status: 401 }), origin), {
    state: "denied"
  });
});

test("Electron's empty Response.url is adapted only behind pinned, non-following session fetch", async () => {
  const result = await fetchElectronOwner(
    {
      fetch: async (url, init) => {
        assert.equal(url, `${origin}/api/v1/identity/sessions`);
        assert.equal(init.redirect, "manual");
        assert.equal(init.bypassCustomProtocolHandlers, true);
        assert.equal(init.credentials, "include");
        // Electron 44 creates this kind of Response, rather than a Node fetch Response.
        return new Response(JSON.stringify({ items: [row(ownerA)] }), {
          headers: { "content-type": "application/json" }
        });
      }
    },
    origin
  );
  assert.equal(result.state, "verified");
  assert.equal(result.owner, ownerA);
  assert.equal(
    (await fetchVerifiedOwner(async () => response({ items: [row(ownerA)] }, { url: "" }), origin))
      .state,
    "denied"
  );
});

test("Electron adapter still rejects redirect responses, foreign URLs, unauthorized and invalid identities", async () => {
  for (const reply of [
    response({ items: [row(ownerA)] }, { url: "", status: 302 }),
    response({ items: [row(ownerA)] }, { url: "", status: 401 }),
    response({ items: [row(ownerA)] }, { url: "https://evil.example/api/v1/identity/sessions" }),
    { ...response({ items: [row(ownerA)] }, { url: "" }), redirected: true },
    response({ items: [row(ownerA), row(ownerB)] }, { url: "" }),
    response({ items: [row(ownerA)] }, { url: "", type: "text/html" })
  ])
    assert.equal((await fetchElectronOwner({ fetch: async () => reply }, origin)).state, "denied");
});

test("Electron's cancelled native redirect denies authorization; a network outage remains offline", async () => {
  for (const [message, expected] of [
    ["Redirect was cancelled", "denied"],
    ["net::ERR_CONNECTION_REFUSED", "offline"]
  ]) {
    const result = await fetchElectronOwner(
      {
        fetch: async () => {
          throw new Error(message);
        }
      },
      origin
    );
    assert.equal(result.state, expected);
  }
});
