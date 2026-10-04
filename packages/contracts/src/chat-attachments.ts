export interface ChatTextAttachment {
  name: string;
  content: string;
  source_type?: "pdf" | "docx";
}

export interface ChatImageAttachment {
  kind: "image";
  name: string;
  media_type: "image/png" | "image/jpeg";
  data_base64: string;
}
export type ChatAttachment = ChatTextAttachment | ChatImageAttachment;

export const CHAT_ATTACHMENT_LIMITS = {
  files: 4,
  charactersPerFile: 8_000,
  charactersTotal: 24_000,
  bytesPerFile: 32_000,
  bytesTotal: 24_000,
  documentBytes: 2_000_000,
  imageBytes: 1_000_000,
  imageCount: 2,
  imageTokens: 4_096
} as const;

export const CHAT_TEXT_EXTENSIONS = [
  "txt",
  "md",
  "csv",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "sql",
  "sh",
  "ps1",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "kt",
  "log",
  "ini"
] as const;

const hasDisallowedControls = (value: string, allowTextWhitespace = false): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127 || (code < 32 && !(allowTextWhitespace && [9, 10, 13].includes(code))))
      return true;
  }
  return false;
};

export const isChatTextFilename = (name: string): boolean =>
  isChatFilename(name) &&
  CHAT_TEXT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(`.${extension}`));

export const isChatFilename = (name: string): boolean =>
  name.length > 0 && name.length <= 160 && !/[\\/]/.test(name) && !hasDisallowedControls(name);

export const imageDimensions = (
  bytes: Uint8Array,
  mediaType: "image/png" | "image/jpeg"
): { width: number; height: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mediaType === "image/png") {
    if (
      bytes.length < 24 ||
      [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
    )
      return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++]!;
    if (marker === 217 || marker === 218) return null;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) return null;
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += length;
  }
  return null;
};

const validImage = (file: ChatImageAttachment): boolean => {
  if (
    !isChatFilename(file.name) ||
    file.kind !== "image" ||
    !(file.media_type === "image/png"
      ? /\.png$/i.test(file.name)
      : file.media_type === "image/jpeg" && /\.jpe?g$/i.test(file.name)) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data_base64) ||
    file.data_base64.length > Math.ceil(CHAT_ATTACHMENT_LIMITS.imageBytes / 3) * 4
  )
    return false;
  try {
    const raw = atob(file.data_base64);
    if (raw.length > CHAT_ATTACHMENT_LIMITS.imageBytes) return false;
    const dimensions = imageDimensions(
      Uint8Array.from(raw, (character) => character.charCodeAt(0)),
      file.media_type
    );
    return (
      dimensions !== null &&
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      dimensions.width <= 4096 &&
      dimensions.height <= 4096 &&
      dimensions.width * dimensions.height <= 8_000_000
    );
  } catch {
    return false;
  }
};

export const attachmentContextSize = (file: ChatAttachment): number =>
  "content" in file
    ? new TextEncoder().encode(file.content).length
    : CHAT_ATTACHMENT_LIMITS.imageTokens;

export const sameChatAttachments = (
  left: readonly ChatAttachment[],
  right: readonly ChatAttachment[]
): boolean =>
  left.length === right.length &&
  left.every((file, index) => {
    const other = right[index]!;
    if (file.name !== other.name) return false;
    return "content" in file && "content" in other
      ? file.content === other.content && file.source_type === other.source_type
      : "data_base64" in file &&
          "data_base64" in other &&
          file.data_base64 === other.data_base64 &&
          file.media_type === other.media_type;
  });

export const isValidChatAttachments = (attachments: readonly ChatAttachment[]): boolean =>
  attachments.length <= CHAT_ATTACHMENT_LIMITS.files &&
  attachments.filter((file) => "data_base64" in file).length <= CHAT_ATTACHMENT_LIMITS.imageCount &&
  attachments.reduce((total, file) => total + attachmentContextSize(file), 0) <=
    CHAT_ATTACHMENT_LIMITS.bytesTotal &&
  attachments.every((file) =>
    "data_base64" in file
      ? validImage(file)
      : ((file.source_type === undefined && isChatTextFilename(file.name)) ||
          (isChatFilename(file.name) &&
            (file.source_type === "pdf" || file.source_type === "docx") &&
            file.name.toLowerCase().endsWith(`.${file.source_type}`))) &&
        file.content.length > 0 &&
        file.content.length <= CHAT_ATTACHMENT_LIMITS.charactersPerFile &&
        !hasDisallowedControls(file.content, true)
  );
