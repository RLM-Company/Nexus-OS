"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ERROR_CODES, KosworkWorkspaceError, throwIfAborted } = require("./errors.cjs");

const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const PROTECTED_TOP_SEGMENTS = new Set([".koswork-backups", ".git"]);
const DEFAULT_IGNORED_DIRS = new Set([".koswork-backups", ".git", "node_modules"]);
const SENSITIVE_FILENAME_PATTERNS = [
  /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.npmrc|\.netrc|credentials(?:\.json)?)$/i,
  /^\.env(?:\..+)?$/i,
  /^id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$/i,
  /\.(?:pem|key|pfx|p12|kdbx)$/i
];

function isCaseInsensitivePlatform(platform = process.platform) {
  return platform === "win32" || platform === "darwin";
}

function normalizeForComparison(targetPath, platform = process.platform) {
  const resolved = path.resolve(targetPath);
  return isCaseInsensitivePlatform(platform) ? resolved.toLowerCase() : resolved;
}

function isPathInsideOrEqual(rootPath, candidatePath, platform = process.platform) {
  const normRoot = normalizeForComparison(rootPath, platform);
  const normCandidate = normalizeForComparison(candidatePath, platform);
  if (normRoot === normCandidate) return true;
  const rel = path.relative(normRoot, normCandidate);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isPathStrictlyInside(rootPath, candidatePath, platform = process.platform) {
  const normRoot = normalizeForComparison(rootPath, platform);
  const normCandidate = normalizeForComparison(candidatePath, platform);
  if (normRoot === normCandidate) return false;
  const rel = path.relative(normRoot, normCandidate);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isForbiddenSystemRoot(
  candidatePath,
  { userDataPath = null, platform = process.platform } = {}
) {
  const resolved = path.resolve(candidatePath);
  const parsed = path.parse(resolved);
  if (parsed.root === resolved) {
    return "Корень диска не может быть подключён как рабочая папка.";
  }

  const normalized = resolved.replace(/\\/g, "/").toLowerCase();
  const forbiddenPosixExact = new Set([
    "/",
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
    "/private",
    "/private/etc",
    "/system",
    "/users",
    "/home"
  ]);
  if (forbiddenPosixExact.has(normalized)) {
    return "Системный каталог ОС не может быть подключён как рабочая папка.";
  }
  for (const prefix of ["/proc/", "/sys/", "/dev/", "/etc/", "/boot/"]) {
    if (normalized.startsWith(prefix)) {
      return "Системный каталог ОС не может быть подключён как рабочая папка.";
    }
  }

  if (
    /^[a-z]:\/(?:windows|program files|program files \(x86\)|programdata|recovery|\$recycle\.bin|system volume information)(?:\/|$)/i.test(
      normalized
    )
  ) {
    return "Системный каталог Windows не может быть подключён как рабочая папка.";
  }
  if (/^[a-z]:\/users$/i.test(normalized)) {
    return "Общий каталог пользователей Windows не может быть подключён целиком.";
  }

  if (userDataPath) {
    let resolvedUserData = path.resolve(userDataPath),
      policyTarget = resolved;
    try {
      resolvedUserData = fs.realpathSync.native(resolvedUserData);
    } catch {}
    try {
      policyTarget = fs.realpathSync.native(resolved);
    } catch {}
    if (
      isPathInsideOrEqual(resolvedUserData, policyTarget, platform) ||
      isPathInsideOrEqual(policyTarget, resolvedUserData, platform)
    ) {
      return "Каталог профиля приложения Kosmora не может использоваться как рабочая папка или перекрывать её.";
    }
  }

  return null;
}

function validateRelativePath(
  rawRelativePath,
  { allowEmpty = false, allowProtected = false } = {}
) {
  if (typeof rawRelativePath !== "string") {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
      "Относительный путь должен быть строкой."
    );
  }
  if (rawRelativePath.length > 512) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
      "Относительный путь превышает максимальную длину 512 символов."
    );
  }
  for (let i = 0; i < rawRelativePath.length; i += 1) {
    const code = rawRelativePath.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        "Путь содержит управляющие или нулевые символы."
      );
    }
  }
  if (rawRelativePath.includes(":")) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
      "Использование букв дисков и потоков NTFS ADS (':') запрещено."
    );
  }

  const normalizedInput = rawRelativePath.replace(/\\/g, "/");
  if (normalizedInput.startsWith("/")) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
      "Абсолютные пути и UNC-пути внутри рабочей папки запрещены."
    );
  }

  if (normalizedInput === "" || normalizedInput === ".") {
    if (allowEmpty) return { relativePath: "", segments: [] };
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_INVALID_ARGUMENT,
      "Укажите непустой относительный путь внутри рабочей папки."
    );
  }

  const rawSegments = normalizedInput.split("/");
  if (rawSegments.some((seg) => seg.length === 0)) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
      "Путь не должен содержать пустых сегментов или двойных слешей."
    );
  }

  const cleanSegments = [];
  for (let i = 0; i < rawSegments.length; i += 1) {
    const seg = rawSegments[i];
    const folded = seg.normalize("NFKC");
    if (folded.includes("/") || folded.includes("\\") || folded.includes(":")) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        "Недопустимый разделитель в имени файла."
      );
    }
    if (seg === "." || seg === "..") {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        "Переход за пределы каталога ('..' или '.') запрещён."
      );
    }
    if (seg.length > 180) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        "Имя файла или папки превышает 180 символов."
      );
    }
    if (/[<>:"|?*]/.test(seg) || /[ .]$/.test(seg)) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        `Недопустимое имя сегмента пути: "${seg}".`
      );
    }
    if (RESERVED_WINDOWS_NAMES.test(seg)) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        `Зарезервированное системное имя устройства Windows запрещено: "${seg}".`
      );
    }
    if (
      !allowProtected &&
      (PROTECTED_TOP_SEGMENTS.has(folded.toLowerCase()) || isSensitiveFilename(folded))
    ) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PROTECTED_PATH,
        `Доступ к служебному каталогу "${seg}" заблокирован политикой рабочей папки.`
      );
    }
    cleanSegments.push(seg);
  }

  return {
    relativePath: cleanSegments.join("/"),
    segments: cleanSegments
  };
}

