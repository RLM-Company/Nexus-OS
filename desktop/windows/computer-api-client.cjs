"use strict";
const { randomUUID, randomBytes, createHash } = require("node:crypto");

function createComputerApiClient({ identity, getSession }) {
  async function request(route, { method = "GET", body, token, signal, expected } = {}) {
    if (
      !route.startsWith("/api/v1/") ||
      route.includes("?") ||
      route.includes("#") ||
      route.includes("\\")
    )
      throw Error("COMPUTER_ROUTE_INVALID");
    const current = await identity();
    if (!current) throw Error("COMPUTER_OWNER_UNVERIFIED");
    if (expected && (current.origin !== expected.origin || current.owner !== expected.owner))
      throw Error("COMPUTER_IDENTITY_CHANGED");
    const url = current.origin + route;
    const deadline = AbortSignal.timeout(130000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const response = await getSession().fetch(url, {
      method,
      redirect: "manual",
      cache: "no-store",
      credentials: "include",
      bypassCustomProtocolHandlers: true,
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-kosmora-computer-token": token } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: combined
    });
    if (
      response.redirected ||
      (response.url !== "" && response.url !== url) ||
      response.status < 200 ||
      (response.status >= 300 && response.status < 400) ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")
    )
      throw Error(response.status === 404 ? "COMPUTER_API_UNAVAILABLE" : "COMPUTER_REQUEST_FAILED");
    if (!response.body) throw Error("COMPUTER_RESPONSE_INVALID");
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 200000) throw Error("COMPUTER_RESPONSE_TOO_LARGE");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const after = await identity();
    if (!after || after.origin !== current.origin || after.owner !== current.owner)
      throw Error("COMPUTER_IDENTITY_CHANGED");
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (response.status >= 400) {
      const allowed = new Set([
        "COMPUTER_SESSION_STOPPED",
        "COMPUTER_POLICY_BLOCKED",
        "COMPUTER_BUSY",
        "COMPUTER_OUTPUT_INVALID",
        "COMPUTER_OUTPUT_INCOMPLETE",
        "COMPUTER_RUNTIME_UNAVAILABLE",
        "COMPUTER_ROUTE_UNAVAILABLE",
        "COMPUTER_SESSION_RECOVERY_REQUIRED",
        "OWNER_BUDGET_LIMIT",
        "USAGE_LIMIT"
      ]);
      throw Error(
        allowed.has(result?.error?.code)
          ? result.error.code
          : response.status === 404
            ? "COMPUTER_API_UNAVAILABLE"
            : "COMPUTER_REQUEST_FAILED"
      );
    }
    return result;
  }
  const root = (project) => `/api/v1/projects/${encodeURIComponent(project)}/computer-sessions`;
  return {
    request,
    async begin({ project, goal, maxSteps, context, signal, executionMode = "computer" }) {
      const token = randomBytes(32).toString("base64url"),
        id = randomUUID();
      const session = { id, token, origin: context.origin, owner: context.owner };
      try {
        const result = await request(root(project), {
          method: "POST",
          body: {
            client_request_id: id,
            client_secret: token,
            goal,
            max_steps: maxSteps,
            ...(executionMode !== "computer" ? { execution_mode: executionMode } : {})
          },
          expected: session,
          signal
        });
        if (result.id !== id) throw Error("COMPUTER_RESPONSE_INVALID");
        if (result.planner?.kind !== "model_gateway" || result.planner.mode !== "provider")
          throw Error("COMPUTER_LIVE_MODEL_REQUIRED");
        if (executionMode !== "computer" && result.execution_mode !== executionMode)
          throw Error("COMPUTER_LIVE_MODEL_REQUIRED");
        return session;
      } catch (error) {
        // Cancellation is safe even when the create response was lost; never recreate or retry.
        await request(`${root(project)}/${id}`, {
          method: "DELETE",
          token,
          expected: session,
          signal: AbortSignal.timeout(5000)
        }).catch(() => {});
        throw error;
      }
    },
    async next({ session, project, step, observation, previousResult, signal }) {
      const result = await request(`${root(project)}/${encodeURIComponent(session.id)}/step`, {
        method: "POST",
        token: session.token,
        expected: session,
        signal,
        body: { step, observation, previous_result: previousResult }
      });
      const source = result?.decision_source;
      if (
        !source ||
        source.kind !== "model_gateway" ||
        source.mode !== "provider" ||
        source.provider_id === "mock" ||
        source.session_id !== session.id ||
        source.step !== step ||
        typeof source.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.run_id) ||
        typeof source.provider_id !== "string" ||
        !source.provider_id ||
        source.provider_id.length > 160 ||
        typeof source.model_id !== "string" ||
        !source.model_id ||
        source.model_id.length > 240
      )
        throw Error("COMPUTER_DECISION_SOURCE_INVALID");
      return result;
    },
    authorize({ session, project, step, action, signal }) {
      return request(`${root(project)}/${encodeURIComponent(session.id)}/authorize-action`, {
        method: "POST",
        token: session.token,
        expected: session,
        signal,
        body: {
          step,
          action_hash: createHash("sha256").update(JSON.stringify(action)).digest("hex")
        }
      });
    },
    end({ session, project }) {
      return session
        ? request(`${root(project)}/${encodeURIComponent(session.id)}`, {
            method: "DELETE",
            token: session.token,
            expected: session,
            signal: AbortSignal.timeout(5000)
          })
        : Promise.resolve();
    }
  };
}
module.exports = { createComputerApiClient };
