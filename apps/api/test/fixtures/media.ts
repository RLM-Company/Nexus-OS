/** Deterministic PCM bytes; never sent to a paid provider by tests. */
export function pcmWav(seconds = 0.2, metadata = false): Buffer {
  const length = Math.ceil(seconds * 8000) * 2;
  const extra = metadata ? 12 : 0;
  const bytes = Buffer.alloc(44 + extra + length);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8);
  if (metadata) {
    bytes.write("JUNK", 12);
    bytes.writeUInt32LE(4, 16);
  }
  const start = 12 + extra;
  bytes.write("fmt ", start);
  bytes.writeUInt32LE(16, start + 4);
  bytes.writeUInt16LE(1, start + 8);
  bytes.writeUInt16LE(1, start + 10);
  bytes.writeUInt32LE(8000, start + 12);
  bytes.writeUInt32LE(16000, start + 16);
  bytes.writeUInt16LE(2, start + 20);
  bytes.writeUInt16LE(16, start + 22);
  bytes.write("data", start + 24);
  bytes.writeUInt32LE(length, start + 28);
  return bytes;
}
