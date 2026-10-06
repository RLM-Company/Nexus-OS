import {
  CHAT_ATTACHMENT_LIMITS,
  imageDimensions,
  isChatFilename,
  type ChatImageAttachment
} from "@cosmora/contracts/chat-attachments";

export const PHOTO_INPUT_LIMITS = { bytes: 20_000_000, edge: 12_000, pixels: 48_000_000 };

export async function prepareChatImage(file: File): Promise<ChatImageAttachment> {
  if (!isChatFilename(file.name)) throw new Error("Недопустимое имя файла.");
  const mediaType = /\.png$/i.test(file.name)
    ? "image/png"
    : /\.jpe?g$/i.test(file.name)
      ? "image/jpeg"
      : null;
  if (!mediaType) throw new Error("Выберите фото PNG/JPEG.");
  if (!file.size || file.size > PHOTO_INPUT_LIMITS.bytes)
    throw new Error("Выберите фото PNG/JPEG до 20 МБ.");
  let bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = imageDimensions(bytes, mediaType);
  if (
    !dimensions ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > PHOTO_INPUT_LIMITS.edge ||
    dimensions.height > PHOTO_INPUT_LIMITS.edge ||
    dimensions.width * dimensions.height > PHOTO_INPUT_LIMITS.pixels
  )
    throw new Error("Нужно PNG/JPEG до 12 000 × 12 000 и 48 миллионов пикселей.");
  let bitmap: ImageBitmap;
  try {
    // Decode directly to a safe working size, including phone EXIF orientation.
    const ratio = Math.min(
      1,
      2800 / Math.max(dimensions.width, dimensions.height),
      Math.sqrt(8_000_000 / (dimensions.width * dimensions.height))
    );
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      resizeWidth: Math.max(1, Math.round(dimensions.width * ratio)),
      resizeQuality: "high"
    });
  } catch {
    throw new Error("Не удалось прочитать изображение. Проверьте PNG/JPEG.");
  }
  let name = file.name;
  let outputType: "image/png" | "image/jpeg" = mediaType;
  try {
    if (
      bytes.length > CHAT_ATTACHMENT_LIMITS.imageBytes ||
      dimensions.width > 4096 ||
      dimensions.height > 4096 ||
      dimensions.width * dimensions.height > 8_000_000
    ) {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Подготовка фото недоступна в этом браузере.");
      // PNG remains PNG (including transparency); JPEG retains the original aspect ratio.
      let blob: Blob | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mediaType, 0.88));
        if (blob && blob.size <= CHAT_ATTACHMENT_LIMITS.imageBytes) break;
        canvas.width = Math.max(1, Math.round(canvas.width * 0.78));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.78));
      }
      if (!blob || blob.size > CHAT_ATTACHMENT_LIMITS.imageBytes)
        throw new Error("Не удалось подготовить фото до 1 МБ. Выберите меньшее изображение.");
      outputType = blob.type === "image/png" ? "image/png" : "image/jpeg";
      name = file.name.replace(/\.(png|jpe?g)$/i, outputType === "image/png" ? ".png" : ".jpg");
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
  } finally {
    bitmap.close();
  }
  const outputDimensions = imageDimensions(bytes, outputType);
  if (
    !outputDimensions ||
    outputDimensions.width > 4096 ||
    outputDimensions.height > 4096 ||
    outputDimensions.width * outputDimensions.height > 8_000_000
  )
    throw new Error("Не удалось подготовить безопасные размеры PNG/JPEG.");
  let raw = "";
  for (let start = 0; start < bytes.length; start += 8192)
    raw += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { kind: "image", name, media_type: outputType, data_base64: btoa(raw) };
}
