"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FORBIDDEN_ATTACHMENT_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".ps1",
  ".psm1",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".msp",
  ".lnk",
  ".scr",
  ".hta",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".cjs",
  ".mjs",
  ".wsf",
  ".wsh",
  ".reg",
  ".inf",
  ".jar",
  ".pem",
  ".key",
  ".pfx",
  ".p12",
  ".kdbx",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".db-wal"
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
  ".exe",
  ".dll",
  ".ps1",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".lnk",
  ".scr",
  ".hta",
  ".vbs",
  ".reg"
]);

const CAPTCHA_PATTERNS = [
  /\bcaptcha\b/i,
  /\bg-recaptcha\b/i,
  /\bhcaptcha\b/i,
  /\bcf-turnstile\b/i,
  /verify you are human/i,
  /are you a robot/i,
  /подтвердите,\s*что вы не робот/i,
  /проверка безопасности:\s*капча/i
];

const LOGIN_WALL_PATTERNS = [
  /войдите в аккаунт/i,
  /требуется вход/i,
  /sign in to continue/i,
  /log in to continue/i,
  /authentication required/i,
  /двухфакторная аутентификация/i,
  /two-factor authentication/i
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
 * Evaluates whether a target URL is permitted for navigation inside the Koswork Browser.
 */
function evaluateNavigationPolicy(rawUrl, options = {}) {
  const allowLocalLoopback = options.allowLocalLoopback !== false;
  const urlText = String(rawUrl || "").trim();
  if (!urlText) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_INVALID_URL",
      "URL перехода не может быть пустым.",
      { rawUrl }
    );
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
    throw new KosworkBrowserPolicyError(
      "BROWSER_INVALID_URL",
      `Некорректный формат URL: "${urlText}".`,
      { rawUrl: urlText }
    );
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new KosworkBrowserPolicyError(
      "BROWSER_NAVIGATION_PROTOCOL_FORBIDDEN",
      `Протокол "${protocol}" запрещён в браузере Koswork. Разрешены только http: и https:.`,
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
      `Доступ к облачному сервису метаданных (${hostname}) заблокирован политикой безопасности.`,
      { url: urlText, hostname }
    );
  }

  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost");

  if (isLoopback && !allowLocalLoopback) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_LOOPBACK_DISABLED",
      `Доступ к локальному адресу (${hostname}) отключён в текущем режиме.`,
      { url: urlText, hostname }
    );
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
 * Inspects a page snapshot or DOM state for CAPTCHA challenges, login walls, or HTTP 401/403 gates.
 * When detected, the browser engine MUST pause for the user rather than attempting to bypass access restrictions.
 */
