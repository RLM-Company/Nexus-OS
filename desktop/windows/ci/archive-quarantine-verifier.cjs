"use strict";

/**
 * Pre-extraction Binary Archive Inspector & Quarantine Guard for Windows Desktop Vault.
 * Scans ZIP Central Directory headers before extraction to block:
 * - Zip-Slip path traversal (`../`, `..\\`, absolute paths, Windows drive letters `C:\`)
 * - Zip-Bomb compression ratios (> maxCompressionRatio, default 100:1) or total uncompressed size overflow
 * - Symlink / dangerous executable payloads embedded inside archives
 */

const EOCD_SIGNATURE = 0x06054b50;
const CDFH_SIGNATURE = 0x02014b50;

function inspectZipArchiveSafety(zipBuffer, options = {}) {
  const maxTotalUncompressedBytes = options.maxTotalUncompressedBytes ?? 50 * 1024 * 1024; // 50 MB
  const maxEntryCount = options.maxEntryCount ?? 1000;
  const maxCompressionRatio = options.maxCompressionRatio ?? 100;

  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    return {
      safe: false,
      violations: ["INVALID_ZIP_BUFFER: buffer is too small to contain an End of Central Directory record"],
      entries: []
    };
  }

  // Locate End of Central Directory (EOCD) scanning backwards up to 65KB
  let eocdOffset = -1;
  const minSearchOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minSearchOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return {
      safe: false,
      violations: ["MISSING_EOCD_RECORD: archive is truncated or not a valid ZIP file"],
      entries: []
    };
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  const violations = [];
  if (totalEntries > maxEntryCount) {
    violations.push(`ENTRY_COUNT_EXCEEDED: ${totalEntries} entries > limit ${maxEntryCount}`);
  }
  if (centralDirOffset + centralDirSize > eocdOffset) {
    violations.push("CORRUPT_CENTRAL_DIRECTORY: directory bounds overlap EOCD");
    return { safe: false, violations, entries: [] };
  }

  const entries = [];
  let ptr = centralDirOffset;
  let cumulativeUncompressed = 0;

  for (let idx = 0; idx < totalEntries && ptr + 46 <= eocdOffset; idx++) {
    const sig = zipBuffer.readUInt32LE(ptr);
    if (sig !== CDFH_SIGNATURE) {
      violations.push(`INVALID_CDFH_SIGNATURE at entry #${idx}`);
      break;
    }

    const versionMadeBy = zipBuffer.readUInt16LE(ptr + 4);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(ptr + 24);
    const fileNameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const externalAttrs = zipBuffer.readUInt32LE(ptr + 38);

    const fileName = zipBuffer.toString("utf8", ptr + 46, ptr + 46 + fileNameLen);
    ptr += 46 + fileNameLen + extraLen + commentLen;

    cumulativeUncompressed += uncompressedSize;
    const ratio = compressedSize > 0 ? uncompressedSize / compressedSize : uncompressedSize > 0 ? Infinity : 1;

    // Check UNIX symlink mode ((externalAttrs >>> 16) & 0o170000) === 0o120000
    const unixMode = (externalAttrs >>> 16) & 0o170000;
    const isSymlink = (versionMadeBy >>> 8) === 3 && unixMode === 0o120000;

    // Check Zip-Slip path traversal
    const normalized = fileName.replace(/\\/g, "/");
    const segments = normalized.split("/");
    const hasDotDot = segments.includes("..");
    const isAbsolute = normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized);

    if (hasDotDot || isAbsolute) {
      violations.push(`ZIP_SLIP_PATH_TRAVERSAL: '${fileName}'`);
    }
    if (isSymlink) {
      violations.push(`SYMLINK_ENTRY_BLOCKED: '${fileName}'`);
    }
    if (ratio > maxCompressionRatio && uncompressedSize > 4096) {
      violations.push(
        `ZIP_BOMB_RATIO_EXCEEDED: '${fileName}' has compression ratio ${ratio.toFixed(1)}:1 > ${maxCompressionRatio}:1`
      );
    }
    if (/\.(exe|bat|cmd|ps1|vbs|scr|dll|sys|lnk)$/i.test(fileName)) {
      violations.push(`DANGEROUS_EXECUTABLE_ENTRY: '${fileName}'`);
    }

    entries.push({
      fileName,
      compressedSize,
      uncompressedSize,
      compressionRatio: Number(ratio.toFixed(2)),
      isSymlink
    });
  }

  if (cumulativeUncompressed > maxTotalUncompressedBytes) {
    violations.push(
      `TOTAL_UNCOMPRESSED_SIZE_EXCEEDED: ${cumulativeUncompressed} bytes > ${maxTotalUncompressedBytes}`
    );
  }

  return {
    safe: violations.length === 0,
    totalEntries,
    totalUncompressedBytes: cumulativeUncompressed,
    violations,
    entries
  };
}

/**
 * Helper to build a synthetic ZIP buffer in-memory with custom entries for testing quarantine rules.
 */
function buildSyntheticZipCentralDirBuffer(entriesSpec = []) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  for (const item of entriesSpec) {
    const nameBuf = Buffer.from(item.fileName, "utf8");
    const compSize = item.compressedSize ?? 32;
    const uncompSize = item.uncompressedSize ?? 32;
    const isSymlink = Boolean(item.isSymlink);
    const payload = Buffer.alloc(compSize, 0x41);

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(compSize, 18);
    lfh.writeUInt32LE(uncompSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(lfh, 30);

    const cdfh = Buffer.alloc(46 + nameBuf.length);
    cdfh.writeUInt32LE(CDFH_SIGNATURE, 0);
    cdfh.writeUInt16LE(isSymlink ? (3 << 8) | 20 : 20, 4); // versionMadeBy: UNIX (3) if symlink
    cdfh.writeUInt16LE(20, 6);
    cdfh.writeUInt32LE(compSize, 20);
    cdfh.writeUInt32LE(uncompSize, 24);
    cdfh.writeUInt16LE(nameBuf.length, 28);
    if (isSymlink) {
      cdfh.writeUInt32LE((0o120777 << 16) >>> 0, 38);
    }
    cdfh.writeUInt32LE(localOffset, 42);
    nameBuf.copy(cdfh, 46);

    localChunks.push(lfh, payload);
    centralChunks.push(cdfh);
    localOffset += lfh.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entriesSpec.length, 8);
  eocd.writeUInt16LE(entriesSpec.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

module.exports = {
  inspectZipArchiveSafety,
  buildSyntheticZipCentralDirBuffer
};
