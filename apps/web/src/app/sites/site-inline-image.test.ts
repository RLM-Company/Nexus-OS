import { expect, it } from "vitest";
import { embedSiteImage, SITE_IMAGE_MAX_BYTES } from "./site-inline-image";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 1]);
const webp = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);

it("embeds exact image bytes before body close with escaped alt and unchanged siblings", () => {
  const html = "<!doctype html><html><body><h1>До</h1></body></html>";
  const result = embedSiteImage(html, png, '"<Лого>&');
  expect(result).toContain('alt="&quot;&lt;Лого&gt;&amp;"');
  expect(result).toContain("src=\"data:image/png;base64," + btoa(String.fromCharCode(...png)));
  expect(result).toContain("<h1>До</h1>\n<img ");
  expect(result).toContain("\n</body></html>");
  expect(embedSiteImage("<p>Текст</p>", jpeg, "")).toContain("data:image/jpeg;base64,");
  expect(embedSiteImage("<p>Текст</p>", webp, "")).toContain("data:image/webp;base64,");
});

it("rejects SVG, mismatched magic, oversized data and exceeding the HTML budget", () => {
  expect(() => embedSiteImage("<p/>", new Uint8Array(), "")).toThrow("64 КиБ");
  expect(() => embedSiteImage("<p/>", new Uint8Array(SITE_IMAGE_MAX_BYTES + 1), "")).toThrow(
    "64 КиБ"
  );
  expect(() => embedSiteImage("<p/>", new TextEncoder().encode("<svg></svg>"), "")).toThrow(
    "PNG, JPEG и WebP"
  );
  expect(() => embedSiteImage("<p/>", png, "\u0000")).toThrow("управляющих");
  expect(() => embedSiteImage("x".repeat(512 * 1024), png, "")).toThrow("512 КиБ");
});
