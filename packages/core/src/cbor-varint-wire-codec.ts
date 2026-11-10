/**
 * LEB128 Unsigned/ZigZag Signed Varint & Deterministic Tag-Length-Value (TLV) Binary Wire Codec.
 * Encodes structured records with sorted keys into compact binary frames with zero JSON overhead.
 */
export class DeterministicBinaryWireCodec {
  public static zigzagEncode(n: number): number {
    const v = Math.trunc(n);
    return ((v << 1) ^ (v >> 31)) >>> 0;
  }

  public static zigzagDecode(z: number): number {
    return (z >>> 1) ^ -(z & 1);
  }

  public static encodeUnsignedVarint(value: number): Uint8Array {
    let v = value >>> 0;
    const bytes: number[] = [];
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v & 0x7f);
    return new Uint8Array(bytes);
  }

  public static decodeUnsignedVarint(
    buffer: Uint8Array,
    offset = 0
  ): { value: number; bytesRead: number } {
    let result = 0;
    let shift = 0;
    let idx = offset;

    while (idx < buffer.length) {
      const byte = buffer[idx++]!;
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return { value: result >>> 0, bytesRead: idx - offset };
      }
      shift += 7;
    }
    throw new Error("TRUNCATED_LEB128_VARINT");
  }

  /**
   * Encodes a flat dictionary of string/integer/boolean primitives into a canonical TLV byte frame.
   * Tags: 1 = string, 2 = zigzag int32, 3 = boolean.
   */
  public static encodeRecord(record: Record<string, string | number | boolean>): Uint8Array {
    const sortedKeys = Object.keys(record).sort();
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();

    chunks.push(DeterministicBinaryWireCodec.encodeUnsignedVarint(sortedKeys.length));

    for (const k of sortedKeys) {
      const keyBytes = encoder.encode(k);
      chunks.push(DeterministicBinaryWireCodec.encodeUnsignedVarint(keyBytes.length));
      chunks.push(keyBytes);

      const val = record[k]!;
      if (typeof val === "string") {
        const strBytes = encoder.encode(val);
        chunks.push(new Uint8Array([1]));
        chunks.push(DeterministicBinaryWireCodec.encodeUnsignedVarint(strBytes.length));
        chunks.push(strBytes);
      } else if (typeof val === "number") {
        chunks.push(new Uint8Array([2]));
        const zz = DeterministicBinaryWireCodec.zigzagEncode(val);
        chunks.push(DeterministicBinaryWireCodec.encodeUnsignedVarint(zz));
      } else {
        chunks.push(new Uint8Array([3, val ? 1 : 0]));
      }
    }

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  public static decodeRecord(buffer: Uint8Array): Record<string, string | number | boolean> {
    const decoder = new TextDecoder();
    let offset = 0;

    const countInfo = DeterministicBinaryWireCodec.decodeUnsignedVarint(buffer, offset);
    offset += countInfo.bytesRead;
    const out: Record<string, string | number | boolean> = {};

    for (let i = 0; i < countInfo.value; i++) {
      const keyLenInfo = DeterministicBinaryWireCodec.decodeUnsignedVarint(buffer, offset);
      offset += keyLenInfo.bytesRead;
      const key = decoder.decode(buffer.subarray(offset, offset + keyLenInfo.value));
      offset += keyLenInfo.value;

      const tag = buffer[offset++]!;
      if (tag === 1) {
        const strLenInfo = DeterministicBinaryWireCodec.decodeUnsignedVarint(buffer, offset);
        offset += strLenInfo.bytesRead;
        out[key] = decoder.decode(buffer.subarray(offset, offset + strLenInfo.value));
        offset += strLenInfo.value;
      } else if (tag === 2) {
        const zzInfo = DeterministicBinaryWireCodec.decodeUnsignedVarint(buffer, offset);
        offset += zzInfo.bytesRead;
        out[key] = DeterministicBinaryWireCodec.zigzagDecode(zzInfo.value);
      } else if (tag === 3) {
        out[key] = buffer[offset++] === 1;
      } else {
        throw new Error(`UNKNOWN_WIRE_TAG: ${tag}`);
      }
    }

    return out;
  }
}
