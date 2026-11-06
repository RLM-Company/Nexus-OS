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

test("native source and document tools require explicit server capability flags", async () => {
  for (const capability of [undefined, false, "true", true]) {
    const client = createComputerApiClient({
      identity: async () => owner,
      getSession: () => ({
        fetch: async (_url, options) =>
          response({
            id: JSON.parse(options.body).client_request_id,
            execution_mode: "work",
            planner: { kind: "model_gateway", mode: "provider" },
            ...(capability === undefined
              ? {}
              : {
                  supports_browser_text_reads: capability,
                  supports_workspace_read_lines: capability,
                  supports_workspace_text_reads: capability,
                  supports_workspace_documents: capability,
                  supports_workspace_document_reads: capability
                })
          })
      })
    });
    const result = await client.begin({
      project: "project",
      goal: "Read source",
      maxSteps: 5,
      context: owner,
      executionMode: "work",
      signal: new AbortController().signal
    });
    assert.equal(result.supports_browser_text_reads, capability === true ? true : undefined);
    assert.equal(result.supports_workspace_read_lines, capability === true ? true : undefined);
    assert.equal(result.supports_workspace_text_reads, capability === true ? true : undefined);
    assert.equal(result.supports_workspace_documents, capability === true ? true : undefined);
    assert.equal(result.supports_workspace_document_reads, capability === true ? true : undefined);
  }
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

test("cancelled native requests never start fetch after pending identity verification", async () => {
  for (const alreadyCancelled of [true, false]) {
    const controller = new AbortController();
    let enter,
      release,
      fetches = 0;
    const ready = new Promise((resolve) => {
      enter = resolve;
    });
    const client = createComputerApiClient({
      identity: async () => {
        enter();
        if (!alreadyCancelled)
          await new Promise((resolve) => {
            release = resolve;
          });
        return owner;
      },
      getSession: () => ({
        fetch: async () => {
          fetches++;
          return response({ ok: true });
        }
      })
    });
    if (alreadyCancelled) controller.abort();
    const pending = client.request("/api/v1/projects", { signal: controller.signal });
    if (!alreadyCancelled) {
      await ready;
      controller.abort();
      release();
    }
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(fetches, 0);
  }
});

test("late fetch and body replies cannot revive an aborted native request", async (t) => {
  for (const phase of ["fetch", "body", "final identity"])
    await t.test(phase, async () => {
      const controller = new AbortController();
      let enter,
        release,
        identityChecks = 0;
      const ready = new Promise((resolve) => {
        enter = resolve;
      });
      const hold = () =>
        new Promise((resolve) => {
          release = resolve;
          enter();
        });
      const client = createComputerApiClient({
        identity: async () => {
          if (++identityChecks === 2 && phase === "final identity") await hold();
          return owner;
        },
        getSession: () => ({
          fetch: async () => {
            if (phase === "fetch") await hold();
            if (phase !== "body") return response({ private: "fixture" });
            return new Response(
              new ReadableStream({
                async start(stream) {
                  await hold();
                  stream.enqueue(Buffer.from('{"private":"fixture"}'));
                  stream.close();
                }
              }),
              { headers: { "content-type": "application/json" } }
            );
          }
        })
      });
      const pending = client.request("/api/v1/projects", { signal: controller.signal });
      await ready;
      controller.abort();
      release();
      await assert.rejects(pending, (error) => error.name === "AbortError");
    });
});

test("native JSON preserves split multilingual UTF-8 and rejects corrupt bytes without echoing payloads", async () => {
  const valid = Buffer.from(JSON.stringify({ quote: "Цена 19 700 ₽, кроме доставки. 🚀" }));
  for (const bytes of [
    valid,
    Buffer.from([123, 34, 120, 34, 58, 34, 0xc3, 0x28, 34, 125]),
    Buffer.from('{"private-fixture-details":')
  ]) {
    const client = createComputerApiClient({
      identity: async () => owner,
      getSession: () => ({
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(stream) {
                for (let at = 0; at < bytes.length; at++)
                  stream.enqueue(bytes.subarray(at, at + 1));
                stream.close();
              }
            }),
            { headers: { "content-type": "application/json" } }
          )
      })
    });
    if (bytes === valid)
      assert.deepEqual(await client.request("/api/v1/projects"), JSON.parse(valid.toString()));
    else
      await assert.rejects(
        client.request("/api/v1/projects"),
        (error) => error.message === "COMPUTER_RESPONSE_INVALID"
      );
  }
});

test("page reader is advertised only after server capability negotiation and cannot bypass it", async () => {
  for (const capability of [undefined, true]) {
    const native = {
      observation_id: "native-reader",
      active_window: "tab:0",
      width: 960,
      height: 740,
      description: "{}",
      browser: { tab_id: "a".repeat(12), generation: 0, read_text: true }
    };
    let seen,
      executions = 0;
    const runner = new ComputerSession({
      executionMode: "browser",
      identity: async () => owner,
      confirm: async () => true,
      notify() {},
      driver: {
        observe: async () => native,
        execute: async () => {
          executions++;
          return { content: "fixture" };
        },
        stop() {}
      },
      planner: {
        begin: async () => ({ id: "fixture", supports_browser_text_reads: capability }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation }) => {
          seen = observation.browser;
          return {
            action: { kind: "browser_read_text", offset_utf16: 0, expected_version: null },
            message: "fixture",
            requires_confirmation: false
          };
        }
      }
    });
    if (capability) await runner.run({ project: "project", goal: "Read this page", maxSteps: 1 });
    else
      await assert.rejects(
        runner.run({ project: "project", goal: "Read this page", maxSteps: 1 }),
        /COMPUTER_ACTION_INVALID/
      );
    assert.equal(seen.read_text, capability === true ? true : undefined);
    assert.equal(executions, capability === true ? 1 : 0);
    assert.equal(native.browser.read_text, true);
  }
});

test("file pages require both current server and selected-folder capability", async () => {
  for (const [server, native] of [
    [false, true],
    [true, false],
    [true, true]
  ]) {
    let executed = 0,
      advertised;
    const workspace = {
      snapshot: () => ({ id: "a".repeat(24), name: "Selected" }),
      supportsTextReads: () => native,
      execute: async () => {
        executed++;
        return { content: "fixture" };
      }
    };
    const runner = new ComputerSession({
      executionMode: "work",
      identity: async () => owner,
      workspace,
      confirm: async () => true,
      notify() {},
      driver: {
        begin() {},
        checkpoint: () => null,
        observe: async () => ({
          observation_id: "file-page",
          active_window: "work:0",
          width: 960,
          height: 740,
          description: "{}",
          work: { environment: "none", generation: 0, plan_steps: 0, plan_complete: false }
        }),
        stop() {}
      },
      planner: {
        begin: async () => ({ id: "fixture", supports_workspace_text_reads: server }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation }) => {
          advertised = observation.workspace.read_text_pages;
          return {
            action: {
              kind: "workspace_read_text",
              path: "source.txt",
              offset_utf16: 0,
              expected_version: null
            },
            message: "Fixture only",
            requires_confirmation: false
          };
        }
      }
    });
    if (server && native)
      await runner.run({ project: "project", goal: "Read source", maxSteps: 1 });
    else
      await assert.rejects(
        runner.run({ project: "project", goal: "Read source", maxSteps: 1 }),
        /COMPUTER_ACTION_INVALID/
      );
    assert.equal(advertised, server && native ? true : undefined);
    assert.equal(executed, server && native ? 1 : 0);
  }
});
