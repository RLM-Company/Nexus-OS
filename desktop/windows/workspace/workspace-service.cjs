"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeServerOrigin } = require("../connection-policy.cjs");
const { ERROR_CODES, KosworkWorkspaceError, throwIfAborted } = require("./errors.cjs");
const {
  DEFAULT_IGNORED_DIRS,
  assertNotReparseOrSymlink,
  inspectRootDirectory,
  isPathStrictlyInside,
  isSensitiveFilename,
  normalizeForComparison,
  resolveSafeWorkspaceTarget
} = require("./path-guard.cjs");
const {
  computeBufferVersion,
  createBackupStore,
  decodeStrictUtf8Text,
  normalizeExpectedSha256,
  readBoundedFileSnapshot,
  versionsMatch
} = require("./version-backup.cjs");

const OWNER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/u;

const DEFAULT_LIMITS = Object.freeze({
  maxReadBytes: 2 * 1024 * 1024, // 2 MiB max text read
  maxWriteBytes: 2 * 1024 * 1024, // 2 MiB max text write
  maxListEntries: 200,
  hardMaxListEntries: 1000,
  maxListDepth: 5,
  hardMaxListDepth: 12,
  maxSearchResults: 50,
  hardMaxSearchResults: 250,
  maxSearchFilesScanned: 400,
  maxSearchFileBytes: 1024 * 1024, // 1 MiB per file during text search
  maxLinePreviewChars: 240,
  maxBackups: 50,
  maxTotalBackupBytes: 25 * 1024 * 1024
});

function sanitizeLimits(custom = {}) {
  const merged = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(custom || {})) {
    if (key in DEFAULT_LIMITS && Number.isSafeInteger(value) && value > 0) {
      merged[key] = Math.min(value, DEFAULT_LIMITS[key]);
    }
  }
  merged.maxListEntries = Math.min(merged.maxListEntries, merged.hardMaxListEntries);
  merged.maxListDepth = Math.min(merged.maxListDepth, merged.hardMaxListDepth);
  merged.maxSearchResults = Math.min(merged.maxSearchResults, merged.hardMaxSearchResults);
  return Object.freeze(merged);
}

/**
 * Verifies that an Electron IPC event (if passed) never originates from a remote
 * HTTP/HTTPS webpage. Remote web pages must NEVER gain direct filesystem or shell access.
 */
function assertNotRemoteWebCaller(ipcEvent) {
  if (!ipcEvent) return;
  const senderUrl =
    typeof ipcEvent.senderFrame?.url === "string"
      ? ipcEvent.senderFrame.url
      : typeof ipcEvent.sender?.getURL === "function"
        ? ipcEvent.sender.getURL()
        : "";
  if (!senderUrl) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNTRUSTED_CALLER,
      "Отсутствует подтверждённый локальный контекст вызова."
    );
  }
  let parsed;
  try {
    parsed = new URL(senderUrl);
  } catch {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNTRUSTED_CALLER,
      "Недопустимый URL источника IPC-вызова."
    );
  }
  if (parsed.protocol !== "file:") {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_UNTRUSTED_CALLER,
      "Прямой доступ к файловой системе рабочей папки из удалённой веб-страницы запрещён.",
      { protocol: parsed.protocol }
    );
  }
}

function validateOwnerScope(ownerId, origin, { requireOwner = false } = {}) {
  if (!requireOwner && !ownerId && !origin) {
    return { ownerId: "local-owner", origin: "local" };
  }
  if (typeof ownerId !== "string" || !OWNER_ID_PATTERN.test(ownerId)) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_OWNER_MISMATCH,
      "Требуется подтверждённый идентификатор владельца (ownerId)."
    );
  }
  if (requireOwner && (!origin || origin === "local"))
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_OWNER_MISMATCH,
      "Нужен подтверждённый сервер."
    );
  const normalizedOrigin = origin === "local" ? "local" : normalizeServerOrigin(origin);
  return { ownerId, origin: normalizedOrigin };
}

function boundedDirectory(directory, maximum) {
  const handle = fs.opendirSync(directory),
    entries = [];
  try {
    for (let i = 0; i <= maximum; i++) {
      const entry = handle.readSync();
      if (!entry) break;
      entries.push(entry);
    }
  } finally {
    handle.closeSync();
  }
  return { entries: entries.slice(0, maximum), truncated: entries.length > maximum };
}

