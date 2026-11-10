"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FORBIDDEN_ATTACHMENT_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".ps1", ".psm1", ".bat", ".cmd", ".com",
  ".msi", ".msp", ".lnk", ".scr", ".hta", ".vbs", ".vbe", ".js", ".jse",
  ".cjs", ".mjs", ".wsf", ".wsh", ".reg", ".inf", ".jar", ".pem", ".key",
  ".pfx", ".p12", ".kdbx", ".sqlite", ".sqlite3", ".db", ".db-wal"
]);

const SENSITIVE_FILENAME_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^(credentials|secrets|tokens|passwords|auth)(\..+)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^koswork-workspace-state\.json$/i
];

const FORBIDDEN_DOWNLOAD_EXTENSIONS = new Set([
  ".exe", ".dll", ".ps1", ".bat", ".cmd", ".com", ".msi", ".lnk", ".scr", ".hta", ".vbs", ".reg"
]);

const CAPTCHA_PATTERNS = [
  /\bcaptcha\b/i,
  /\bg-recaptcha\b/i,
  /\bhcaptcha\b/i,
  /\bcf-turnstile\b/i,
  /verify you are human/i,
  /подтвердите,\s*что вы не робот/i,
  /проверка безопасности:\s*капча/i
];

const LOGIN_AND_OAUTH_PATTERNS = [
  /войдите в аккаунт/i,
  /требуется вход/i,
  /sign in to continue/i,
  /log in to continue/i,
  /authentication required/i,
  /двухфакторная аутентификация/i,
  /oauth2?\/authorize/i,
  /saml2?\/sso/i
];

const PAYMENT_AND_EXTERNAL_SEND_PATTERNS = [
  /оплатить заказ/i,
  /введите номер карты/i,
  /card\s*number/i,
  /cvv|cvc/i,
  /confirm\s+payment/i,
  /подтвердить платёж/i,
  /отправить внешнее сообщение/i
];

class KosworkBrowserPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KosworkBrowserPolicyError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Evaluates navigation URL policy, domain allowlist/blocklist, and SSRF protection.
 */
function evaluateNavigationPolicy(rawUrl, options = {}) {
  const allowLocalLoopback = options.allowLocalLoopback !== false;
  const allowedDomains = Array.isArray(options.allowedDomains)
    ? options.allowedDomains.map((d) => String(d).toLowerCase())
    : null;
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    throw new KosworkBrowserPolicyError("BROWSER_INVALID_URL", "URL перехода не может быть пустым.", { rawUrl });
  }

  if (/^koswork:\/\/search\/srch-[a-f0-9]{16}$/i.test(urlText)) {
    return {
      allowed: true,
      normalizedUrl: urlText,
      protocol: "koswork:",
      hostname: "search",
      isInternalReceipt: true
    };
  }

  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    throw new KosworkBrowserPolicyError("BROWSER_INVALID_URL", `Некорректный формат URL: "${urlText}".`, { rawUrl: urlText });
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new KosworkBrowserPolicyError(
      "BROWSER_NAVIGATION_PROTOCOL_FORBIDDEN",
      `Протокол "${protocol}" запрещён. Разрешены только http: и https:.`,
      { url: urlText, protocol }
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "169.254.169.254" ||
    hostname === "metadata.google.internal" ||
    hostname === "100.100.100.200"
  ) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_SSRF_METADATA_BLOCKED",
      `Доступ к облачному сервису метаданных (${hostname}) заблокирован.`,
      { url: urlText, hostname }
    );
  }

  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "corpus.local" ||
    hostname.endsWith(".corpus.local") ||
    hostname.endsWith(".research.local") ||
    hostname.endsWith(".localhost");

  if (isLoopback && !allowLocalLoopback) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_LOOPBACK_DISABLED",
      `Доступ к локальному адресу (${hostname}) отключён в текущем режиме.`,
      { url: urlText, hostname }
    );
  }

  if (allowedDomains && allowedDomains.length > 0 && !isLoopback) {
    const domainPermitted = allowedDomains.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
    if (!domainPermitted) {
      throw new KosworkBrowserPolicyError(
        "BROWSER_DOMAIN_NOT_PERMITTED",
        `Домен "${hostname}" не входит в список разрешённых для текущей исследовательской задачи.`,
        { url: urlText, hostname, allowedDomains }
      );
    }
  }

  return {
    allowed: true,
    normalizedUrl: parsed.toString(),
    protocol,
    hostname,
    isLoopback,
    isInternalReceipt: false
  };
}

/**
 * Verifies that authenticated site tools only use an explicitly authorized session ID.
 */
