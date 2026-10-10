import { strToU8, zipSync } from "fflate";
import type { LibrarySearchHit } from "./studio-files-library-client";

// XML 1.0 explicitly permits TAB/LF/CR; other control characters are rejected.
const xml = (value: string) =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "\ufffd")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function reportLines(question: string, hits: readonly LibrarySearchHit[]): string[] {
  return [
    "Kosmora — отчёт по источникам",
    `Запрос: ${question}`,
    "Результат: релевантные фрагменты. Это поисковая подборка, не ответ генеративной модели.",
    "",
    ...(hits.length
      ? hits.flatMap((hit, index) => [`${index + 1}. [${hit.citation}]`, hit.content, ""])
      : ["Совпадения не найдены."])
  ];
}

export type AnswerReport = {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  error_code: string | null;
  citations: string[];
  sources: Array<{
    ref: string;
    name: string;
    page: number | null;
    line_start: number;
    line_end: number;
    content: string;
  }>;
};
/** This mode exports the ACTUAL saved model answer and the exact evidence snapshot. */
export function answerReportLines(answer: AnswerReport): string[] {
  return [
    "Kosmora — ответ модели с источниками",
    `Вопрос: ${answer.question}`,
    `Статус: ${answer.status}`,
    "Ссылки и дословные цитаты сверены с выбранными фрагментами;",
    "смысловая достоверность остальных интерпретаций модели автоматически не доказана.",
    "",
    "ОТВЕТ МОДЕЛИ",
    answer.answer ?? "Ответ ещё не получен.",
    "",
    "ИСТОЧНИКИ",
    ...answer.sources
      .filter((s) => answer.citations.includes(s.ref))
      .flatMap((s) => [
        `[${s.ref}] ${s.name}${s.page === null ? "" : `, стр. ${s.page}`}, строки ${s.line_start}–${s.line_end}`,
        s.content,
        ""
      ])
  ];
}
export function createAnswerCsvReport(answer: AnswerReport): Blob {
  const esc = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  const rows: string[][] = [
    ["Тип", "Вопрос", "Ответ", "Источник", "Страница", "Фрагмент"],
    ["Ответ модели", answer.question, answer.answer ?? "", "", "", ""],
    ...answer.sources
      .filter((s) => answer.citations.includes(s.ref))
      .map((s) => [
        "Источник",
        answer.question,
        "",
        `${s.name}, строки ${s.line_start}–${s.line_end}`,
        String(s.page ?? ""),
        s.content
      ])
  ];
  return new Blob(["\ufeff", rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n"], {
    type: "text/csv;charset=utf-8"
  });
}

export function createCsvReport(hits: readonly LibrarySearchHit[]): Blob {
  const escape = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
  const rows = [
    ["Файл", "Страница", "Начало строки", "Конец строки", "Цитата", "Фрагмент"],
    ...hits.map((hit) => [
      hit.name,
      String(hit.page ?? ""),
      String(hit.line_start),
      String(hit.line_end),
      hit.citation,
      hit.content
    ])
  ];
  // UTF-8 BOM makes the file Excel-friendly, while CRLF is RFC-4180 compatible.
  return new Blob(["\ufeff", rows.map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n"], {
    type: "text/csv;charset=utf-8"
  });
}

export function createDocxReport(lines: readonly string[]): Blob {
  const paragraphs = lines
    .flatMap((line) => line.split("\n"))
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`)
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "word/document.xml": document
  };
  return new Blob(
    [
      new Uint8Array(
        zipSync(
          Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])),
          { level: 6 }
        )
      )
    ],
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
  );
}

/** Browser-based, self-contained PDF pages with embedded JPEG raster text (not OCR/searchable). */
export async function createPdfReport(lines: readonly string[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const binary = (data: string) => encoder.encode(data);
  const canvas = document.createElement("canvas");
  canvas.width = 1190;
  canvas.height = 1684;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Недоступен Canvas для PDF.");
  const images: Uint8Array[] = [];
  const paint = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111111";
    ctx.font = "28px Arial, sans-serif";
    ctx.textBaseline = "top";
  };
  const savePage = async () => {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Не удалось создать страницу PDF."))),
        "image/jpeg",
        0.88
      )
    );
    images.push(new Uint8Array(await blob.arrayBuffer()));
  };
  paint();
  let y = 95;
  for (const paragraph of lines) {
    const segments = paragraph ? paragraph.split(/\s+/u) : [""];
    let line = "";
    const flush = async () => {
      if (y > 1550) {
        await savePage();
        paint();
        y = 95;
      }
      ctx.fillText(line, 90, y);
      y += 40;
      line = "";
    };
    for (const word of segments) {
      // Split words with no whitespace instead of clipping long URLs/CSV cells.
      if (ctx.measureText(word).width > 1000) {
        if (line) await flush();
        let fragment = "";
        for (const char of word) {
          if (ctx.measureText(fragment + char).width > 1000) {
            line = fragment;
            await flush();
            fragment = "";
          }
          fragment += char;
        }
        line = fragment;
      } else if (ctx.measureText(`${line} ${word}`).width > 1000) {
        await flush();
        line = word;
      } else line += (line ? " " : "") + word;
    }
    await flush();
    y += 14;
  }
  await savePage();
  const objects: Uint8Array[] = [];
  const obj = (content: Uint8Array | string) => {
    objects.push(typeof content === "string" ? binary(content) : content);
    return objects.length;
  };
  const catalogId = obj("");
  const pagesId = obj("");
  const pageIds: number[] = [];
  for (const jpeg of images) {
    const imageId = obj(
      concat([
        binary(
          `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
        ),
        jpeg,
        binary("\nendstream")
      ])
    );
    const stream = binary("q 595 0 0 842 0 0 cm /Im1 Do Q");
    const contentId = obj(
      concat([binary(`<< /Length ${stream.length} >>\nstream\n`), stream, binary("\nendstream")])
    );
    pageIds.push(
      obj(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects[catalogId - 1] = binary(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = binary(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`
  );
  const sections: Uint8Array[] = [binary("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
  const positions = [0];
  let offset = sections[0]!.length;
  for (let i = 0; i < objects.length; i++) {
    positions.push(offset);
    const part = concat([binary(`${i + 1} 0 obj\n`), objects[i]!, binary("\nendobj\n")]);
    sections.push(part);
    offset += part.length;
  }
  sections.push(
    binary(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${positions
        .slice(1)
        .map((pos) => `${String(pos).padStart(10, "0")} 00000 n \n`)
        .join(
          ""
        )}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${offset}\n%%EOF`
    )
  );
  return new Blob(
    sections.map((section) => new Uint8Array(section)),
    { type: "application/pdf" }
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function downloadReport(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
