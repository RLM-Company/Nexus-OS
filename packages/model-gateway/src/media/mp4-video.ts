/** Checks the ISO BMFF container and a video track without decoding untrusted media in the API. */
export function isMp4Video(bytes: Uint8Array): boolean {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let boxes = 0;
  let fileType = false;
  let video = false;
  let mediaData = false;
  function walk(start: number, end: number, parent: string): boolean {
    while (start < end) {
      if (++boxes > 2000 || end - start < 8) return false;
      let size = data.getUint32(start);
      const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
      let header = 8;
      if (size === 1) {
        if (end - start < 16 || data.getUint32(start + 8) !== 0) return false;
        size = data.getUint32(start + 12);
        header = 16;
      } else if (size === 0) {
        size = end - start;
      }
      if (size < header || size > end - start) return false;
      const next = start + size;
      const body = start + header;
      if (parent === "" && type === "ftyp" && size - header >= 8) fileType = true;
      if (parent === "" && type === "mdat" && next > body) mediaData = true;
      if (
        parent === "mdia" &&
        type === "hdlr" &&
        size - header >= 12 &&
        data.getUint32(body + 8) === 0x76696465
      )
        video = true;
      if (
        ((parent === "" && type === "moov") ||
          (parent === "moov" && type === "trak") ||
          (parent === "trak" && type === "mdia")) &&
        !walk(body, next, type)
      )
        return false;
      start = next;
    }
    return true;
  }
  return walk(0, bytes.length, "") && fileType && video && mediaData;
}
