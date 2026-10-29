"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
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
    fs.constants.O_RDONLY |
    (typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0);
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
    const tempBuf = Buffer.allocUnsafe(
      Math.min(CHUNK_BYTES, Math.max(1024, (maxBytes || CHUNK_BYTES) + 1))
    );

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
  { maxBackups = 50, maxTotalBackupBytes = 25 * 1024 * 1024, now = Date.now, codec = null } = {}
) {
  backupDirectory = path.resolve(backupDirectory);
  const indexFile = path.join(backupDirectory, "index.json"),
    blobsDir = path.join(backupDirectory, "blobs");
  const scope = crypto.createHash("sha256").update(backupDirectory).digest("hex");
  const bad = () => {
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_BACKUP_UNAVAILABLE,
      "Резервные копии недоступны или повреждены."
    );
  };
  const idPattern = /^bkp_\d{1,16}_[0-9a-f]{12}$/;
  function directory(target, create = false) {
    const parsed = path.parse(target);
    let current = parsed.root;
    for (const part of path.relative(parsed.root, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code !== "ENOENT") bad();
        if (!create) return false;
        fs.mkdirSync(current, { mode: 0o700 });
        stat = fs.lstatSync(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) bad();
      assertNotReparseOrSymlink(current, stat);
    }
    return true;
  }
  function regular(file, maximum) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum) bad();
    return stat;
  }
  function encode(value) {
    const plain = JSON.stringify({ scope, ...value });
    return codec ? JSON.stringify({ sealed: codec.seal(plain) }) : plain;
  }
  function decode(text) {
    const outer = JSON.parse(text),
      data = codec ? JSON.parse(codec.open(outer.sealed)) : outer;
    if (data.scope !== scope) bad();
    return data;
  }
  function readIndex() {
    if (!directory(backupDirectory)) return [];
    try {
      regular(indexFile, 256000);
      const data = decode(fs.readFileSync(indexFile, "utf8"));
      if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > maxBackups)
        bad();
      const ids = new Set();
      let total = 0;
      return data.items.map((item) => {
        if (
          !item ||
          !idPattern.test(item.backupId) ||
          ids.has(item.backupId) ||
          item.blobFilename !== item.backupId + ".bak" ||
          typeof item.relativePath !== "string" ||
          item.relativePath.length > 512 ||
          !/^[a-f0-9]{64}$/.test(item.sha256) ||
          item.version !== "sha256:" + item.sha256 ||
          !Number.isSafeInteger(item.size) ||
          item.size < 0 ||
          !Number.isFinite(item.originalMtimeMs) ||
          typeof item.createdAt !== "string"
        )
          bad();
        require("./path-guard.cjs").validateRelativePath(item.relativePath);
        total += item.size;
        if (total > maxTotalBackupBytes) bad();
        ids.add(item.backupId);
        return {
          backupId: item.backupId,
          blobFilename: item.blobFilename,
          relativePath: item.relativePath,
          sha256: item.sha256,
          version: item.version,
          size: item.size,
          originalMtimeMs: item.originalMtimeMs,
          createdAt: item.createdAt
        };
      });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      bad();
    }
  }
  function writeIndex(items) {
    directory(blobsDir, true);
    const temporary = path.join(backupDirectory, crypto.randomUUID() + ".tmp");
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, encode({ schemaVersion: 1, items }), "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, indexFile);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  function unlinkBlob(name) {
    if (!/^bkp_\d{1,16}_[0-9a-f]{12}\.bak$/.test(name) || !directory(blobsDir)) bad();
    const file = path.join(blobsDir, name);
    // Only this generated basename inside the checked directory; never recurse.
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) bad();
    fs.unlinkSync(file);
  }
  function saveBackup({ relativePath, buffer, sha256, version, originalMtimeMs }) {
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length > maxTotalBackupBytes ||
      computeBufferVersion(buffer).sha256 !== sha256 ||
      version !== "sha256:" + sha256
    )
      bad();
    require("./path-guard.cjs").validateRelativePath(relativePath);
    const existing = readIndex();
    directory(blobsDir, true);
    // Remove orphan generated blobs from an earlier interrupted index commit.
    const known = new Set(existing.map((item) => item.blobFilename));
    for (const name of fs.readdirSync(blobsDir))
      if (/^bkp_\d{1,16}_[0-9a-f]{12}\.bak$/.test(name) && !known.has(name)) unlinkBlob(name);
    const backupId = "bkp_" + now() + "_" + crypto.randomBytes(6).toString("hex"),
      blobFilename = backupId + ".bak";
    const entry = {
      backupId,
      blobFilename,
      relativePath,
      sha256,
      version,
      size: buffer.length,
      originalMtimeMs,
      createdAt: new Date(now()).toISOString()
    };
    const encoded = codec ? encode({ backupId, bytes: buffer.toString("base64") }) : buffer;
    let fd;
    try {
      fd = fs.openSync(path.join(blobsDir, blobFilename), "wx", 0o600);
      fs.writeFileSync(fd, encoded);
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const retained = [];
    let bytes = 0;
    for (const item of [entry, ...existing])
      if (retained.length < maxBackups && bytes + item.size <= maxTotalBackupBytes) {
        retained.push(item);
        bytes += item.size;
      }
    try {
      writeIndex(retained);
    } catch (error) {
      unlinkBlob(blobFilename);
      throw error;
    }
    readBackup(backupId);
    for (const item of existing) if (!retained.includes(item)) unlinkBlob(item.blobFilename);
    return { ...entry, blobFilename: undefined };
  }
  function listBackups(relativePath = null) {
    return readIndex()
      .filter((item) => relativePath === null || item.relativePath === relativePath)
      .map(({ blobFilename, ...item }) => item);
  }
  function readBackup(backupId) {
    if (typeof backupId !== "string" || !idPattern.test(backupId)) bad();
    const entry = readIndex().find((item) => item.backupId === backupId);
    if (!entry)
      throw new KosworkWorkspaceError(
        ERROR_CODES.WORKSPACE_NOT_FOUND,
        "Резервная копия не найдена."
      );
    if (!directory(blobsDir)) bad();
    const file = path.join(blobsDir, entry.blobFilename);
    regular(file, maxTotalBackupBytes * 3 + 8192);
    let buffer;
    try {
      const bytes = fs.readFileSync(file);
      if (codec) {
        const data = decode(bytes.toString("utf8"));
        if (data.backupId !== backupId || typeof data.bytes !== "string") bad();
        buffer = Buffer.from(data.bytes, "base64");
      } else buffer = bytes;
      if (buffer.length !== entry.size || computeBufferVersion(buffer).sha256 !== entry.sha256)
        bad();
    } catch {
      bad();
    }
    return { ...entry, buffer };
  }
  function purgeAll() {
    if (!directory(backupDirectory)) return;
    if (directory(blobsDir)) {
      for (const name of fs.readdirSync(blobsDir))
        if (/^bkp_\d{1,16}_[0-9a-f]{12}\.bak$/.test(name)) unlinkBlob(name);
      if (fs.readdirSync(blobsDir).length === 0) fs.rmdirSync(blobsDir);
    }
    for (const name of fs.readdirSync(backupDirectory))
      if (name === "index.json" || /^[a-f0-9-]{36}\.tmp$/.test(name)) {
        const file = path.join(backupDirectory, name);
        regular(file, Number.MAX_SAFE_INTEGER);
        fs.unlinkSync(file);
      }
    if (fs.readdirSync(backupDirectory).length === 0) fs.rmdirSync(backupDirectory);
  }
  return { saveBackup, listBackups, readBackup, purgeAll };
}

module.exports = {
  computeBufferVersion,
  createBackupStore,
  decodeStrictUtf8Text,
  normalizeExpectedSha256,
  readBoundedFileSnapshot,
  versionsMatch
};