function isSensitiveFilename(name) {
  return SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

function assertNotReparseOrSymlink(targetPath, lstatResult) {
  if (lstatResult.isSymbolicLink() || (lstatResult.isFile() && lstatResult.nlink > 1)) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
      "Символические ссылки и Windows junction запрещены в рабочей папке.",
      { path: path.basename(targetPath) }
    );
  }
  const parentDir = path.dirname(targetPath);
  let realParent;
  let realTarget;
  try {
    realParent = fs.realpathSync.native
      ? fs.realpathSync.native(parentDir)
      : fs.realpathSync(parentDir);
    realTarget = fs.realpathSync.native
      ? fs.realpathSync.native(targetPath)
      : fs.realpathSync(targetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
        "Обнаружена битая ссылка или недопустимая точка перенаправления (junction).",
        { path: path.basename(targetPath) }
      );
    }
    throw error;
  }
  const expectedChild = path.join(realParent, path.basename(realTarget));
  if (
    normalizeForComparison(realParent) !== normalizeForComparison(path.dirname(realTarget)) ||
    normalizeForComparison(expectedChild) !== normalizeForComparison(realTarget)
  ) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
      "Путь указывает на junction, точку монтирования или символическую ссылку.",
      { path: path.basename(targetPath) }
    );
  }
  return realTarget;
}

function inspectRootDirectory(rawRootPath, { userDataPath = null } = {}) {
  if (typeof rawRootPath !== "string" || rawRootPath.trim() === "") {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNSAFE_ROOT,
      "Укажите абсолютный путь к рабочей папке."
    );
  }
  for (let i = 0; i < rawRootPath.length; i += 1) {
    const code = rawRootPath.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_UNSAFE_ROOT,
        "Путь к рабочей папке содержит недопустимые управляющие символы."
      );
    }
  }
  if (rawRootPath.startsWith("\\\\") || rawRootPath.startsWith("//"))
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNSAFE_ROOT,
      "Сетевой UNC-каталог не поддерживается как локальная рабочая папка."
    );
  if (!path.isAbsolute(rawRootPath)) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNSAFE_ROOT,
      "Рабочая папка должна задаваться абсолютным путём."
    );
  }

  const resolved = path.resolve(rawRootPath);
  const initialForbidden = isForbiddenSystemRoot(resolved, { userDataPath });
  if (initialForbidden) {
    throw new KosworkWorkspaceError(ERROR_CODES.WORKSPACE_UNSAFE_ROOT, initialForbidden);
  }

  let lstat;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_FOUND,
        "Выбранная рабочая папка не существует."
      );
    }
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNSAFE_ROOT,
      "Не удалось проверить выбранную рабочая папку."
    );
  }

  const realRoot = assertNotReparseOrSymlink(resolved, lstat);
  if (!lstat.isDirectory()) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_NOT_A_DIRECTORY,
      "Выбранный путь не является папкой."
    );
  }

  // Also ensure no ancestor component of resolved is a symlink/junction unless OS root alias.
  // Specifically, verify resolved itself was not reached through a workspace symlink.
  // Windows can expand an ordinary 8.3 ancestor (including os.tmpdir()) to its
  // long name. Check every ancestor rather than treating that expansion as a link.
  let ancestor = resolved;
  while (path.dirname(ancestor) !== ancestor) {
    assertNotReparseOrSymlink(ancestor, fs.lstatSync(ancestor));
    ancestor = path.dirname(ancestor);
  }

  const realForbidden = isForbiddenSystemRoot(realRoot, { userDataPath });
  if (realForbidden) {
    throw new KosworkWorkspaceError(ERROR_CODES.WORKSPACE_UNSAFE_ROOT, realForbidden);
  }

  return {
    canonicalRoot: realRoot,
    rootName: path.basename(realRoot)
  };
}

