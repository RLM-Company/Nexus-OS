/** Textareas expose LF offsets. Recover a literal slice of the saved source, including CRLF. */
export function sourceSelectionExcerpt(text: string, start: number, end: number): string {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start)
    throw new Error("Выделите непустой фрагмент в тексте источника.");
  const boundaries = [0];
  for (let index = 0; index < text.length;) {
    index += text[index] === "\r" && text[index + 1] === "\n" ? 2 : 1;
    boundaries.push(index);
  }
  const from = boundaries[start],
    to = boundaries[end];
  if (from === undefined || to === undefined)
    throw new Error("Выделение выходит за границы источника.");
  const splitsSurrogate = (index: number) =>
    index > 0 &&
    index < text.length &&
    /[\uD800-\uDBFF]/.test(text[index - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[index]!);
  if (splitsSurrogate(from) || splitsSurrogate(to)) throw new Error("Выделите символ целиком.");
  const quote = text.slice(from, to);
  if (!quote.trim() || quote.length > 1000)
    throw new Error("Выберите фрагмент с текстом длиной до 1000 символов.");
  return quote;
}

export const sourceSelectionText = (text: string): string => text.replace(/\r\n?/g, "\n");
