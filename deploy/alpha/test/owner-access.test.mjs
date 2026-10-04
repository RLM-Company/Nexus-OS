import assert from "node:assert/strict";
import { test } from "node:test";
import { createOwnerAccess, hashOwnerPassword } from "../owner-access.mjs";

const password = "fixture-owner-password";
const passwordHash = hashOwnerPassword(password);
const origin = "https://cosmora.example";
async function fixture(t) {
  let clock = 100000;
  const server = createOwnerAccess({ origin, passwordHash, now: () => clock });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(base + path, { redirect: "manual", ...options });
  const login = (value = password, headers = {}) =>
    request("/__owner/login", {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({ username: "owner", password: value })
    });
  const verify = (cookie, path = "/") =>
    request("/__owner/verify", {
      headers: { ...(cookie ? { cookie } : {}), "x-forwarded-uri": path }
    });
  return { request, login, verify, advance: (ms) => (clock += ms) };
}

test("unauthed navigation goes to an ordinary form; API stays closed without a Basic challenge", async (t) => {
  const f = await fixture(t);
  const navigation = await f.verify();
  assert.equal(navigation.status, 303);
  assert.equal(navigation.headers.get("location"), "/login");
  assert.equal(navigation.headers.get("www-authenticate"), null);
  const api = await f.verify(null, "/api/v1/chats");
  assert.equal(api.status, 401);
  assert.equal(api.headers.get("www-authenticate"), null);
  const form = await f.request("/login");
  assert.equal(form.status, 200);
  assert.equal(form.headers.get("referrer-policy"), "same-origin");
  assert.match(await form.text(), /Войти в Cosmora/u);
  assert.match(form.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
});
test("valid login creates a bounded secure session; invalid and duplicate cookies stay closed", async (t) => {
  const f = await fixture(t);
  const login = await f.login();
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/");
  const cookie = login.headers.get("set-cookie");
  assert.match(
    cookie,
    /^__Host-cosmora-owner=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/u
  );
  assert.equal((await f.verify(cookie)).status, 204);
  assert.equal((await f.verify(cookie + "; " + cookie)).status, 303);
  assert.equal((await f.verify("__Host-cosmora-owner=" + "0".repeat(64))).status, 303);
  f.advance(8 * 60 * 60 * 1000);
  assert.equal((await f.verify(cookie)).status, 303);
});
test("logout revokes the server-side session and cannot be triggered by a cross-site form", async (t) => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get("set-cookie");
  const rejected = await f.request("/__owner/logout", {
    method: "POST",
    headers: { cookie, origin: "https://other.example" }
  });
  assert.equal(rejected.status, 403);
  assert.equal((await f.verify(cookie)).status, 204);
  const logout = await f.request("/__owner/logout", {
    method: "POST",
    headers: { cookie, origin }
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/u);
  assert.equal((await f.verify(cookie)).status, 303);
});
test("wrong credentials render a safe error; origin and body types cannot bypass login", async (t) => {
  const f = await fixture(t);
  const wrong = await f.login("incorrect");
  assert.equal(wrong.status, 422);
  assert.equal(wrong.headers.get("set-cookie"), null);
  assert.equal(wrong.headers.get("www-authenticate"), null);
  assert.match(await wrong.text(), /Неверный логин/u);
  assert.equal((await f.login(password, { origin: "https://other.example" })).status, 403);
  assert.equal((await f.login(password, { "content-type": "application/json" })).status, 415);
  assert.equal((await f.verify()).status, 303);
});
test("brute-force attempts are bounded and expire without disabling authenticated sessions", async (t) => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get("set-cookie");
  for (let i = 0; i < 9; i++) assert.equal((await f.login("incorrect")).status, 422);
  assert.equal((await f.login()).status, 429);
  assert.equal((await f.verify(cookie)).status, 204);
  f.advance(15 * 60 * 1000);
  assert.equal((await f.login()).status, 303);
});
test("relogin replaces the current session; restarting the service does not revive old cookies", async (t) => {
  const f = await fixture(t);
  const oldCookie = (await f.login()).headers.get("set-cookie");
  const newCookie = (await f.login(password, { cookie: oldCookie })).headers.get("set-cookie");
  assert.equal((await f.verify(oldCookie)).status, 303);
  assert.equal((await f.verify(newCookie)).status, 204);
  const restarted = await fixture(t);
  assert.equal((await restarted.verify(newCookie)).status, 303);
});
test("missing secrets and unsafe origins fail before the service starts", () => {
  assert.throws(() => createOwnerAccess({ origin, passwordHash: "" }), /password hash/u);
  for (const value of [
    "http://cosmora.example",
    "https://owner:secret@cosmora.example",
    "https://cosmora.example/login"
  ])
    assert.throws(() => createOwnerAccess({ origin: value, passwordHash }), /HTTPS origin/u);
});
