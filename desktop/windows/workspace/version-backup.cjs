"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { writeAtomicJson } = require("../desktop-state.cjs");
const { ERROR_CODES, KosworkWorkspaceError, throwIfAborted } = require("./errors.cjs");
const { assertNotReparseOrSymlink } = require("./path-guard.cjs");

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const CHUNK_BYTES = 64 * 1024;

function computeBufferVersion(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), "utf8");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  return {
    sha256,
    version: `sha256:${sha256}`,
    size: buf.byteLength
  };
}

function normalizeExpectedSha256(expected) {
  if (typeof expected !== "string" || expected.trim() === "") return null;
  const trimmed = expected.trim().toLowerCase();
  const raw = trimmed.startsWith("sha256:") ? trimmed.slice(7) : trimmed;
  if (!/^[0-9a-f]{64}$/.test(raw)) return null;
  return raw;
}

function versionsMatch(actualSha256, expectedInput) {
  const expectedHex = normalizeExpectedSha256(expectedInput);
  if (!expectedHex || typeof actualSha256 !== "string" || actualSha256.length !== 64) {
    return false;
  }
  const actualBuf = Buffer.from(actualSha256.toLowerCase(), "utf8");
  const expectedBuf = Buffer.from(expectedHex, "utf8");
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function decodeStrictUtf8Text(buffer, relativePath = "") {
  if (!Buffer.isBuffer(buffer)) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_BINARY_FILE,
      "Ожидался бинарный буфер для декодирования UTF-8."
    );
  }
  // Reject NUL bytes (binary files)
  if (buffer.includes(0x00)) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_BINARY_FILE,
      `Файл "${relativePath}" является бинарным (содержит нулевые байты) и не может быть прочитан как текст.`,
      { path: relativePath }
    );
  }
  try {
    return fatalUtf8Decoder.decode(buffer);
  } catch {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_BINARY_FILE,
      `Файл "${relativePath}" содержит некорректную последовательность UTF-8 и не может быть открыт как текстовый.`,
      { path: relativePath }
    );
  }
}

function readBoundedFileSnapshot(
  absolutePath,
  { relativePath = "", maxBytes, signal = null, activeController = null } = {}
) {
  throwIfAborted(signal, activeController);

  let lstat;
  try {
    lstat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_FOUND,
        `Файл "${relativePath}" не найден.`
      );
    }
    throw error;
  }

  assertNotReparseOrSymlink(absolutePath, lstat);
  if (lstat.isDirectory()) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_NOT_A_FILE,
      `Путь "${relativePath}" указывает на папку, а не на файл.`
    );
  }
  if (!lstat.isFile()) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_NOT_A_FILE,
      `Путь "${relativePath}" не является обычным файлом.`
    );
  }
  if (Number.isFinite(maxBytes) && lstat.size > maxBytes) {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_FILE_TOO_LARGE,
      `Размер файла "${relativePath}" (${lstat.size} байт) превышает допустимый лимит ${maxBytes} байт.`,
      { path: relativePath, size: lstat.size, maxBytes }
    );
  }

  const openFlags =
    fs.constants.O_RDONLY | (typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0);
  let fd;
  try {
    fd = fs.openSync(absolutePath, openFlags);
  } catch (error) {
    if (error && (error.code === "ELOOP" || error.code === "EPERM")) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
        `Отказано в открытии ссылки "${relativePath}".`
      );
    }
    throw error;
  }

  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile() || (lstat.ino && fstat.ino && lstat.ino !== fstat.ino)) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
        `Файл "${relativePath}" был подменён во время открытия.`
      );
    }
    if (Number.isFinite(maxBytes) && fstat.size > maxBytes) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_FILE_TOO_LARGE,
        `Размер файла "${relativePath}" (${fstat.size} байт) превышает лимит ${maxBytes} байт.`,
        { path: relativePath, size: fstat.size, maxBytes }
      );
    }

    const chunks = [];
    let totalRead = 0;
    const tempBuf = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, Math.max(1024, (maxBytes || CHUNK_BYTES) + 1)));

    for (;;) {
      throwIfAborted(signal, activeController);
      const bytesRead = fs.readSync(fd, tempBuf, 0, tempBuf.length, totalRead);
      if (bytesRead === 0) break;
      totalRead += bytesRead;
      if (Number.isFinite(maxBytes) && totalRead > maxBytes) {
        throw new KosworkWorkspaceError(
          ERROR_CODES.WORKSPACE_FILE_TOO_LARGE,
          `Файл "${relativePath}" вырос сверх лимита ${maxBytes} байт во время чтения.`,
          { path: relativePath, maxBytes }
        );
      }
      chunks.push(Buffer.from(tempBuf.subarray(0, bytesRead)));
    }

    const afterStat = fs.fstatSync(fd);
    if (afterStat.mtimeMs !== fstat.mtimeMs || afterStat.size !== totalRead) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
        `Файл "${relativePath}" был конкурентно изменён другим процессом во время чтения.`
      );
    }

    const buffer = Buffer.concat(chunks, totalRead);
    const { sha256, version } = computeBufferVersion(buffer);
    return {
      buffer,
      size: totalRead,
      mtimeMs: fstat.mtimeMs,
      ino: fstat.ino,
      dev: fstat.dev,
      sha256,
      version
    };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore close errors */
    }
  }
}

