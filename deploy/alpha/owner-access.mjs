import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const COOKIE = "__Host-cosmora-owner";
const TTL = 8 * 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const hashOwnerPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 32, scryptOptions).toString("hex")}`;
};
const style = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0e1118;color:#e9edf5;font:16px system-ui,sans-serif;padding:24px}main{width:min(100%,420px);padding:32px;border:1px solid #303847;border-radius:20px;background:#171c26}h1{font-size:26px;margin:0 0 12px}p{color:#b9c3d3;line-height:1.5}label{display:block;margin:20px 0 8px}input,button,a{font:inherit}input{width:100%;padding:12px;border:1px solid #526078;border-radius:10px;background:#0e1118;color:#fff}button,.link{display:block;width:100%;margin-top:24px;padding:12px;border:0;border-radius:10px;background:#b5c9ff;color:#101827;font-weight:650;text-align:center;text-decoration:none;cursor:pointer}.error{color:#ffb4b4}small{display:block;margin-top:24px;color:#a3aec0;line-height:1.5}`;
const page = (message = "", authenticated = false) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход — Cosmora</title><style>${style}</style></head><body><main><h1>Cosmora</h1><p>Личное пространство для работы с ИИ, кодом и проектами.</p>${message ? `<p class="error" role="alert">${message}</p>` : ""}${authenticated ? '<p>Вы вошли как владелец.</p><a class="link" href="/">Открыть Cosmora</a><form method="post" action="/__owner/logout"><button type="submit">Выйти</button></form>' : '<form method="post" action="/__owner/login"><label for="username">Логин</label><input id="username" name="username" value="owner" autocomplete="username" required readonly><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="512" autofocus><button type="submit">Войти в Cosmora</button></form><small>Используйте пароль владельца Cosmora из сохранённых данных входа. Пароль сервера сюда не подходит.</small>'}</main></body></html>`;
const digest = (value) => createHash("sha256").update(value).digest("hex");

export function createOwnerAccess({ origin, passwordHash, now = Date.now }) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.origin !== origin || base.username || base.password)
    throw new Error("Owner origin must be an exact HTTPS origin");
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(passwordHash ?? ""))
    throw new Error("Owner password hash is missing or invalid");
  const [, salt, stored] = passwordHash.split(":");
  const sessions = new Map();
  const attempts = new Map();
  const prune = () => {
    for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key);
    for (const [key, bucket] of attempts) if (bucket.expires <= now()) attempts.delete(key);
  };
  const tokenFor = (request) => {
    const values = (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return null;
    const value = values[0].slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? digest(value) : null;
  };
  const authenticated = (request) => {
    const key = tokenFor(request);
    return key !== null && (sessions.get(key) ?? 0) > now();
  };
  const cookie = (token, seconds) =>
    `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": `default-src 'none'; style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
  };
  const html = (response, status, message = "", loggedIn = false) => {
    response.writeHead(status, { ...headers, "content-type": "text/html; charset=utf-8" });
    response.end(page(message, loggedIn));
  };
  const redirect = (response, location, extra = {}) => {
    response.writeHead(303, { ...headers, location, ...extra });
    response.end();
  };
  const allowedAttempt = (request) => {
    const ip = String(request.headers["x-cosmora-client-ip"] ?? request.socket.remoteAddress).slice(
      0,
      100
    );
    if (attempts.size >= 4096 && !attempts.has(ip)) return false;
    for (const [key, limit] of [
      ["all", 120],
      [ip, 10]
    ]) {
      const bucket = attempts.get(key) ?? { count: 0, expires: now() + WINDOW };
      bucket.count++;
      attempts.set(key, bucket);
      if (bucket.count > limit) return false;
    }
    return true;
  };
  const server = createServer(async (request, response) => {
    prune();
    let path;
    try {
      path = new URL(request.url, "http://owner-access").pathname;
    } catch {
      response.writeHead(400, headers).end();
      return;
    }
    if (path === "/health" && request.method === "GET") {
      response.writeHead(200, { ...headers, "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (path === "/__owner/verify" && request.method === "GET") {
      if (authenticated(request)) {
        response.writeHead(204, headers).end();
      } else if (String(request.headers["x-forwarded-uri"] ?? "").startsWith("/api/")) {
        response.writeHead(401, { ...headers, "content-type": "application/json" });
        response.end('{"error":{"code":"UNAUTHORIZED","message":"Owner login required"}}');
      } else redirect(response, "/login");
      return;
    }
    if (path === "/login" && ["GET", "HEAD"].includes(request.method)) {
      if (request.method === "HEAD") response.writeHead(200, headers).end();
      else html(response, 200, "", authenticated(request));
      return;
    }
    if (["/__owner/login", "/__owner/logout"].includes(path) && request.method === "POST") {
      if (request.headers.origin !== origin) {
        html(response, 403, "Вход разрешён только со страницы Cosmora.");
        return;
      }
      if (path === "/__owner/logout") {
        sessions.delete(tokenFor(request));
        redirect(response, "/login", { "set-cookie": cookie("", 0) });
        return;
      }
      if (!allowedAttempt(request)) {
        response.setHeader("retry-after", "900");
        html(response, 429, "Слишком много попыток входа. Повторите через 15 минут.");
        return;
      }
      if (request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") {
        html(response, 415, "Используйте форму входа Cosmora.");
        return;
      }
      try {
        const chunks = [];
        let length = 0;
        for await (const bytes of request) {
          length += bytes.length;
          if (length > 4096) {
            html(response, 413, "Слишком длинные данные входа.");
            return;
          }
          chunks.push(bytes);
        }
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const password = form.get("password") ?? "";
        if (
          form.getAll("password").length !== 1 ||
          form.getAll("username").length !== 1 ||
          form.get("username") !== "owner" ||
          password.length > 512 ||
          !timingSafeEqual(
            scryptSync(password, salt, 32, scryptOptions),
            Buffer.from(stored, "hex")
          )
        ) {
          html(response, 422, "Неверный логин или пароль владельца Cosmora.");
          return;
        }
        if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
        sessions.delete(tokenFor(request));
        const token = randomBytes(32).toString("hex");
        sessions.set(digest(token), now() + TTL);
        redirect(response, "/", { "set-cookie": cookie(token, TTL / 1000) });
      } catch {
        if (!response.headersSent) html(response, 400, "Не удалось обработать форму входа.");
      }
      return;
    }
    response.writeHead(404, headers).end();
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createOwnerAccess({
    origin: `https://${process.env.COSMORA_DEMO_DOMAIN}`,
    passwordHash: process.env.COSMORA_OWNER_PASSWORD_HASH
  });
  server.listen(3080, "0.0.0.0", () => console.log("Owner form login ready"));
}
