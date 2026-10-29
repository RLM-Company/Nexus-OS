"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createComputerApiClient } = require("../computer-api-client.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const owner = { origin: "https://example.test", owner: "owner" };
const session = { ...owner, id: "session-id", token: "secret" };
const response = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

test("computer API never forwards an old session secret to a new server or owner", async () => {
  for (const changed of [
    { ...owner, origin: "https://other.test" },
    { ...owner, owner: "other" }
  ]) {
    let calls = 0;
    const client = createComputerApiClient({
      identity: async () => changed,
      getSession: () => ({
        fetch: async () => {
          calls++;
          return response({});
        }
      })
    });
    await assert.rejects(client.end({ session, project: "project" }), /IDENTITY_CHANGED/);
    assert.equal(calls, 0);
  }
});
test("computer API pins native fetch, keeps cookies, hides redirects and rechecks identity after body", async () => {
  let options;
  const client = createComputerApiClient({
    identity: async () => owner,
    getSession: () => ({
      fetch: async (_url, value) => {
        options = value;
        return response({ ok: true });
      }
    })
  });
  assert.deepEqual(await client.request("/api/v1/projects"), { ok: true });
  assert.equal(options.redirect, "manual");
  assert.equal(options.credentials, "include");
  assert.equal(options.bypassCustomProtocolHandlers, true);
  let checks = 0;
  const changed = createComputerApiClient({
    identity: async () => (++checks === 1 ? owner : { ...owner, owner: "other" }),
    getSession: () => ({ fetch: async () => response({ private: true }) })
  });
  await assert.rejects(changed.request("/api/v1/projects"), /IDENTITY_CHANGED/);
});
test("computer API rejects foreign URLs, redirects, oversized bodies and unsafe routes", async () => {
  for (const answer of [
    { status: 302, url: "", headers: new Headers(), body: null },
    {
      status: 200,
      url: "https://other.test/api/v1/projects",
      headers: new Headers({ "content-type": "application/json" }),
      body: null
    },
    response({ huge: "x".repeat(200001) })
  ]) {
    const client = createComputerApiClient({
      identity: async () => owner,
      getSession: () => ({ fetch: async () => answer })
    });
    await assert.rejects(client.request("/api/v1/projects"), /COMPUTER_/);
  }
  const client = createComputerApiClient({
    identity: async () => owner,
    getSession: () => ({
      fetch: async () => {
        throw Error("must not run");
      }
    })
  });
  await assert.rejects(client.request("https://other.test/"), /ROUTE_INVALID/);
});
test("a lost create response triggers only scoped cancellation, never automatic recreation", async () => {
  const calls = [];
  const client = createComputerApiClient({
    identity: async () => owner,
    getSession: () => ({
      fetch: async (url, options) => {
        calls.push({ url, options });
        if (options.method === "POST") throw Error("lost response");
        return response({ stopped: true });
      }
    })
  });
  await assert.rejects(
    client.begin({
      project: "project",
      goal: "task",
      maxSteps: 2,
      context: owner,
      signal: new AbortController().signal
    }),
    /lost response/
  );
  assert.deepEqual(
    calls.map((entry) => entry.options.method),
    ["POST", "DELETE"]
  );
  const create = JSON.parse(calls[0].options.body);
  assert.ok(calls[1].url.endsWith(create.client_request_id));
  assert.equal(calls[1].options.headers["x-kosmora-computer-token"], create.client_secret);
});

test("computer API forwards only bounded known error codes, never arbitrary server messages", async () => {
  for (const code of ["COMPUTER_POLICY_BLOCKED", "provider token must not appear"]) {
    const client = createComputerApiClient({
      identity: async () => owner,
      getSession: () => ({
        fetch: async () =>
          new Response(JSON.stringify({ error: { code, message: "private details" } }), {
            status: 409,
            headers: { "content-type": "application/json" }
          })
      })
    });
    await assert.rejects(
      client.request("/api/v1/projects"),
      code === "COMPUTER_POLICY_BLOCKED" ? /COMPUTER_POLICY_BLOCKED/ : /COMPUTER_REQUEST_FAILED/
    );
  }
});

test("production computer client refuses missing/test planner before any screen capture", async () => {
  for (const planner of [undefined, { kind: "model_gateway", mode: "test" }]) {
    let observations = 0;
    const methods = [];
    const client = createComputerApiClient({
      identity: async () => owner,
      getSession: () => ({
        fetch: async (_url, options) => {
          methods.push(options.method);
          return options.method === "POST"
            ? response({ id: JSON.parse(options.body).client_request_id, planner })
            : response({ stopped: true });
        }
      })
    });
    const runner = new ComputerSession({
      planner: client,
      driver: {
        observe: async () => {
          observations++;
          throw Error("must not observe");
        },
        stop() {}
      },
      identity: async () => owner,
      confirm: async () => true,
      notify() {}
    });
    await assert.rejects(
      runner.run({ project: "project", goal: "user task" }),
      /LIVE_MODEL_REQUIRED/
    );
    assert.equal(observations, 0);
    assert.deepEqual(methods, ["POST", "DELETE"]);
  }
});

test("computer decisions must identify a provider run bound to this session and step", async () => {
  const source = {
    kind: "model_gateway",
    mode: "provider",
    provider_id: "fixture-external-provider",
    model_id: "fixture-model",
    run_id: "00000000-0000-4000-8000-000000000001",
    session_id: session.id,
    step: 0
  };
  const decision = {
    action: { kind: "observe" },
    message: "fixture",
    requires_confirmation: false,
    decision_source: source
  };
  const next = async (decision_source) => {
    const client = createComputerApiClient({
      identity: async () => owner,
      getSession: () => ({ fetch: async () => response({ ...decision, decision_source }) })
    });
    return client.next({
      session,
      project: "project",
      step: 0,
      observation: {},
      previousResult: "",
      signal: new AbortController().signal
    });
  };
  assert.deepEqual(await next(source), decision);
  for (const changed of [
    undefined,
    { ...source, mode: "test" },
    { ...source, provider_id: "mock" },
    { ...source, session_id: "foreign" },
    { ...source, step: 1 },
    { ...source, run_id: "" }
  ])
    await assert.rejects(next(changed), /DECISION_SOURCE_INVALID/);
});
