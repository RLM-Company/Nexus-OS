export interface ChatTextAttachment {
  name: string;
  content: string;
}

export const CHAT_ATTACHMENT_LIMITS = {
  files: 4,
  charactersPerFile: 8_000,
  charactersTotal: 24_000,
  bytesPerFile: 32_000,
  bytesTotal: 24_000
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
  name.length > 0 &&
  name.length <= 160 &&
  !/[\\/]/.test(name) &&
  !hasDisallowedControls(name) &&
  CHAT_TEXT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(`.${extension}`));

export const isValidChatAttachments = (attachments: readonly ChatTextAttachment[]): boolean =>
  attachments.length <= CHAT_ATTACHMENT_LIMITS.files &&
  attachments.reduce((total, file) => total + file.content.length, 0) <=
    CHAT_ATTACHMENT_LIMITS.charactersTotal &&
  attachments.reduce((total, file) => total + new TextEncoder().encode(file.content).length, 0) <=
    CHAT_ATTACHMENT_LIMITS.bytesTotal &&
  attachments.every(
    (file) =>
      isChatTextFilename(file.name) &&
      file.content.length > 0 &&
      file.content.length <= CHAT_ATTACHMENT_LIMITS.charactersPerFile &&
      !hasDisallowedControls(file.content, true)
  );
