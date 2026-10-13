import { spawn } from "node:child_process";
import type { IdentityStore } from "@cosmora/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  newOAuthTransaction,
  type GoogleIdentity,
  type OAuthTransaction
} from "./google-identity.js";
import { normalizedEmail, type RegistrationStore } from "./registration-store.js";

const SESSION_COOKIE = "__Host-kosmora-session";
const OAUTH_COOKIE = "__Host-kosmora-oauth";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const REMEMBER_TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE_OPTIONS = "Path=/; Secure; HttpOnly; SameSite=Lax";
const noStore = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};
type Form = URLSearchParams;

const formPage = (kind: "login" | "register", message = "", google = false, email = false) => {
  const register = kind === "register";
  const heading = register ? "Регистрация в Kosmora" : "Вход в Kosmora";
  const action = register ? "/auth/register" : "/auth/login";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><style>
    :root{font-family:system-ui,sans-serif;color:#171717;background:#f7f7f7}*{box-sizing:border-box}
    body{min-height:100vh;display:grid;place-items:center;margin:0;padding:20px}main{width:min(100%,420px);background:white;border:1px solid #ddd;border-radius:18px;padding:30px}
    h1{font-size:25px;margin:0 0 12px}p{color:#666;line-height:1.5}label{display:block;margin:18px 0 6px}input{width:100%;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit}
    button,.button{display:block;text-align:center;width:100%;padding:12px;margin:20px 0 0;background:#171717;color:white;border:1px solid #171717;border-radius:8px;font:inherit;text-decoration:none;cursor:pointer}
    .button{background:white;color:#171717;margin-top:10px}.hint{margin-top:22px}a{color:#171717}:focus-visible{outline:2px solid #555;outline-offset:3px}
  </style></head><body><main><h1>${heading}</h1>
  ${message ? `<p role="status">${message}</p>` : ""}
  ${
    email
      ? `<form action="${action}" method="post"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
    <label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="12" maxlength="512" required>
    ${register ? "<p>Минимум 12 символов. Для активации понадобится ссылка из письма.</p>" : '<label><input type="checkbox" name="remember" value="on" style="width:auto"> Запомнить на 30 дней</label>'}
    <button type="submit">${register ? "Создать аккаунт" : "Войти"}</button></form>`
      : "<p>Вход по email пока не настроен.</p>"
  }
  ${google ? '<a class="button" href="/auth/google">Продолжить с Google</a>' : ""}
  <p class="hint">${register ? '<a href="/login">Уже есть аккаунт? Войти</a>' : '<a href="/register">Создать аккаунт</a>'}</p>
  ${!register && email ? '<p><a href="/forgot-password">Забыли пароль?</a></p>' : ""}
  </main></body></html>`;
};
const cookie = (name: string, value: string, seconds: number) =>
  `${name}=${value}; ${COOKIE_OPTIONS}; Max-Age=${seconds}`;
const readCookie = (request: FastifyRequest, name: string): string | null => {
  const values = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : null;
};

export interface RegistrationOptions {
  origin: string;
  store: RegistrationStore;
  identity: IdentityStore;
  google?: GoogleIdentity;
  sendVerification?: (email: string, link: string) => Promise<void>;
  sendPasswordReset?: (email: string, link: string) => Promise<void>;
  sendEmailChange?: (email: string, link: string) => Promise<void>;
}

export const sendWithLocalMta = (
  executable: string,
  from: string,
  purpose: "verify" | "reset" | "email-change" = "verify"
) => {
  const sender = normalizedEmail(from);
  if (!executable.startsWith("/") || !sender) throw Error("Mail delivery is not configured");
  return (to: string, link: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const recipient = normalizedEmail(to);
      if (!recipient) return reject(Error("INVALID_RECIPIENT"));
      const child = spawn(executable, ["-t", "-i"], { stdio: ["pipe", "ignore", "ignore"] });
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.stdin.on("error", () => undefined);
      child.once("error", (cause) => {
        clearTimeout(timer);
        reject(cause);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Error("MAIL_DELIVERY_FAILED"));
      });
      child.stdin.end(
        `From: ${sender}\r\nTo: ${recipient}\r\nSubject: Kosmora: ${purpose === "reset" ? "reset your password" : purpose === "email-change" ? "confirm your new email" : "confirm your email"}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${purpose === "reset" ? "Сбросьте пароль Kosmora" : purpose === "email-change" ? "Подтвердите новый адрес email в Kosmora" : "Подтвердите адрес email в Kosmora"}: ${link}\r\nСсылка действует 30 минут.\r\n`
      );
    });
};

export function registerRegistrationRoutes(
  app: FastifyInstance,
  options: RegistrationOptions
): void {
  if (new URL(options.origin).origin !== options.origin || !options.origin.startsWith("https://"))
    throw Error("Registration requires an exact HTTPS origin");
  const buckets = new Map<string, { count: number; until: number }>();
  const allowed = (request: FastifyRequest) => {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const ip =
      typeof request.headers["x-kosmora-client-ip"] === "string"
        ? request.headers["x-kosmora-client-ip"].slice(0, 100)
        : request.ip;
    if (buckets.size >= 4096 && !buckets.has(ip)) return false;
    let permitted = true;
    for (const [key, limit] of [
      ["all", 120],
      [ip, 10]
    ] as const) {
      const current = buckets.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 };
      current.count++;
      buckets.set(key, current);
      if (current.count > limit) permitted = false;
    }
    return permitted;
  };
  const ownOrigin = (request: FastifyRequest) => request.headers.origin === options.origin;
  const redirect = (reply: FastifyReply, destination: string, cookies?: string | string[]) =>
    reply
      .code(303)
      .header("location", destination)
      .header("set-cookie", cookies ?? [])
      .send();
  const session = (ownerId: string, remember = false) => {
    const ttl = remember ? REMEMBER_TTL : SESSION_TTL;
    const issued = options.identity.issueSession({
      ownerId,
      actorId: ownerId,
      assurance: "single_factor",
      ttlMs: ttl
    });
    return cookie(SESSION_COOKIE, issued.token, ttl / 1000);
  };
  const publicHeaders = {
    ...noStore,
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  };
  const account = (request: FastifyRequest) => {
    const token = readCookie(request, SESSION_COOKIE);
    const current = token ? options.identity.resolveSession(token) : null;
    return current?.actor_kind === "owner" ? current : null;
  };
  const revoke = (ownerId: string, reason: string) =>
    options.identity.revokeAllOwnerSessions(ownerId, ownerId, reason);
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 4096 },
    (_request, body, done) => {
      done(null, new URLSearchParams(body as string));
    }
  );
  app.get<{ Querystring: { error?: string } }>("/login", async (request, reply) =>
    reply
      .headers(publicHeaders)
      .type("text/html")
      .send(
        formPage(
          "login",
          request.query.error === "google"
            ? "Не удалось войти через Google. Попробуйте ещё раз."
            : "",
          Boolean(options.google),
          Boolean(options.sendVerification)
        )
      )
  );
  app.get("/register", async (_request, reply) =>
    reply
      .headers(publicHeaders)
      .type("text/html")
      .send(formPage("register", "", Boolean(options.google), Boolean(options.sendVerification)))
  );
  app.get("/forgot-password", async (_request, reply) => {
    if (!options.sendPasswordReset) return reply.code(404).send();
    return reply.headers(publicHeaders).type("text/html")
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Восстановление Kosmora</title>
      <main><h1>Восстановление пароля</h1><form method="post" action="/auth/recovery/request">
      <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required>
      <button type="submit">Отправить ссылку</button></form><p><a href="/login">Вход</a></p></main></html>`);
  });
  app.post("/auth/recovery/request", async (request, reply) => {
    if (!options.sendPasswordReset) return reply.code(404).send();
    if (!ownOrigin(request)) return reply.code(403).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (!(form instanceof URLSearchParams) || form.getAll("email").length !== 1)
      return reply.code(400).send();
    const email = normalizedEmail(form.get("email") ?? "");
    if (!email) return reply.code(400).send();
    try {
      const token = options.store.requestPasswordReset(email);
      if (token)
        await options.sendPasswordReset(
          email,
          `${options.origin}/auth/recovery/reset?token=${encodeURIComponent(token)}`
        );
    } catch (cause) {
      request.log.error({ cause }, "Password reset delivery failed");
    }
    return reply.headers(publicHeaders).type("text/html")
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверьте почту</title>
      <main><h1>Проверьте почту</h1><p>Если этот адрес привязан к аккаунту, мы отправили ссылку для смены пароля.</p>
      <p><a href="/login">Вход</a></p></main></html>`);
  });
  app.get<{ Querystring: { token?: string } }>("/auth/recovery/reset", async (request, reply) => {
    if (!options.sendPasswordReset) return reply.code(404).send();
    const token = request.query.token ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return reply.code(400).send();
    return reply.headers(publicHeaders).type("text/html")
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Новый пароль Kosmora</title>
      <main><h1>Новый пароль</h1><form method="post" action="/auth/recovery/reset">
      <input type="hidden" name="token" value="${token}"><label for="password">Новый пароль</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="512" required>
      <button type="submit">Сменить пароль</button></form></main></html>`);
  });
  app.post("/auth/recovery/reset", async (request, reply) => {
    if (!options.sendPasswordReset) return reply.code(404).send();
    if (!ownOrigin(request)) return reply.code(403).send();
    const form = request.body as Form;
    if (
      !(form instanceof URLSearchParams) ||
      form.getAll("token").length !== 1 ||
      form.getAll("password").length !== 1
    )
      return reply.code(400).send();
    try {
      if (
        !options.store.resetPassword(
          form.get("token") ?? "",
          form.get("password") ?? "",
          (ownerId) => revoke(ownerId, "password_reset")
        )
      )
        return reply
          .code(400)
          .headers(publicHeaders)
          .send("Ссылка недействительна или срок её действия истёк.");
      return redirect(reply, "/login?reset=1", cookie(SESSION_COOKIE, "", 0));
    } catch (cause) {
      if (cause instanceof Error && cause.message === "INVALID_PASSWORD")
        return reply.code(400).send("Пароль должен содержать от 12 до 512 символов.");
      throw cause;
    }
  });
  app.post("/auth/register", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (
      !options.sendVerification ||
      !(form instanceof URLSearchParams) ||
      form.getAll("email").length !== 1 ||
      form.getAll("password").length !== 1
    )
      return reply.code(400).send();
    const email = normalizedEmail(form.get("email") ?? "");
    if (!email) return reply.code(400).send();
    try {
      const token = options.store.requestEmailVerification(email, form.get("password") ?? "");
      if (token) {
        const link = `${options.origin}/auth/confirm?token=${encodeURIComponent(token)}`;
        await options.sendVerification(email, link);
      }
      return reply
        .headers(publicHeaders)
        .type("text/html")
        .send(
          formPage(
            "login",
            "Если адрес доступен для регистрации, мы отправили ссылку подтверждения.",
            Boolean(options.google),
            true
          )
        );
    } catch (cause) {
      if (cause instanceof Error && cause.message === "INVALID_PASSWORD")
        return reply.code(400).send("Пароль должен содержать от 12 до 512 символов.");
      request.log.error({ cause }, "Email registration failed");
      return reply.code(503).send("Не удалось отправить подтверждение.");
    }
  });
  app.get<{ Querystring: { token?: string } }>("/auth/confirm", async (request, reply) => {
    const token = request.query.token ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return reply.code(400).send();
    return reply
      .headers(publicHeaders)
      .type("text/html")
      .send(
        `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Подтверждение Kosmora</title>
       <main><h1>Подтвердить адрес email</h1><form method="post" action="/auth/confirm">
       <input type="hidden" name="token" value="${token}"><button type="submit">Подтвердить и войти</button>
       </form></main></html>`
      );
  });
  app.post("/auth/confirm", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    const form = request.body as Form;
    const ownerId =
      form instanceof URLSearchParams && form.getAll("token").length === 1
        ? options.store.confirmEmail(form.get("token") ?? "")
        : null;
    if (!ownerId)
      return reply
        .code(400)
        .headers(publicHeaders)
        .type("text/html")
        .send(
          formPage(
            "register",
            "Ссылка недействительна или срок её действия истёк.",
            Boolean(options.google),
            Boolean(options.sendVerification)
          )
        );
    return redirect(reply, "/", session(ownerId));
  });
  app.post("/auth/login", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (
      !(form instanceof URLSearchParams) ||
      form.getAll("email").length !== 1 ||
      form.getAll("password").length !== 1 ||
      form.getAll("remember").length > 1 ||
      (form.has("remember") && form.get("remember") !== "on")
    )
      return reply.code(400).send();
    const ownerId = options.store.authenticateEmail(
      form.get("email") ?? "",
      form.get("password") ?? ""
    );
    if (!ownerId)
      return reply
        .code(401)
        .headers(publicHeaders)
        .type("text/html")
        .send(
          formPage(
            "login",
            "Не удалось войти. Проверьте данные и подтверждение адреса.",
            Boolean(options.google),
            Boolean(options.sendVerification)
          )
        );
    return redirect(reply, "/", session(ownerId, form.get("remember") === "on"));
  });
  app.get("/auth/google", async (_request, reply) => {
    if (!options.google) return reply.code(404).send();
    const transaction = newOAuthTransaction();
    return redirect(
      reply,
      options.google.authorizationUrl(transaction),
      cookie(OAUTH_COOKIE, Buffer.from(JSON.stringify(transaction)).toString("base64url"), 600)
    );
  });
  app.get("/auth/google/link", async (request, reply) => {
    if (!options.google) return reply.code(404).send();
    const token = readCookie(request, SESSION_COOKIE);
    const current = token ? options.identity.resolveSession(token) : null;
    if (!current || current.actor_kind !== "owner") return redirect(reply, "/login");
    const transaction = { ...newOAuthTransaction(), ownerId: current.owner_id };
    return redirect(
      reply,
      options.google.authorizationUrl(transaction),
      cookie(OAUTH_COOKIE, Buffer.from(JSON.stringify(transaction)).toString("base64url"), 600)
    );
  });
  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
      reply.header("set-cookie", cookie(OAUTH_COOKIE, "", 0));
      try {
        const raw = readCookie(request, OAUTH_COOKIE);
        if (!raw || raw.length > 1000 || !options.google) throw Error("OAUTH_STATE");
        const transaction = JSON.parse(
          Buffer.from(raw, "base64url").toString("utf8")
        ) as OAuthTransaction & { ownerId?: string };
        if (
          !transaction.state ||
          request.query.state !== transaction.state ||
          !Number.isFinite(transaction.at) ||
          Date.now() - transaction.at > 600_000
        )
          throw Error("OAUTH_STATE");
        const profile = await options.google.exchange(request.query.code ?? "", transaction);
        if (transaction.ownerId) {
          const token = readCookie(request, SESSION_COOKIE);
          const current = token ? options.identity.resolveSession(token) : null;
          if (
            !current ||
            current.owner_id !== transaction.ownerId ||
            !options.store.linkGoogle(current.owner_id, profile.subject)
          )
            throw Error("ACCOUNT_LINK_FAILED");
          return redirect(reply, "/auth/account?linked=1", cookie(OAUTH_COOKIE, "", 0));
        }
        const ownerId = options.store.authenticateGoogle(profile.email, profile.subject);
        if (!ownerId) throw Error("ACCOUNT_CONFLICT");
        return redirect(reply, "/", [cookie(OAUTH_COOKIE, "", 0), session(ownerId)]);
      } catch {
        return redirect(reply, "/login?error=google", cookie(OAUTH_COOKIE, "", 0));
      }
    }
  );
  app.get("/auth/account", async (request, reply) => {
    const token = readCookie(request, SESSION_COOKIE);
    const current = token ? options.identity.resolveSession(token) : null;
    if (!current || current.actor_kind !== "owner") return redirect(reply, "/login");
    const methods = options.store.methods(current.owner_id);
    if (!methods) return reply.code(403).send();
    return reply.headers(publicHeaders).type("text/html")
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Аккаунт Kosmora</title>
      <main><h1>Аккаунт Kosmora</h1><p>Ваши данные доступны только в этой учётной записи.</p>
      ${options.google && !methods.google ? '<a href="/auth/google/link">Привязать Google</a>' : ""}
      ${!methods.email ? '<form action="/auth/account/email" method="post"><label for="new-password">Добавить вход по email</label><input id="new-password" name="password" type="password" minlength="12" maxlength="512" required><button type="submit">Сохранить пароль</button></form>' : ""}
      ${methods.email ? '<form action="/auth/account/password" method="post"><h2>Сменить пароль</h2><label for="current-password">Текущий пароль</label><input id="current-password" name="current" type="password" autocomplete="current-password" required><label for="changed-password">Новый пароль</label><input id="changed-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="512" required><button type="submit">Сменить пароль и завершить старые сеансы</button></form>' : ""}
      ${methods.email && options.sendEmailChange ? '<form action="/auth/account/email-change/request" method="post"><h2>Сменить email</h2><label for="new-email">Новый email</label><input id="new-email" name="email" type="email" autocomplete="email" maxlength="254" required><label for="email-change-password">Текущий пароль</label><input id="email-change-password" name="password" type="password" autocomplete="current-password" required><button type="submit">Отправить подтверждение</button></form>' : ""}
      ${methods.email && methods.google ? '<form action="/auth/account/method/remove" method="post"><h2>Способы входа</h2><label for="method">Отключить способ входа</label><select id="method" name="method"><option value="google">Google</option><option value="email">Пароль</option></select><label for="proof-password">Текущий пароль для подтверждения</label><input id="proof-password" name="password" type="password" autocomplete="current-password" required><button type="submit">Отключить и завершить старые сеансы</button></form>' : ""}
      <p><a href="/auth/account/sessions">Активные сеансы</a></p>
      <p><a href="/auth/account/activity">Активность доступа</a></p>
      <p><a href="/">Вернуться в Kosmora</a></p>
      <form action="/auth/logout" method="post"><button type="submit">Выйти</button></form></main></html>`);
  });
  app.get("/auth/account/activity", async (request, reply) => {
    const current = account(request);
    if (!current) return redirect(reply, "/login");
    const labels: Record<string, string> = {
      "session.issued": "Вход выполнен",
      "session.revoked": "Сеанс завершён",
      "session.expired": "Срок сеанса истёк"
    };
    const events = options.identity.listRecentOwnerSessionEvents(
      current.owner_id,
      current.actor_id,
      50
    );
    const rows = events
      .map((item) => {
        const at = new Date(item.created_at).toLocaleString("ru-RU", { timeZone: "UTC" });
        return `<li><strong>${labels[item.event_type]}</strong><span>${at} UTC</span></li>`;
      })
      .join("");
    return reply.headers(publicHeaders).type("text/html")
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Активность доступа Kosmora</title><style>
      :root{font-family:system-ui,sans-serif;color:#171717;background:#f7f7f7}*{box-sizing:border-box}
      body{margin:0;padding:24px}main{width:min(100%,740px);margin:0 auto;padding:24px;background:#fff;border:1px solid #ddd;border-radius:16px}
      ul{list-style:none;padding:0}li{border-top:1px solid #ddd;padding:14px 0;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
      p,span{color:#666;line-height:1.5}a{color:#171717}:focus-visible{outline:2px solid #555;outline-offset:3px}</style>
      <main><h1>Активность доступа</h1><p>Последние 50 событий входа и сеансов вашего аккаунта, время UTC. Здесь нет истории неудачных попыток входа.</p>
      ${rows ? `<ul>${rows}</ul>` : "<p>Событий пока нет.</p>"}<p><a href="/auth/account">Вернуться к аккаунту</a></p></main></html>`);
  });
  app.post("/auth/account/email-change/request", async (request, reply) => {
    if (!options.sendEmailChange) return reply.code(404).send();
    if (!ownOrigin(request)) return reply.code(403).send();
    const current = account(request);
    if (!current) return reply.code(401).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (
      !(form instanceof URLSearchParams) ||
      form.getAll("email").length !== 1 ||
      form.getAll("password").length !== 1
    )
      return reply.code(400).send();
    const email = normalizedEmail(form.get("email") ?? "");
    if (!email) return reply.code(400).send();
    try {
      const token = options.store.requestEmailChange(
        current.owner_id,
        form.get("password") ?? "",
        email
      );
      if (token)
        await options.sendEmailChange(
          email,
          `${options.origin}/auth/account/email-change/confirm?token=${encodeURIComponent(token)}`
        );
    } catch (cause) {
      request.log.error({ cause }, "Email change request failed");
      return reply.code(503).send("Не удалось отправить подтверждение.");
    }
    return reply
      .headers(publicHeaders)
      .type("text/html")
      .send(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверьте почту</title><main><h1>Проверьте почту</h1><p>Если данные верны и адрес свободен, мы отправили ссылку подтверждения. Старый адрес действует до подтверждения.</p><a href="/auth/account">К аккаунту</a></main></html>'
      );
  });
  app.get<{ Querystring: { token?: string } }>(
    "/auth/account/email-change/confirm",
    async (request, reply) => {
      if (!options.sendEmailChange) return reply.code(404).send();
      const token = request.query.token ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return reply.code(400).send();
      return reply
        .headers(publicHeaders)
        .type("text/html")
        .send(
          `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Подтвердить новый email</title><main><h1>Подтвердить новый email</h1><p>После подтверждения все сеансы завершатся, затем войдите с новым адресом.</p><form method="post" action="/auth/account/email-change/confirm"><input type="hidden" name="token" value="${token}"><button type="submit">Подтвердить адрес</button></form></main></html>`
        );
    }
  );
  app.post("/auth/account/email-change/confirm", async (request, reply) => {
    if (!options.sendEmailChange) return reply.code(404).send();
    if (!ownOrigin(request)) return reply.code(403).send();
    const form = request.body as Form;
    if (!(form instanceof URLSearchParams) || form.getAll("token").length !== 1)
      return reply.code(400).send();
    if (
      !options.store.confirmEmailChange(form.get("token") ?? "", (ownerId) =>
        revoke(ownerId, "email_changed")
      )
    )
      return reply
        .code(400)
        .headers(publicHeaders)
        .send("Ссылка недействительна или срок её действия истёк.");
    return redirect(reply, "/login?email=changed", cookie(SESSION_COOKIE, "", 0));
  });
  app.get("/auth/account/sessions", async (request, reply) => {
    const current = account(request);
    if (!current) return redirect(reply, "/login");
    const active = options.identity
      .listSessions(current.owner_id)
      .filter((item) => item.actor_id === current.actor_id && item.status === "active");
    const rows = active
      .map((item) => {
        const currentSession = item.session_id === current.session_id;
        const issued = new Date(item.issued_at).toLocaleString("ru-RU", { timeZone: "UTC" });
        const seen = new Date(item.last_seen_at).toLocaleString("ru-RU", { timeZone: "UTC" });
        const expires = new Date(item.expires_at).toLocaleString("ru-RU", { timeZone: "UTC" });
        return `<li><strong>${currentSession ? "Этот сеанс" : "Другой сеанс"}</strong>
        <p>Начат: ${issued} UTC · Последняя активность: ${seen} UTC · Истекает: ${expires} UTC</p>
        ${currentSession ? "" : `<form method="post" action="/auth/account/sessions/revoke"><input type="hidden" name="session_id" value="${item.session_id}"><button type="submit">Завершить этот сеанс</button></form>`}</li>`;
      })
      .join("");
    return reply.headers(publicHeaders).type("text/html")
      .send(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сеансы Kosmora</title><style>
      :root{font-family:system-ui,sans-serif;color:#171717;background:#f7f7f7}*{box-sizing:border-box}
      body{margin:0;padding:24px}main{width:min(100%,740px);margin:0 auto;padding:24px;background:#fff;border:1px solid #ddd;border-radius:16px}
      ul{list-style:none;padding:0}li{border-top:1px solid #ddd;padding:18px 0}p{color:#666;line-height:1.5}
      button{padding:9px 14px;background:#171717;color:#fff;border:0;border-radius:7px;font:inherit;cursor:pointer}
      a{color:#171717}:focus-visible{outline:2px solid #555;outline-offset:3px}</style>
      <main><h1>Активные сеансы</h1><p>Показаны сеансы входа вашего аккаунта. Время указано в UTC.</p>
      <ul>${rows}</ul>${active.length > 1 ? '<form method="post" action="/auth/account/sessions/revoke"><input type="hidden" name="all_others" value="1"><button type="submit">Завершить все другие сеансы</button></form>' : ""}
      <p><a href="/auth/account">Вернуться к аккаунту</a></p></main></html>`);
  });
  app.post("/auth/account/sessions/revoke", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    const current = account(request);
    if (!current) return reply.code(401).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (!(form instanceof URLSearchParams)) return reply.code(400).send();
    const one = form.getAll("session_id"),
      all = form.getAll("all_others");
    if (!(
      (one.length === 1 && all.length === 0 && /^[0-9a-f-]{36}$/u.test(one[0]!)) ||
      (one.length === 0 && all.length === 1 && all[0] === "1")
    ))
      return reply.code(400).send();
    const candidates = options.identity
      .listSessions(current.owner_id)
      .filter(
        (item) =>
          item.actor_id === current.actor_id &&
          item.status === "active" &&
          item.session_id !== current.session_id
      );
    if (one.length === 1 && !candidates.some((item) => item.session_id === one[0]))
      return reply.code(404).send();
    for (const candidate of candidates) {
      if (one.length === 1 && candidate.session_id !== one[0]) continue;
      options.identity.revokeSession(
        candidate.session_id,
        current.owner_id,
        current.actor_id,
        "owner_session_management"
      );
    }
    return redirect(reply, "/auth/account/sessions");
  });
  app.post("/auth/account/password", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    const current = account(request);
    if (!current) return reply.code(401).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (
      !(form instanceof URLSearchParams) ||
      form.getAll("current").length !== 1 ||
      form.getAll("password").length !== 1
    )
      return reply.code(400).send();
    try {
      if (
        !options.store.changePassword(
          current.owner_id,
          form.get("current") ?? "",
          form.get("password") ?? "",
          (ownerId) => revoke(ownerId, "password_changed")
        )
      )
        return reply.code(401).send("Неверный текущий пароль.");
      return redirect(reply, "/login?changed=1", cookie(SESSION_COOKIE, "", 0));
    } catch (cause) {
      if (cause instanceof Error && cause.message === "INVALID_PASSWORD")
        return reply.code(400).send("Пароль должен содержать от 12 до 512 символов.");
      throw cause;
    }
  });
  app.post("/auth/account/method/remove", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    const current = account(request);
    if (!current) return reply.code(401).send();
    if (!allowed(request)) return reply.code(429).header("retry-after", "900").send();
    const form = request.body as Form;
    if (
      !(form instanceof URLSearchParams) ||
      form.getAll("method").length !== 1 ||
      form.getAll("password").length !== 1
    )
      return reply.code(400).send();
    const method = form.get("method");
    if (method !== "email" && method !== "google") return reply.code(400).send();
    if (
      !options.store.removeMethod(current.owner_id, method, form.get("password") ?? "", (ownerId) =>
        revoke(ownerId, "login_method_removed")
      )
    )
      return reply.code(409).send("Проверьте пароль и наличие второго способа входа.");
    return redirect(reply, "/login?method=removed", cookie(SESSION_COOKIE, "", 0));
  });
  app.post("/auth/account/email", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    const token = readCookie(request, SESSION_COOKIE);
    const current = token ? options.identity.resolveSession(token) : null;
    const form = request.body as Form;
    if (!current || current.actor_kind !== "owner") return reply.code(401).send();
    if (!(form instanceof URLSearchParams) || form.getAll("password").length !== 1)
      return reply.code(400).send();
    try {
      if (!options.store.addPassword(current.owner_id, form.get("password") ?? ""))
        return reply.code(409).send("Вход по email уже настроен.");
      return redirect(reply, "/auth/account?email=1");
    } catch {
      return reply.code(400).send("Пароль должен содержать от 12 до 512 символов.");
    }
  });
  app.post("/auth/logout", async (request, reply) => {
    if (!ownOrigin(request)) return reply.code(403).send();
    const token = readCookie(request, SESSION_COOKIE);
    const current = token ? options.identity.resolveSession(token) : null;
    if (current)
      options.identity.revokeSession(
        current.session_id,
        current.owner_id,
        current.actor_id,
        "owner_logout"
      );
    return redirect(reply, "/login", cookie(SESSION_COOKIE, "", 0));
  });
  app.get("/auth/verify", async (request, reply) => {
    const method = String(request.headers["x-forwarded-method"] ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !ownOrigin(request))
      return reply.code(403).headers(noStore).send();
    const token = readCookie(request, SESSION_COOKIE);
    const identity = token ? options.identity.resolveSession(token) : null;
    if (!identity || identity.actor_kind !== "owner") {
      if (String(request.headers["x-forwarded-uri"] ?? "").startsWith("/api/"))
        return reply
          .code(401)
          .headers(noStore)
          .send({ error: { code: "UNAUTHORIZED" } });
      return redirect(reply, "/login");
    }
    return reply
      .code(204)
      .headers({ ...noStore, "x-kosmora-authorization": `Bearer ${token}` })
      .send();
  });
}