function verifyAuthorizedSiteSession({
  requiresAuthenticatedSession = false,
  requestedSessionId = null,
  allowedSessionIds = []
} = {}) {
  if (!requiresAuthenticatedSession) {
    return { allowed: true, sessionId: requestedSessionId || null };
  }
  const allowedSet = new Set((allowedSessionIds || []).map((s) => String(s)));
  if (!requestedSessionId || !allowedSet.has(String(requestedSessionId))) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_UNAUTHORIZED_SITE_SESSION",
      "Инструменты сайтов с логином могут использовать только явно разрешённую сессию владельца.",
      { requestedSessionId, allowedSessionIds }
    );
  }
  return { allowed: true, sessionId: String(requestedSessionId) };
}

/**
 * Inspects a snapshot for CAPTCHA, login/OAuth walls, payment checkout, or external send gates.
 * Never bypasses these gates — always pauses for the user (`status: "paused_for_user"`).
 */
function detectAuthOrCaptchaGate(pageSnapshot = {}) {
  const status = Number(pageSnapshot.httpStatus ?? pageSnapshot.status ?? 200);
  const title = String(pageSnapshot.title || "");
  const bodyText = String(pageSnapshot.fullTextUtf16 || pageSnapshot.text || "");
  const html = String(pageSnapshot.html || "");
  const url = String(pageSnapshot.url || "");
  const controls = Array.isArray(pageSnapshot.controls) ? pageSnapshot.controls : [];
  const combinedText = `${title}\n${bodyText}\n${url}`;

  for (const pattern of CAPTCHA_PATTERNS) {
    if (pattern.test(combinedText) || pattern.test(html)) {
      return {
        gated: true,
        gateType: "captcha",
        status: "paused_for_user",
        code: "BROWSER_PAUSED_FOR_CAPTCHA",
        reason: "Обнаружена CAPTCHA. Автоматический обход запрещён; ожидание ручного прохождения пользователем.",
        url: pageSnapshot.url || null
      };
    }
  }

  const hasCaptchaControl = controls.some(
    (c) =>
      String(c.id || "").toLowerCase().includes("captcha") ||
      String(c.name || "").toLowerCase().includes("captcha") ||
      String(c.role || "").toLowerCase() === "captcha"
  );
  if (hasCaptchaControl) {
    return {
      gated: true,
      gateType: "captcha",
      status: "paused_for_user",
      code: "BROWSER_PAUSED_FOR_CAPTCHA",
      reason: "Обнаружен интерактивный элемент CAPTCHA. Требуется действие пользователя.",
      url: pageSnapshot.url || null
    };
  }

  for (const pattern of PAYMENT_AND_EXTERNAL_SEND_PATTERNS) {
    if (pattern.test(combinedText)) {
      return {
        gated: true,
        gateType: "payment_or_send_confirmation",
        status: "paused_for_user",
        code: "BROWSER_PAUSED_FOR_SENSITIVE_GATE",
        reason: "Обнаружена форма платежа или внешней отправки. Автоматическое выполнение запрещено без подтверждения пользователя.",
        url: pageSnapshot.url || null
      };
    }
  }

  const hasPasswordControl = controls.some(
    (c) =>
      String(c.type || "").toLowerCase() === "password" ||
      String(c.name || "").toLowerCase().includes("password") ||
      String(c.id || "").toLowerCase().includes("password")
  );
  const matchesLoginPrompt = LOGIN_AND_OAUTH_PATTERNS.some((p) => p.test(combinedText));

  if (
    hasPasswordControl ||
    (status === 401 && matchesLoginPrompt) ||
    (matchesLoginPrompt && pageSnapshot.requiresLogin === true)
  ) {
    return {
      gated: true,
      gateType: "login_or_oauth_required",
      status: "paused_for_user",
      code: "BROWSER_PAUSED_FOR_LOGIN",
      reason: "Страница требует входа (логин/пароль/OAuth/2FA). Агент поставлен на паузу для пользователя.",
      url: pageSnapshot.url || null
    };
  }

  if (status === 401 || status === 403) {
    return {
      gated: true,
      gateType: "access_restricted",
      status: "paused_for_user",
      code: "BROWSER_ACCESS_RESTRICTED",
      reason: `Доступ к ресурсу ограничен сервером (HTTP ${status}). Обход ограничений доступа запрещён.`,
      httpStatus: status,
      url: pageSnapshot.url || null
    };
  }

  return {
    gated: false,
    gateType: null,
    status: "ok",
    code: null,
    reason: null
  };
}