function createKosworkWorkspaceService({
  userDataPath = null,
  requireOwnerScope = false,
  limits: customLimits = {},
  now = () => Date.now(),
  codec = null,
  scopeNamespace = "",
  pickDirectory = null
} = {}) {
  const limits = sanitizeLimits(customLimits);

  let activeSession = null;
  let sessionLifecycleController = null;
  const activeOperationControllers = new Set();
  const pathLocks = new Map();

  function assertRootIdentity(session) {
    let stat;
    try {
      stat = fs.lstatSync(session.canonicalRoot);
    } catch {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_ROOT_CHANGED,
        "Выбранная папка больше недоступна."
      );
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.ino !== session.rootIdentity.ino ||
      stat.dev !== session.rootIdentity.dev
    )
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_ROOT_CHANGED,
        "Выбранная папка была заменена. Выберите папку заново."
      );
  }

  function beginOperation(externalSignal) {
    if (
      !activeSession ||
      !sessionLifecycleController ||
      sessionLifecycleController.signal.aborted
    ) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_CONNECTED,
        "Рабочая папка Koswork не подключена или доступ к ней был отозван."
      );
    }
    throwIfAborted(externalSignal, sessionLifecycleController);

    const opController = new AbortController();
    const onAbort = () => {
      opController.abort(
        externalSignal?.aborted ? externalSignal.reason || "aborted" : "session_revoked"
      );
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        onAbort();
      } else {
        externalSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
    sessionLifecycleController.signal.addEventListener("abort", onAbort, { once: true });
    activeOperationControllers.add(opController);

    return {
      controller: opController,
      check() {
        if (activeSession) assertRootIdentity(activeSession);
        throwIfAborted(externalSignal, opController);
        if (!activeSession) {
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_NOT_CONNECTED,
            "Доступ к рабочей папке был отозван."
          );
        }
      },
      end() {
        activeOperationControllers.delete(opController);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onAbort);
        }
        sessionLifecycleController?.signal.removeEventListener("abort", onAbort);
      }
    };
  }

  function verifyCallerOwner({ ownerId, origin, ipcEvent } = {}, checkRoot = true) {
    assertNotRemoteWebCaller(ipcEvent);
    if (!activeSession) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_CONNECTED,
        "Рабочая папка Koswork не подключена."
      );
    }
    if (requireOwnerScope) validateOwnerScope(ownerId, origin, { requireOwner: true });
    if (requireOwnerScope || ownerId || origin) {
      const checkOwner = ownerId ?? activeSession.ownerId;
      const checkOrigin = origin
        ? origin === "local"
          ? "local"
          : normalizeServerOrigin(origin)
        : activeSession.origin;
      if (checkOwner !== activeSession.ownerId || checkOrigin !== activeSession.origin) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_OWNER_MISMATCH,
          "Подключённая рабочая папка принадлежит другому владельцу или серверу."
        );
      }
    }
    if (checkRoot) assertRootIdentity(activeSession);
    return activeSession;
  }

  async function withPathLock(relativePathKey, task) {
    const key = relativePathKey.toLowerCase();
    const previous = pathLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => undefined).then(() => gate);
    pathLocks.set(key, chained);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (pathLocks.get(key) === chained) {
        pathLocks.delete(key);
      }
    }
  }

  function resolveBackupRoot(canonicalRoot, workspaceId) {
    if (userDataPath) {
      return path.join(path.resolve(userDataPath), "koswork-backups", workspaceId);
    }
    return path.join(canonicalRoot, ".koswork-backups");
  }

  async function connectFolder({
    folderPath = null,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    assertNotRemoteWebCaller(ipcEvent);
    throwIfAborted(signal, null);

    const ownerScope = validateOwnerScope(ownerId, origin, { requireOwner: requireOwnerScope });
    let candidatePath = folderPath;
    if (!candidatePath && typeof pickDirectory === "function") {
      candidatePath = await pickDirectory();
      throwIfAborted(signal, null);
    }
    if (!candidatePath || typeof candidatePath !== "string") {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_UNSAFE_ROOT,
        "Владелец не выбрал рабочую папку."
      );
    }

    const { canonicalRoot, rootName } = inspectRootDirectory(candidatePath, { userDataPath });
    const rootIdentity = fs.lstatSync(canonicalRoot);
    const workspaceId = crypto
      .createHash("sha256")
      .update(
        `${scopeNamespace}${scopeNamespace ? "\0" : ""}${ownerScope.origin}\0${ownerScope.ownerId}\0${canonicalRoot}\0${rootIdentity.dev}:${rootIdentity.ino}`
      )
      .digest("hex")
      .slice(0, 24);

    // Cancel any previous workspace session operations cleanly before switching
    if (sessionLifecycleController) {
      sessionLifecycleController.abort("switched_workspace");
    }
    for (const ctrl of activeOperationControllers) {
      ctrl.abort("switched_workspace");
    }
    activeOperationControllers.clear();

    const backupDirectory = resolveBackupRoot(canonicalRoot, workspaceId);
    const backupStore = createBackupStore(backupDirectory, {
      maxBackups: limits.maxBackups,
      maxTotalBackupBytes: limits.maxTotalBackupBytes,
      now,
      codec
    });

    sessionLifecycleController = new AbortController();
    activeSession = {
      workspaceId,
      rootIdentity: { dev: rootIdentity.dev, ino: rootIdentity.ino },
      canonicalRoot,
      rootName,
      ownerId: ownerScope.ownerId,
      origin: ownerScope.origin,
      connectedAt: new Date(now()).toISOString(),
      backupDirectory,
      backupStore
    };

    return {
      connected: true,
      workspaceId: activeSession.workspaceId,
      rootName: activeSession.rootName,
      rootPath: activeSession.canonicalRoot,
      ownerId: activeSession.ownerId,
      origin: activeSession.origin,
      connectedAt: activeSession.connectedAt,
      limits
    };
  }

  function getStatus({ ownerId = null, origin = null, ipcEvent = null } = {}) {
    assertNotRemoteWebCaller(ipcEvent);
    if (!activeSession) {
      return {
        connected: false,
        workspaceId: null,
        rootName: null,
        rootPath: null,
        ownerId: null,
        origin: null,
        connectedAt: null,
        activeOperations: 0,
        limits
      };
    }
    if (ownerId || origin || requireOwnerScope) {
      verifyCallerOwner({ ownerId, origin });
    }
    return {
      connected: true,
      workspaceId: activeSession.workspaceId,
      rootName: activeSession.rootName,
      rootPath: activeSession.canonicalRoot,
      ownerId: activeSession.ownerId,
      origin: activeSession.origin,
      connectedAt: activeSession.connectedAt,
      activeOperations: activeOperationControllers.size,
      limits
    };
  }

  function cancelAllOperations(reason = "cancelled_by_owner") {
    let cancelledCount = 0;
    for (const ctrl of activeOperationControllers) {
      if (!ctrl.signal.aborted) {
        ctrl.abort(reason);
        cancelledCount += 1;
      }
    }
    activeOperationControllers.clear();
    return { cancelledCount };
  }

  async function revokeAccess({
    ownerId = null,
    origin = null,
    purgeBackups = false,
    ipcEvent = null
  } = {}) {
    assertNotRemoteWebCaller(ipcEvent);
    if (!activeSession) {
      return { revoked: true, wasConnected: false, cancelledOperations: 0 };
    }
    if (ownerId || origin || requireOwnerScope) {
      verifyCallerOwner({ ownerId, origin }, false);
    }
    const previousSession = activeSession;
    const { cancelledCount } = cancelAllOperations("access_revoked");
    if (sessionLifecycleController) {
      sessionLifecycleController.abort("access_revoked");
      sessionLifecycleController = null;
    }
    activeSession = null;

    if (purgeBackups) {
      previousSession.backupStore.purgeAll();
    }
    return {
      revoked: true,
      wasConnected: true,
      workspaceId: previousSession.workspaceId,
      cancelledOperations: cancelledCount,
      revokedAt: new Date(now()).toISOString()
    };
  }

  async function listFiles({
    relativePath = "",
    recursive = true,
    maxDepth = limits.maxListDepth,
    maxEntries = limits.maxListEntries,
    cursor = 0,
    includeHidden = false,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      const effectiveMaxDepth = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxDepth) ? maxDepth : limits.maxListDepth,
          limits.hardMaxListDepth
        )
      );
      const effectiveMaxEntries = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxEntries) ? maxEntries : limits.maxListEntries,
          limits.hardMaxListEntries
        )
      );
      const startIndex = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;

      const startTarget = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: true,
        mustExist: true,
        signal,
        activeController: op.controller
      });
      if (!startTarget.stat.isDirectory()) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_NOT_A_DIRECTORY,
          `Путь "${startTarget.relativePath || "."}" не является папкой.`
        );
      }

      const collected = [];
      const skippedSymlinks = [];
      let totalMatched = 0;
      let truncated = false;

      let visited = 0;
      async function walk(currentAbs, currentRel, depth) {
        op.check();
        let dirents;
        let directoryTruncated = false;
        try {
          const listing = boundedDirectory(currentAbs, Math.max(0, 2000 - visited));
          dirents = listing.entries;
          directoryTruncated = listing.truncated;
        } catch (error) {
          if (error instanceof KosworkWorkspaceError) throw error;
          return;
        }
        dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        for (const dirent of dirents) {
          if (++visited > 2000) {
            truncated = true;
            return;
          }
          if (visited % 25 === 0) await new Promise(setImmediate);
          op.check();
          const name = dirent.name;
          if (DEFAULT_IGNORED_DIRS.has(name.toLowerCase())) continue;
          if (!includeHidden && name.startsWith(".")) continue;
          if (isSensitiveFilename(name)) continue;

          const childRel = currentRel ? `${currentRel}/${name}` : name;
          const childAbs = path.join(currentAbs, name);

          let childLstat;
          try {
            childLstat = fs.lstatSync(childAbs);
          } catch {
            continue;
          }

          try {
            const realChild = assertNotReparseOrSymlink(childAbs, childLstat);
            if (!isPathStrictlyInside(session.canonicalRoot, realChild)) {
              skippedSymlinks.push(childRel);
              continue;
            }
          } catch (error) {
            if (
              error instanceof KosworkWorkspaceError &&
              error.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
            ) {
              skippedSymlinks.push(childRel);
              continue;
            }
            throw error;
          }

          const isDir = childLstat.isDirectory();
          const isFile = childLstat.isFile();
          if (!isDir && !isFile) continue;

          if (totalMatched >= startIndex) {
            if (collected.length < effectiveMaxEntries) {
              collected.push({
                name,
                path: childRel,
                kind: isDir ? "directory" : "file",
                size: isFile ? childLstat.size : 0,
                mtimeMs: childLstat.mtimeMs
              });
            } else {
              truncated = true;
              return;
            }
          }
          totalMatched += 1;

          if (isDir && recursive && depth < effectiveMaxDepth) {
            await walk(childAbs, childRel, depth + 1);
            if (truncated) return;
          }
        }
        if (directoryTruncated) truncated = true;
      }

      await walk(startTarget.absolutePath, startTarget.relativePath, 1);

      return {
        rootPath: session.canonicalRoot,
        relativePath: startTarget.relativePath,
        items: collected,
        count: collected.length,
        cursor: startIndex,
        nextCursor: truncated ? startIndex + collected.length : null,
        truncated,
        skippedSymlinks
      };
    } finally {
      op.end();
    }
  }

  async function searchByName({
    query,
    relativePath = "",
    maxResults = limits.maxSearchResults,
    maxDepth = limits.maxListDepth,
    caseSensitive = false,
    includeHidden = false,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      if (typeof query !== "string" || query.trim() === "" || query.length > 200) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_INVALID_ARGUMENT,
          "Поисковый запрос по имени должен быть непустой строкой до 200 символов."
        );
      }
      const needle = caseSensitive ? query.trim() : query.trim().toLowerCase();
      const effectiveMaxResults = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxResults) ? maxResults : limits.maxSearchResults,
          limits.hardMaxSearchResults
        )
      );
      const effectiveMaxDepth = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxDepth) ? maxDepth : limits.maxListDepth,
          limits.hardMaxListDepth
        )
      );

      const startTarget = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: true,
        mustExist: true,
        signal,
        activeController: op.controller
      });
      if (!startTarget.stat.isDirectory()) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_NOT_A_DIRECTORY,
          `Путь "${startTarget.relativePath || "."}" не является папкой.`
        );
      }

      const matches = [];
      const skippedSymlinks = [];
      let entriesScanned = 0;
      let truncated = false;

      let visited = 0;
      async function walk(currentAbs, currentRel, depth) {
        op.check();
        let dirents;
        let directoryTruncated = false;
        try {
          const listing = boundedDirectory(currentAbs, Math.max(0, 2000 - visited));
          dirents = listing.entries;
          directoryTruncated = listing.truncated;
        } catch {
          return;
        }
        dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        for (const dirent of dirents) {
          if (++visited > 2000) {
            truncated = true;
            return;
          }
          if (visited % 25 === 0) await new Promise(setImmediate);
          op.check();
          const name = dirent.name;
          if (DEFAULT_IGNORED_DIRS.has(name.toLowerCase())) continue;
          if (!includeHidden && name.startsWith(".")) continue;
          if (isSensitiveFilename(name)) continue;

          const childRel = currentRel ? `${currentRel}/${name}` : name;
          const childAbs = path.join(currentAbs, name);

          let childLstat;
          try {
            childLstat = fs.lstatSync(childAbs);
          } catch {
            continue;
          }

          try {
            const realChild = assertNotReparseOrSymlink(childAbs, childLstat);
            if (!isPathStrictlyInside(session.canonicalRoot, realChild)) {
              skippedSymlinks.push(childRel);
              continue;
            }
          } catch (error) {
            if (
              error instanceof KosworkWorkspaceError &&
              error.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
            ) {
              skippedSymlinks.push(childRel);
              continue;
            }
            throw error;
          }

          entriesScanned += 1;
          const candidateName = caseSensitive ? name : name.toLowerCase();
          if (candidateName.includes(needle)) {
            if (matches.length < effectiveMaxResults) {
              matches.push({
                name,
                path: childRel,
                kind: childLstat.isDirectory() ? "directory" : "file",
                size: childLstat.isFile() ? childLstat.size : 0,
                mtimeMs: childLstat.mtimeMs
              });
            } else {
              truncated = true;
              return;
            }
          }

          if (childLstat.isDirectory() && depth < effectiveMaxDepth) {
            await walk(childAbs, childRel, depth + 1);
            if (truncated) return;
          }
        }
        if (directoryTruncated) truncated = true;
      }

      await walk(startTarget.absolutePath, startTarget.relativePath, 1);

      return {
        query: query.trim(),
        matches,
        count: matches.length,
        entriesScanned,
        truncated,
        skippedSymlinks
      };
    } finally {
      op.end();
    }
  }

  async function searchByText({
    query,
    relativePath = "",
    maxResults = limits.maxSearchResults,
    maxDepth = limits.maxListDepth,
    maxFilesScanned = limits.maxSearchFilesScanned,
    maxFileBytes = limits.maxSearchFileBytes,
    caseSensitive = false,
    includeHidden = false,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      if (typeof query !== "string" || query.trim() === "" || query.length > 500) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_INVALID_ARGUMENT,
          "Поисковый запрос по тексту должен быть непустой строкой до 500 символов."
        );
      }
      maxFilesScanned = Math.min(
        Number.isSafeInteger(maxFilesScanned) && maxFilesScanned > 0
          ? maxFilesScanned
          : limits.maxSearchFilesScanned,
        limits.maxSearchFilesScanned
      );
      const rawQuery = query;
      const needle = caseSensitive ? rawQuery : rawQuery.toLowerCase();
      const effectiveMaxResults = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxResults) ? maxResults : limits.maxSearchResults,
          limits.hardMaxSearchResults
        )
      );
      const effectiveMaxDepth = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxDepth) ? maxDepth : limits.maxListDepth,
          limits.hardMaxListDepth
        )
      );
      const effectiveMaxFileBytes = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxFileBytes) ? maxFileBytes : limits.maxSearchFileBytes,
          limits.maxReadBytes
        )
      );

      const startTarget = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: true,
        mustExist: true,
        signal,
        activeController: op.controller
      });
      if (!startTarget.stat.isDirectory()) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_NOT_A_DIRECTORY,
          `Путь "${startTarget.relativePath || "."}" не является папкой.`
        );
      }

      const matches = [];
      const skippedSymlinks = [];
      let filesScanned = 0;
      let skippedLargeFiles = 0;
      let skippedBinaryFiles = 0;
      let truncated = false;

      function scanFile(fileAbs, fileRel, lstat) {
        op.check();
        if (lstat.size > effectiveMaxFileBytes) {
          skippedLargeFiles += 1;
          return;
        }
        if (filesScanned >= maxFilesScanned) {
          truncated = true;
          return;
        }
        filesScanned += 1;

        let snapshot;
        try {
          snapshot = readBoundedFileSnapshot(fileAbs, {
            relativePath: fileRel,
            maxBytes: effectiveMaxFileBytes,
            signal,
            activeController: op.controller
          });
        } catch (error) {
          if (
            error instanceof KosworkWorkspaceError &&
            error.code === ERROR_CODES.WORKSPACE_OPERATION_CANCELLED
          ) {
            throw error;
          }
          if (
            error instanceof KosworkWorkspaceError &&
            error.code === ERROR_CODES.WORKSPACE_FILE_TOO_LARGE
          ) {
            skippedLargeFiles += 1;
          }
          return;
        }

        let text;
        try {
          text = decodeStrictUtf8Text(snapshot.buffer, fileRel);
        } catch {
          skippedBinaryFiles += 1;
          return;
        }

        const lines = text.split(/\r?\n/);
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
          op.check();
          const lineText = lines[lineIdx];
          const haystack = caseSensitive ? lineText : lineText.toLowerCase();
          const colIdx = haystack.indexOf(needle);
          if (colIdx !== -1) {
            if (matches.length < effectiveMaxResults) {
              matches.push({
                path: fileRel,
                line: lineIdx + 1,
                column: colIdx + 1,
                preview: lineText.slice(0, limits.maxLinePreviewChars),
                sha256: snapshot.sha256,
                version: snapshot.version
              });
            } else {
              truncated = true;
              return;
            }
          }
        }
      }

      let visited = 0;
      async function walk(currentAbs, currentRel, depth) {
        op.check();
        let dirents;
        let directoryTruncated = false;
        try {
          const listing = boundedDirectory(currentAbs, Math.max(0, 2000 - visited));
          dirents = listing.entries;
          directoryTruncated = listing.truncated;
        } catch {
          return;
        }
        dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        for (const dirent of dirents) {
          if (++visited > 2000) {
            truncated = true;
            return;
          }
          if (visited % 25 === 0) await new Promise(setImmediate);
          op.check();
          const name = dirent.name;
          if (DEFAULT_IGNORED_DIRS.has(name.toLowerCase())) continue;
          if (!includeHidden && name.startsWith(".")) continue;
          if (isSensitiveFilename(name)) continue;

          const childRel = currentRel ? `${currentRel}/${name}` : name;
          const childAbs = path.join(currentAbs, name);

          let childLstat;
          try {
            childLstat = fs.lstatSync(childAbs);
          } catch {
            continue;
          }

          try {
            const realChild = assertNotReparseOrSymlink(childAbs, childLstat);
            if (!isPathStrictlyInside(session.canonicalRoot, realChild)) {
              skippedSymlinks.push(childRel);
              continue;
            }
          } catch (error) {
            if (
              error instanceof KosworkWorkspaceError &&
              error.code === ERROR_CODES.WORKSPACE_SYMLINK_REJECTED
            ) {
              skippedSymlinks.push(childRel);
              continue;
            }
            throw error;
          }

          if (childLstat.isFile()) {
            scanFile(childAbs, childRel, childLstat);
            if (truncated) return;
          } else if (childLstat.isDirectory() && depth < effectiveMaxDepth) {
            await walk(childAbs, childRel, depth + 1);
            if (truncated) return;
          }
        }
        if (directoryTruncated) truncated = true;
      }

      await walk(startTarget.absolutePath, startTarget.relativePath, 1);

      return {
        query: rawQuery,
        matches,
        count: matches.length,
        filesScanned,
        skippedLargeFiles,
        skippedBinaryFiles,
        skippedSymlinks,
        truncated
      };
    } finally {
      op.end();
    }
  }

  async function readTextFile({
    relativePath,
    maxBytes = limits.maxReadBytes,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      const effectiveMaxBytes = Math.max(
        1,
        Math.min(
          Number.isSafeInteger(maxBytes) ? maxBytes : limits.maxReadBytes,
          limits.maxReadBytes
        )
      );
      let target = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: false,
        mustExist: true,
        signal,
        activeController: op.controller
      });
      if (target.stat.isDirectory()) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_NOT_A_FILE,
          `Путь "${target.relativePath}" является папкой, а не текстовым файлом.`
        );
      }

      const snapshot = readBoundedFileSnapshot(target.absolutePath, {
        relativePath: target.relativePath,
        maxBytes: effectiveMaxBytes,
        signal,
        activeController: op.controller
      });
      const content = decodeStrictUtf8Text(snapshot.buffer, target.relativePath);

      return {
        path: target.relativePath,
        content,
        encoding: "utf-8",
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        sha256: snapshot.sha256,
        version: snapshot.version
      };
    } finally {
      op.end();
    }
  }

  async function createDirectory({
    relativePath,
    recursive = true,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      let target = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: false,
        mustExist: false,
        allowMissingLeaf: true,
        allowMissingParents: Boolean(recursive),
        signal,
        activeController: op.controller
      });

      return await withPathLock(target.relativePath, async () => {
        op.check();
        if (target.exists && target.stat) {
          if (target.stat.isDirectory()) {
            return {
              path: target.relativePath,
              created: false
            };
          }
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
            `По пути "${target.relativePath}" уже существует файл.`
          );
        }

        let currentAbs = session.canonicalRoot;
        let createdAny = false;
        for (const seg of target.segments) {
          op.check();
          currentAbs = path.join(currentAbs, seg);
          try {
            const stat = fs.lstatSync(currentAbs);
            assertNotReparseOrSymlink(currentAbs, stat);
            if (!stat.isDirectory()) {
              throw new KosworkWorkspaceError(
                ERROR_CODES.WORKSPACE_NOT_A_DIRECTORY,
                `Сегмент "${seg}" уже существует и не является папкой.`
              );
            }
          } catch (error) {
            if (error && error.code === "ENOENT") {
              fs.mkdirSync(currentAbs, { mode: 0o700 });
              createdAny = true;
            } else {
              throw error;
            }
          }
        }

        return {
          path: target.relativePath,
          created: createdAny
        };
      });
    } finally {
      op.end();
    }
  }

  function verifyWritten(session, target, buffer, op) {
    try {
      const checked = resolveSafeWorkspaceTarget(session.canonicalRoot, target.relativePath, {
        mustExist: true,
        activeController: op.controller
      });
      const snapshot = readBoundedFileSnapshot(checked.absolutePath, {
        maxBytes: limits.maxWriteBytes,
        activeController: op.controller
      });
      if (snapshot.sha256 !== computeBufferVersion(buffer).sha256) throw Error("changed");
      return snapshot;
    } catch {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_RESULT_UNCERTAIN,
        "Файл мог быть записан, но результат не удалось подтвердить. Проверьте его перед повтором."
      );
    }
  }

  async function createFile({
    relativePath,
    content,
    createParents = false,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      if (typeof content !== "string") {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_INVALID_ARGUMENT,
          "Содержимое создаваемого файла должно быть текстовой строкой."
        );
      }
      const buffer = Buffer.from(content, "utf8");
      if (buffer.byteLength > limits.maxWriteBytes) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_FILE_TOO_LARGE,
          `Размер записываемого файла (${buffer.byteLength} байт) превышает лимит ${limits.maxWriteBytes} байт.`,
          { size: buffer.byteLength, maxWriteBytes: limits.maxWriteBytes }
        );
      }
      decodeStrictUtf8Text(buffer, relativePath);

      if (createParents) {
        const parsedDir = path.posix.dirname(String(relativePath).replace(/\\/g, "/"));
        if (parsedDir && parsedDir !== ".") {
          await createDirectory({
            relativePath: parsedDir,
            recursive: true,
            ownerId,
            origin,
            signal
          });
        }
      }

      let target = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: false,
        mustExist: false,
        allowMissingLeaf: true,
        allowMissingParents: false,
        signal,
        activeController: op.controller
      });

      return await withPathLock(target.relativePath, async () => {
        op.check();
        target = resolveSafeWorkspaceTarget(session.canonicalRoot, target.relativePath, {
          allowEmpty: false,
          allowMissingLeaf: true,
          allowMissingParents: false,
          signal,
          activeController: op.controller
        });
        if (target.exists) {
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
            `Файл или папка "${target.relativePath}" уже существует. Для замены используйте updateFile с проверкой версии.`
          );
        }

        let fd;
        try {
          fd = fs.openSync(target.absolutePath, "wx", 0o600);
          let offset = 0;
          while (offset < buffer.byteLength) {
            op.check();
            const chunk = buffer.subarray(offset, Math.min(offset + 65536, buffer.byteLength));
            const written = fs.writeSync(fd, chunk, 0, chunk.byteLength, offset);
            offset += written;
          }
          fs.fsyncSync(fd);
        } catch (error) {
          if (error && error.code === "EEXIST") {
            throw new KosworkWorkspaceError(
              ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
              `Файл "${target.relativePath}" был создан конкурентным запросом.`
            );
          }
          if (error instanceof KosworkWorkspaceError) {
            try {
              if (fd !== undefined) {
                fs.closeSync(fd);
                fd = undefined;
              }
              fs.unlinkSync(target.absolutePath);
            } catch {
              /* ignore cleanup error */
            }
          }
          throw error;
        } finally {
          if (fd !== undefined) {
            try {
              fs.closeSync(fd);
            } catch {
              /* ignore */
            }
          }
        }

        const finalStat = verifyWritten(session, target, buffer, op);
        const { sha256, version } = computeBufferVersion(buffer);
        return {
          path: target.relativePath,
          created: true,
          size: finalStat.size,
          mtimeMs: finalStat.mtimeMs,
          sha256,
          version
        };
      });
    } finally {
      op.end();
    }
  }

  async function updateFile({
    relativePath,
    content,
    expectedVersion = null,
    expectedSha256 = null,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null,
    _beforeCommitHook = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      if (typeof content !== "string") {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_INVALID_ARGUMENT,
          "Новое содержимое файла должно быть текстовой строкой."
        );
      }
      const expectedInput = expectedVersion || expectedSha256;
      if (!normalizeExpectedSha256(expectedInput)) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
          "Перед обновлением файла необходимо передать актуальный expectedVersion или expectedSha256."
        );
      }

      const nextBuffer = Buffer.from(content, "utf8");
      if (nextBuffer.byteLength > limits.maxWriteBytes) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_FILE_TOO_LARGE,
          `Размер обновляемого файла (${nextBuffer.byteLength} байт) превышает лимит ${limits.maxWriteBytes} байт.`,
          { size: nextBuffer.byteLength, maxWriteBytes: limits.maxWriteBytes }
        );
      }
      decodeStrictUtf8Text(nextBuffer, relativePath);

      let target = resolveSafeWorkspaceTarget(session.canonicalRoot, relativePath, {
        allowEmpty: false,
        mustExist: true,
        signal,
        activeController: op.controller
      });
      if (target.stat.isDirectory()) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_NOT_A_FILE,
          `Путь "${target.relativePath}" указывает на папку, а не на файл.`
        );
      }

      return await withPathLock(target.relativePath, async () => {
        op.check();
        target = resolveSafeWorkspaceTarget(session.canonicalRoot, target.relativePath, {
          allowEmpty: false,
          allowMissingLeaf: true,
          allowMissingParents: false,
          signal,
          activeController: op.controller
        });
        const currentSnapshot = readBoundedFileSnapshot(target.absolutePath, {
          relativePath: target.relativePath,
          maxBytes: limits.maxWriteBytes,
          signal,
          activeController: op.controller
        });

        if (!versionsMatch(currentSnapshot.sha256, expectedInput)) {
          throw new KosworkWorkspaceError(
            ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
            `Версия файла "${target.relativePath}" изменилась на диске. Обновление отклонено для предотвращения потери данных.`,
            {
              path: target.relativePath,
              expectedVersion: expectedInput,
              actualVersion: currentSnapshot.version,
              actualSha256: currentSnapshot.sha256
            }
          );
        }

        // Save verified backup before touching the target file
        const backup = session.backupStore.saveBackup({
          relativePath: target.relativePath,
          buffer: currentSnapshot.buffer,
          sha256: currentSnapshot.sha256,
          version: currentSnapshot.version,
          originalMtimeMs: currentSnapshot.mtimeMs
        });

        const tempFilename = `.koswork-tmp-${process.pid}-${now()}-${crypto.randomBytes(6).toString("hex")}`;
        const tempPath = path.join(path.dirname(target.absolutePath), tempFilename);

        let tempFd;
        try {
          tempFd = fs.openSync(tempPath, "wx", 0o600);
          let offset = 0;
          while (offset < nextBuffer.byteLength) {
            op.check();
            const chunk = nextBuffer.subarray(
              offset,
              Math.min(offset + 65536, nextBuffer.byteLength)
            );
            const written = fs.writeSync(tempFd, chunk, 0, chunk.byteLength, offset);
            offset += written;
          }
          fs.fsyncSync(tempFd);
          fs.closeSync(tempFd);
          tempFd = undefined;

          if (typeof _beforeCommitHook === "function") {
            await _beforeCommitHook();
          }
          op.check();

          target = resolveSafeWorkspaceTarget(session.canonicalRoot, target.relativePath, {
            mustExist: true,
            signal,
            activeController: op.controller
          });
          // Re-verify target file immediately prior to atomic rename to detect concurrent external edits
          const preCommitSnapshot = readBoundedFileSnapshot(target.absolutePath, {
            relativePath: target.relativePath,
            maxBytes: limits.maxWriteBytes,
            signal,
            activeController: op.controller
          });
          if (
            preCommitSnapshot.sha256 !== currentSnapshot.sha256 ||
            preCommitSnapshot.mtimeMs !== currentSnapshot.mtimeMs ||
            preCommitSnapshot.size !== currentSnapshot.size ||
            (currentSnapshot.ino &&
              preCommitSnapshot.ino &&
              preCommitSnapshot.ino !== currentSnapshot.ino)
          ) {
            throw new KosworkWorkspaceError(
              ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
              `Обнаружено конкурентное изменение файла "${target.relativePath}" перед фиксацией записи.`,
              {
                path: target.relativePath,
                expectedVersion: currentSnapshot.version,
                actualVersion: preCommitSnapshot.version
              }
            );
          }

          fs.renameSync(tempPath, target.absolutePath);
        } finally {
          if (tempFd !== undefined) {
            try {
              fs.closeSync(tempFd);
            } catch {
              /* ignore */
            }
          }
          try {
            fs.unlinkSync(tempPath);
          } catch {
            /* already renamed or removed */
          }
        }

        const finalStat = verifyWritten(session, target, nextBuffer, op);
        const nextVersion = computeBufferVersion(nextBuffer);
        return {
          path: target.relativePath,
          updated: true,
          size: finalStat.size,
          mtimeMs: finalStat.mtimeMs,
          previousSha256: currentSnapshot.sha256,
          previousVersion: currentSnapshot.version,
          sha256: nextVersion.sha256,
          version: nextVersion.version,
          backup
        };
      });
    } finally {
      op.end();
    }
  }

  function listBackups({
    relativePath = null,
    ownerId = null,
    origin = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    return session.backupStore.listBackups(relativePath);
  }

  async function restoreBackup({
    backupId,
    expectedVersion = null,
    ownerId = null,
    origin = null,
    signal = null,
    ipcEvent = null
  } = {}) {
    const session = verifyCallerOwner({ ownerId, origin, ipcEvent });
    const op = beginOperation(signal);
    try {
      const backupRecord = session.backupStore.readBackup(backupId);
      const restoredText = decodeStrictUtf8Text(backupRecord.buffer, backupRecord.relativePath);
      const target = resolveSafeWorkspaceTarget(session.canonicalRoot, backupRecord.relativePath, {
        allowEmpty: false,
        mustExist: false,
        allowMissingLeaf: true,
        allowMissingParents: true,
        signal,
        activeController: op.controller
      });

      if (!target.exists) {
        const created = await createFile({
          relativePath: backupRecord.relativePath,
          content: restoredText,
          createParents: true,
          ownerId,
          origin,
          signal
        });
        return {
          ...created,
          restoredFromBackupId: backupId
        };
      }

      const currentSnapshot = readBoundedFileSnapshot(target.absolutePath, {
        relativePath: target.relativePath,
        maxBytes: limits.maxWriteBytes,
        signal,
        activeController: op.controller
      });
      const versionToExpect = expectedVersion;
      if (!normalizeExpectedSha256(versionToExpect))
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
          "Для восстановления укажите проверенную версию текущего файла."
        );
      const updated = await updateFile({
        relativePath: backupRecord.relativePath,
        content: restoredText,
        expectedVersion: versionToExpect,
        ownerId,
        origin,
        signal
      });
      return {
        ...updated,
        restoredFromBackupId: backupId
      };
    } finally {
      op.end();
    }
  }

  return {
    connectFolder,
    getStatus,
    cancelAllOperations,
    revokeAccess,
    listFiles,
    searchByName,
    searchByText,
    readTextFile,
    createDirectory,
    createFile,
    updateFile,
    listBackups,
    restoreBackup
  };
}

module.exports = {
  DEFAULT_LIMITS,
  assertNotRemoteWebCaller,
  createKosworkWorkspaceService,
  sanitizeLimits
};
