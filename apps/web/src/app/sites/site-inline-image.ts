export const SITE_IMAGE_MAX_BYTES = 64 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10];
const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

/** Inline a bounded, magic-validated image; do not decode or execute its content. */
// prettier-ignore
export function embedSiteImage(html: string, bytes: Uint8Array, alt: string): string {
  if (!bytes.byteLength || bytes.byteLength > SITE_IMAGE_MAX_BYTES) {
    throw new Error("Файл изображения должен быть от 1 байта до 64 КиБ.");
  }
  if (alt.length > 200 || [...alt].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("Описание изображения должно быть до 200 символов без управляющих знаков.");
  }
  const mime = (() => {
    if (PNG_HEADER.every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
    if (
      bytes.length >= 12 &&
      bytes[0] === 82 &&
      bytes[1] === 73 &&
      bytes[2] === 70 &&
      bytes[3] === 70 &&
      bytes[8] === 87 &&
      bytes[9] === 69 &&
      bytes[10] === 66 &&
      bytes[11] === 80
    ) return "image/webp";
    throw new Error("Поддерживаются только PNG, JPEG и WebP. SVG не принимается.");
  })();

  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  const safeAlt = alt.replace(/[&<>"']/g, (character) => escapeMap[character] ?? "");
  const uri = "data:" + mime + ";base64," + btoa(binary);
  const markup = '<img alt="' + safeAlt + '" src="' + uri + '">';
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  const updated =
    bodyClose < 0
      ? html + "\n" + markup
      : html.slice(0, bodyClose) + "\n" + markup + "\n" + html.slice(bodyClose);
  if (new TextEncoder().encode(updated).byteLength > MAX_HTML_BYTES) {
    throw new Error("HTML с изображением превысит 512 КиБ. Уменьшите файл.");
  }
  return updated;
}
