import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../healthcheck.mjs", import.meta.url));
const probe = (port) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "api"], {
      env: { ...process.env, API_PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"]
    });
    let error = "";
    child.stderr.on("data", (chunk) => (error += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, error }));
  });

test("container health requires a healthy SQLite response and never follows redirects", async (t) => {
  let status = 200;
  let database = "ok";
  let followedRedirects = 0;
  const server = createServer((request, response) => {
    if (request.url !== "/api/v1/health") {
      followedRedirects++;
      response.writeHead(200).end();
      return;
    }
    response.writeHead(status, {
      "content-type": "application/json",
      ...(status === 302 ? { location: "/login" } : {})
    });
    response.end(JSON.stringify({ status: "ok", database }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  assert.equal((await probe(port)).code, 0);
  database = "error";
  const degraded = await probe(port);
  assert.equal(degraded.code, 1);
  assert.match(degraded.error, /database is not healthy/u);
  status = 503;
  assert.equal((await probe(port)).code, 1);
  status = 302;
  assert.equal((await probe(port)).code, 1);
  assert.equal(followedRedirects, 0);
});
