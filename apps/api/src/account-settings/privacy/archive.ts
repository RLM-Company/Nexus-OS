import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { OriginalBinary } from "./coordinator.js";

/** Standard ZIP32 STORE (no compression); materialize fully before replying, no partial exports. */
type Entry = { path: string; bytes: Buffer };
const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
export async function verifiedOriginal(
  stream: NodeJS.ReadableStream,
  descriptor: OriginalBinary,
  maxBytes: number
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(descriptor.size_bytes) ||
    descriptor.size_bytes < 0 ||
    descriptor.size_bytes > maxBytes
  )
    throw Error("PRIVACY_ORIGINAL_TOO_LARGE");
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const piece of stream as Readable) {
    const value: unknown = piece;
    if (typeof value !== "string" && !(value instanceof Uint8Array))
      throw Error("PRIVACY_ORIGINAL_INVALID_CHUNK");
    const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
    size += bytes.length;
    if (size > maxBytes || size > descriptor.size_bytes)
      throw Error("PRIVACY_ORIGINAL_TRUNCATED_OR_OVERLIMIT");
    buffers.push(bytes);
  }
  const data = Buffer.concat(buffers, size);
  if (
    size !== descriptor.size_bytes ||
    createHash("sha256").update(data).digest("hex") !== descriptor.sha256.toLowerCase()
  )
    throw Error("PRIVACY_ORIGINAL_HASH_MISMATCH");
  return data;
}
export function createArchive(entries: Entry[], maxBytes: number): Buffer {
  if (entries.length > 4000) throw Error("PRIVACY_TOO_MANY_ORIGINALS");
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0,
    centralSize = 0,
    total = 0;
  for (const entry of entries) {
    if (
      !/^[a-z0-9._/-]+$/i.test(entry.path) ||
      entry.path.startsWith("/") ||
      entry.path.split("/").some((s) => s === ".." || s === "") ||
      entry.path.length > 200
    )
      throw Error("PRIVACY_UNSAFE_ARCHIVE_PATH");
    const name = Buffer.from(entry.path, "utf8");
    const size = entry.bytes.length;
    total += size + name.length * 2 + 76;
    if (total > maxBytes || size > 0xffffffff || offset > 0xffffffff)
      throw Error("PRIVACY_ARCHIVE_OVERLIMIT");
    const crc = crc32(entry.bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(size, 18);
    head.writeUInt32LE(size, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, entry.bytes);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(size, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    centralSize += dir.length + name.length;
    offset += head.length + name.length + size;
  }
  if (entries.length > 65535 || offset + centralSize + 22 > maxBytes)
    throw Error("PRIVACY_ARCHIVE_OVERLIMIT");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