function verifyFileSelectionPolicy(candidateFilePath, options = {}) {
  const allowedWorkspaceRoot = options.allowedWorkspaceRoot
    ? path.resolve(String(options.allowedWorkspaceRoot))
    : null;
  const maxUploadBytes = Number(options.maxUploadBytes ?? 10 * 1024 * 1024);

  if (!allowedWorkspaceRoot) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_WORKSPACE_NOT_CONNECTED",
      "Выбор файлов невозможен: не подключена разрешённая рабочая папка."
    );
  }

  const rawPath = String(candidateFilePath || "").trim();
  if (!rawPath || rawPath.includes("\0") || rawPath.startsWith("\\\\")) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      "Некорректный или запрещённый путь к прикрепляемому файлу."
    );
  }

  const resolvedCandidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(allowedWorkspaceRoot, rawPath);

  const canonicalRoot = fs.realpathSync(allowedWorkspaceRoot);
  const relativeCheck = path.relative(canonicalRoot, resolvedCandidate);
  if (relativeCheck === "" || relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Запрещено прикреплять файлы вне разрешённой рабочей папки: "${rawPath}".`,
      { candidateFilePath: rawPath }
    );
  }

  const baseName = path.basename(resolvedCandidate);
  for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
    if (pattern.test(baseName)) {
      throw new KosworkBrowserPolicyError(
        "BROWSER_FORBIDDEN_ATTACHMENT",
        `Файл "${baseName}" относится к защищённым данным (.env/ключи/токены) и заблокирован.`,
        { filename: baseName }
      );
    }
  }

  const ext = path.extname(baseName).toLowerCase();
  if (FORBIDDEN_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Расширение "${ext}" файла "${baseName}" запрещено для прикрепления.`,
      { filename: baseName, extension: ext }
    );
  }

  let lstat;
  try {
    lstat = fs.lstatSync(resolvedCandidate);
  } catch {
    throw new KosworkBrowserPolicyError(
      "BROWSER_ATTACHMENT_NOT_FOUND",
      `Файл вложения не найден: "${baseName}".`
    );
  }

  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Символические ссылки и директории ("${baseName}") запрещены.`
    );
  }

  const canonicalFile = fs.realpathSync(resolvedCandidate);
  const canonicalRel = path.relative(canonicalRoot, canonicalFile);
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Канонический путь файла "${baseName}" выходит за пределы рабочей папки.`
    );
  }

  if (lstat.size > maxUploadBytes) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_ATTACHMENT_TOO_LARGE",
      `Размер файла "${baseName}" превышает лимит (${maxUploadBytes} байт).`
    );
  }

  const buffer = fs.readFileSync(canonicalFile);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    allowed: true,
    filename: baseName,
    canonicalPath: canonicalFile,
    relativePath: canonicalRel.replace(/\\/g, "/"),
    sizeBytes: buffer.length,
    sha256
  };
}

function resolveAllowedDownloadTarget(rawFilename, options = {}) {
  const allowedDownloadDir = options.allowedDownloadDir
    ? path.resolve(String(options.allowedDownloadDir))
    : null;
  const allowedWorkspaceRoot = options.allowedWorkspaceRoot
    ? path.resolve(String(options.allowedWorkspaceRoot))
    : null;

  if (!allowedDownloadDir) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_DOWNLOAD_DIR_NOT_CONFIGURED",
      "Не задана разрешённая папка для скачивания файлов."
    );
  }

  if (allowedWorkspaceRoot) {
    const relDir = path.relative(allowedWorkspaceRoot, allowedDownloadDir);
    if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
      throw new KosworkBrowserPolicyError(
        "BROWSER_DOWNLOAD_DIR_OUTSIDE_WORKSPACE",
        "Папка загрузок должна находиться внутри разрешённой рабочей папки."
      );
    }
  }

  const base = path.basename(String(rawFilename || "download.txt").trim());
  const sanitized = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+/, "") || "download.txt";
  const ext = path.extname(sanitized).toLowerCase();

  if (FORBIDDEN_DOWNLOAD_EXTENSIONS.has(ext)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_DOWNLOAD_TYPE",
      `Скачивание исполняемого файла "${sanitized}" (${ext}) заблокировано.`
    );
  }

  fs.mkdirSync(allowedDownloadDir, { recursive: true });
  const targetPath = path.join(allowedDownloadDir, sanitized);
  return {
    allowed: true,
    filename: sanitized,
    downloadDir: allowedDownloadDir,
    targetPath
  };
}

module.exports = {
  FORBIDDEN_ATTACHMENT_EXTENSIONS,
  FORBIDDEN_DOWNLOAD_EXTENSIONS,
  KosworkBrowserPolicyError,
  detectAuthOrCaptchaGate,
  evaluateNavigationPolicy,
  resolveAllowedDownloadTarget,
  verifyAuthorizedSiteSession,
  verifyFileSelectionPolicy
};
