/** Drop only files through the exact same ChatAttachmentPicker pipeline as the paperclip. */
export function droppedComposerFiles(
  transfer: Pick<DataTransfer, "types" | "files"> | null,
  { disabled, reading, textOnly }: { disabled: boolean; reading: boolean; textOnly: boolean }
): File[] {
  if (!transfer || disabled || reading || !Array.from(transfer.types).includes("Files")) return [];
  const files = Array.from(transfer.files || []).filter(
    (file) => file.name.length > 0 && file.size > 0
  );
  if (textOnly && files.some((file) => /\.(?:png|jpe?g)$/i.test(file.name))) return [];
  return files;
}