function detectAuthOrCaptchaGate(pageSnapshot = {}) {
  const status = Number(pageSnapshot.httpStatus ?? pageSnapshot.status ?? 200);
  const title = String(pageSnapshot.title || "");
  const bodyText = String(pageSnapshot.fullTextUtf16 || pageSnapshot.text || "");
  const html = String(pageSnapshot.html || "");
  const controls = Array.isArray(pageSnapshot.controls) ? pageSnapshot.controls : [];

  const combinedText = `${title}\n${bodyText}`;

  for (const pattern of CAPTCHA_PATTERNS) {
    if (pattern.test(combinedText) || pattern.test(html)) {
      return {
        gated: true,
        gateType: "captcha",
        status: "paused_for_user",
        code: "BROWSER_PAUSED_FOR_CAPTCHA",
        reason: "На странице обнаружена проверка CAPTCHA. Автоматический обход запрещён; ожидание ручного прохождения пользователем.",
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

  const matchesLoginPrompt = LOGIN_WALL_PATTERNS.some((p) => p.test(combinedText));
  if (hasPasswordControl || (status === 401 && matchesLoginPrompt) || (matchesLoginPrompt && pageSnapshot.requiresLogin === true)) {
    return {
      gated: true,
      gateType: "login_required",
      status: "paused_for_user",
      code: "BROWSER_PAUSED_FOR_LOGIN",
      reason: "Страница требует входа в учётную запись (логин/пароль или 2FA). Агент поставлен на паузу для ручного ввода пользователем.",
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

/**
 * Verifies whether a local file may be attached to a browser `<input type="file">` control.
 * Never widens file permissions outside `allowedWorkspaceRoot` and blocks sensitive or executable files.
 */
function verifyFileSelectionPolicy(candidateFilePath, options = {}) {
  const allowedWorkspaceRoot = options.allowedWorkspaceRoot
    ? path.resolve(String(options.allowedWorkspaceRoot))
    : null;
  const maxUploadBytes = Number(options.maxUploadBytes ?? 10 * 1024 * 1024);

  if (!allowedWorkspaceRoot) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_WORKSPACE_NOT_CONNECTED",
      "Выбор файлов для загрузки невозможен: не подключена разрешённая рабочая папка Koswork."
    );
  }

  const rawPath = String(candidateFilePath || "").trim();
  if (!rawPath) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      "Не указан путь к прикрепляемому файлу."
    );
  }

  if (rawPath.includes("\0") || rawPath.startsWith("\\\\")) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      "Сетевые пути UNC и нулевые байты в имени вложения запрещены.",
      { candidateFilePath: rawPath }
    );
  }

  const resolvedCandidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(allowedWorkspaceRoot, rawPath);

  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync(allowedWorkspaceRoot);
  } catch {
    throw new KosworkBrowserPolicyError(
      "BROWSER_WORKSPACE_NOT_CONNECTED",
      "Разрешённая рабочая папка недоступна на диске."
    );
  }

  const relativeCheck = path.relative(canonicalRoot, resolvedCandidate);
  if (
    relativeCheck === "" ||
    relativeCheck.startsWith("..") ||
    path.isAbsolute(relativeCheck)
  ) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Запрещено прикреплять файлы за пределами разрешённой рабочей папки: "${rawPath}".`,
      { candidateFilePath: rawPath, allowedWorkspaceRoot: canonicalRoot }
    );
  }

  const baseName = path.basename(resolvedCandidate);
  if (baseName.includes(":")) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Обнаружен альтернативный поток NTFS (ADS) в имени файла "${baseName}".`,
      { filename: baseName }
    );
  }

  for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
    if (pattern.test(baseName)) {
      throw new KosworkBrowserPolicyError(
        "BROWSER_FORBIDDEN_ATTACHMENT",
        `Файл "${baseName}" относится к защищённым учётным данным или конфигурации (.env/ключи/токены) и не может быть отправлен на внешний сайт.`,
        { filename: baseName, reason: "sensitive_filename" }
      );
    }
  }

  const ext = path.extname(baseName).toLowerCase();
  if (FORBIDDEN_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Расширение "${ext}" файла "${baseName}" запрещено для загрузки в браузер.`,
      { filename: baseName, extension: ext, reason: "forbidden_extension" }
    );
  }

  let lstat;
  try {
    lstat = fs.lstatSync(resolvedCandidate);
  } catch {
    throw new KosworkBrowserPolicyError(
      "BROWSER_ATTACHMENT_NOT_FOUND",
      `Файл вложения не найден: "${baseName}".`,
      { candidateFilePath: rawPath }
    );
  }

  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Символические ссылки и директории ("${baseName}") не могут быть прикреплены в форму.`,
      { filename: baseName, reason: "symlink_or_directory" }
    );
  }

  const canonicalFile = fs.realpathSync(resolvedCandidate);
  const canonicalRel = path.relative(canonicalRoot, canonicalFile);
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_ATTACHMENT",
      `Канонический путь файла "${baseName}" выходит за пределы разрешённой рабочей папки.`,
      { filename: baseName }
    );
  }

  if (lstat.size > maxUploadBytes) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_ATTACHMENT_TOO_LARGE",
      `Размер файла "${baseName}" (${lstat.size} байт) превышает лимит загрузки (${maxUploadBytes} байт).`,
      { filename: baseName, sizeBytes: lstat.size, maxUploadBytes }
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

/**
 * Validates and resolves a safe download target strictly inside the allowed workspace download folder.
 */
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
        "Папка загрузок должна находиться внутри подключённой рабочей папки Koswork.",
        { allowedDownloadDir, allowedWorkspaceRoot }
      );
    }
  }

  const base = path.basename(String(rawFilename || "download.txt").trim());
  const sanitized = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+/, "") || "download.txt";
  const ext = path.extname(sanitized).toLowerCase();

  if (FORBIDDEN_DOWNLOAD_EXTENSIONS.has(ext)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_FORBIDDEN_DOWNLOAD_TYPE",
      `Скачивание исполняемого файла "${sanitized}" (${ext}) заблокировано политикой безопасности.`,
      { filename: sanitized, extension: ext }
    );
  }

  fs.mkdirSync(allowedDownloadDir, { recursive: true });
  const targetPath = path.join(allowedDownloadDir, sanitized);
  const verifyRel = path.relative(allowedDownloadDir, targetPath);
  if (verifyRel.startsWith("..") || path.isAbsolute(verifyRel)) {
    throw new KosworkBrowserPolicyError(
      "BROWSER_DOWNLOAD_PATH_TRAVERSAL",
      "Обнаружена попытка выхода за пределы разрешённой папки скачивания."
    );
  }

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
  verifyFileSelectionPolicy
};