function resolveSafeWorkspaceTarget(
  canonicalRoot,
  rawRelativePath,
  {
    allowEmpty = false,
    mustExist = false,
    allowMissingLeaf = false,
    allowMissingParents = false,
    allowProtected = false,
    blockSensitiveFiles = true,
    signal = null,
    activeController = null
  } = {}
) {
  throwIfAborted(signal, activeController);

  // Re-verify root still exists, is a directory, and was not swapped for a symlink/junction.
  let rootLstat;
  try {
    rootLstat = fs.lstatSync(canonicalRoot);
  } catch {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_NOT_CONNECTED,
      "Рабочая папка больше недоступна на диске."
    );
  }
  const currentRealRoot = assertNotReparseOrSymlink(canonicalRoot, rootLstat);
  if (
    !rootLstat.isDirectory() ||
    normalizeForComparison(currentRealRoot) !== normalizeForComparison(canonicalRoot)
  ) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
      "Корень рабочей папки был подменён или изменён."
    );
  }

  const { relativePath, segments } = validateRelativePath(rawRelativePath, {
    allowEmpty,
    allowProtected
  });

  if (segments.length === 0) {
    return {
      absolutePath: canonicalRoot,
      relativePath: "",
      segments: [],
      exists: true,
      stat: rootLstat
    };
  }

  if (blockSensitiveFiles && isSensitiveFilename(segments[segments.length - 1])) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_PROTECTED_PATH,
      `Файл "${segments[segments.length - 1]}" относится к защищённым секретам/ключам и не доступен для операций Koswork.`
    );
  }

  let currentAbs = canonicalRoot;
  let finalStat = null;
  let exists = true;

  for (let i = 0; i < segments.length; i += 1) {
    throwIfAborted(signal, activeController);
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    currentAbs = path.join(currentAbs, segment);

    if (!isPathStrictlyInside(canonicalRoot, currentAbs)) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_PATH_TRAVERSAL,
        "Путь выходит за пределы подключённой рабочей папки."
      );
    }

    if (!exists) {
      if (!allowMissingParents) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_NOT_FOUND,
          "Родительская папка не существует."
        );
      }
      continue;
    }

    let segStat;
    try {
      segStat = fs.lstatSync(currentAbs);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        exists = false;
        if (mustExist) {
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_NOT_FOUND,
            `Путь "${relativePath}" не найден в рабочей папке.`
          );
        }
        if (!isLast && !allowMissingParents) {
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_NOT_FOUND,
            `Родительская папка "${segments.slice(0, i + 1).join("/")}" не найдена.`
          );
        }
        if (isLast && !allowMissingLeaf && !allowMissingParents) {
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_NOT_FOUND,
            `Целевой путь "${relativePath}" не существует.`
          );
        }
        continue;
      }
      throw error;
    }

    const realSegPath = assertNotReparseOrSymlink(currentAbs, segStat);
    if (!isPathStrictlyInside(canonicalRoot, realSegPath)) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
        "Реальный путь сегмента выходит за границы рабочей папки."
      );
    }

    if (!isLast && !segStat.isDirectory()) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_A_DIRECTORY,
        `Сегмент "${segments.slice(0, i + 1).join("/")}" является файлом, а не папкой.`
      );
    }

    if (isLast) {
      finalStat = segStat;
    }
  }

  return {
    absolutePath: currentAbs,
    relativePath,
    segments,
    exists,
    stat: finalStat
  };
}

module.exports = {
  DEFAULT_IGNORED_DIRS,
  PROTECTED_TOP_SEGMENTS,
  RESERVED_WINDOWS_NAMES,
  assertNotReparseOrSymlink,
  inspectRootDirectory,
  isForbiddenSystemRoot,
  isPathInsideOrEqual,
  isPathStrictlyInside,
  isSensitiveFilename,
  normalizeForComparison,
  resolveSafeWorkspaceTarget,
  validateRelativePath
};