function createBackupStore(
  backupDirectory,
  {
    maxBackups = 50,
    maxTotalBackupBytes = 25 * 1024 * 1024,
    now = () => Date.now()
  } = {}
) {
  const indexFile = path.join(backupDirectory, "index.json");
  const blobsDir = path.join(backupDirectory, "blobs");

  function ensureStorage() {
    fs.mkdirSync(blobsDir, { recursive: true, mode: 0o700 });
    const lstat = fs.lstatSync(backupDirectory);
    if (lstat.isSymbolicLink()) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_SYMLINK_REJECTED,
        "Каталог резервных копий не может быть символической ссылкой."
      );
    }
  }

  function readIndex() {
    try {
      const raw = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (raw?.schemaVersion === 1 && Array.isArray(raw.items)) {
        return raw.items;
      }
    } catch {
      /* empty or absent index */
    }
    return [];
  }

  function writeIndex(items) {
    ensureStorage();
    writeAtomicJson(indexFile, {
      schemaVersion: 1,
      updatedAt: new Date(now()).toISOString(),
      items
    });
  }

  function saveBackup({ relativePath, buffer, sha256, version, originalMtimeMs }) {
    if (buffer.byteLength > maxTotalBackupBytes) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_LIMIT_EXCEEDED,
        "Файл слишком велик для сохранения в локальное хранилище резервных копий.",
        { size: buffer.byteLength, maxTotalBackupBytes }
      );
    }
    ensureStorage();
    const backupId = `bkp_${now()}_${crypto.randomBytes(6).toString("hex")}`;
    const blobFilename = `${backupId}.bak`;
    const blobPath = path.join(blobsDir, blobFilename);
    fs.writeFileSync(blobPath, buffer, { mode: 0o600, flag: "wx" });

    // Verify stored backup integrity before proceeding with file replacement
    const writtenBytes = fs.readFileSync(blobPath);
    const writtenVersion = computeBufferVersion(writtenBytes);
    if (writtenVersion.sha256 !== sha256) {
      try {
        fs.unlinkSync(blobPath);
      } catch {
        /* ignore */
      }
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
        "Не удалось подтвердить целостность резервной копии перед обновлением файла."
      );
    }

    const entry = {
      backupId,
      relativePath,
      sha256,
      version,
      size: buffer.byteLength,
      originalMtimeMs,
      createdAt: new Date(now()).toISOString(),
      blobFilename
    };

    const existing = readIndex();
    const updated = [entry, ...existing];
    const retained = [];
    let totalBytes = 0;

    for (const item of updated) {
      if (retained.length < maxBackups && totalBytes + item.size <= maxTotalBackupBytes) {
        retained.push(item);
        totalBytes += item.size;
      } else {
        try {
          fs.unlinkSync(path.join(blobsDir, item.blobFilename));
        } catch {
          /* already pruned */
        }
      }
    }

    writeIndex(retained);
    return {
      backupId: entry.backupId,
      relativePath: entry.relativePath,
      sha256: entry.sha256,
      version: entry.version,
      size: entry.size,
      originalMtimeMs: entry.originalMtimeMs,
      createdAt: entry.createdAt
    };
  }

  function listBackups(relativePath = null) {
    const items = readIndex();
    const filtered =
      typeof relativePath === "string" && relativePath.trim() !== ""
        ? items.filter((item) => item.relativePath === relativePath)
        : items;
    return filtered.map(({ blobFilename: _blob, ...publicEntry }) => ({ ...publicEntry }));
  }

  function readBackup(backupId) {
    if (typeof backupId !== "string" || !/^bkp_\d+_[0-9a-f]{12}$/.test(backupId)) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_INVALID_ARGUMENT,
        "Некорректный идентификатор резервной копии."
      );
    }
    const entry = readIndex().find((item) => item.backupId === backupId);
    if (!entry) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_FOUND,
        `Резервная копия "${backupId}" не найдена.`
      );
    }
    const blobPath = path.join(blobsDir, entry.blobFilename);
    let buffer;
    try {
      const lstat = fs.lstatSync(blobPath);
      assertNotReparseOrSymlink(blobPath, lstat);
      buffer = fs.readFileSync(blobPath);
    } catch (error) {
      if (error instanceof KosworkWorkspaceError) throw error;
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_FOUND,
        `Файл резервной копии "${backupId}" отсутствует на диске.`
      );
    }
    const check = computeBufferVersion(buffer);
    if (check.sha256 !== entry.sha256) {
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_VERSION_CONFLICT,
        `Контрольная сумма резервной копии "${backupId}" повреждена.`
      );
    }
    return {
      ...entry,
      buffer
    };
  }

  function purgeAll() {
    try {
      fs.rmSync(backupDirectory, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return {
    saveBackup,
    listBackups,
    readBackup,
    purgeAll
  };
}

module.exports = {
  computeBufferVersion,
  createBackupStore,
  decodeStrictUtf8Text,
  normalizeExpectedSha256,
  readBoundedFileSnapshot,
  versionsMatch
};
