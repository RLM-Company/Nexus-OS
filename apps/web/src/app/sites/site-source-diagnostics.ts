export type SiteSourceFinding = {
  code: string;
  message: string;
};

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_INSPECTED_ELEMENTS = 3000;
const externalUrl = /^(?:https?:)?\/\//i;
const embeddedImage = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
const externalCss = /@import\b|url\(\s*["']?(?:https?:)?\/\//i;
const unsupportedTags = new Set("iframe object embed video audio canvas svg math".split(" "));

/**
 * Report observable limitations of STATIC preview, never execute source.
 * Parsing happens in an inert template. This is not a publication security audit.
 */
// Temporary local exception while verifying the typed checker and browser suite.
// prettier-ignore
export function inspectSiteSource(content: string): SiteSourceFinding[] {
  if (new TextEncoder().encode(content).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("Размер диагностики превышает 512 КиБ.");
  }
  const template = document.createElement("template");
  template.innerHTML = content;
  const elements = template.content.querySelectorAll("*");
  const seenIds = new Set<string>();
  const repeatedIds = new Set<string>();
  const targets: string[] = [];
  let scripts = 0;
  let formControls = 0;
  let unsupported = 0;
  let externalReferences = 0;
  let missingImageAlt = 0;
  let unavailableImages = 0;
  let externalStyles = 0;

  for (const element of Array.from(elements).slice(0, MAX_INSPECTED_ELEMENTS)) {
    const tag = element.localName;
    if (tag === "script") scripts++;
    if (["form", "button", "input", "select", "textarea"].includes(tag)) formControls++;
    if (unsupportedTags.includes(tag)) unsupported++;
    const id = element.getAttribute("id");
    if (id) {
      if (seenIds.has(id)) repeatedIds.add(id);
      seenIds.add(id);
    }
    const link = element.getAttribute("href");
    if (tag === "a" && link?.startsWith("#") && link.length > 1) {
      try {
        targets.push(decodeURIComponent(link.slice(1)));
      } catch {
        targets.push(link.slice(1));
      }
    }
    for (const attr of ["src", "href", "srcset", "poster"]) {
      const value = element.getAttribute(attr)?.trim();
      if (value && externalUrl.test(value)) externalReferences++;
    }
    if (tag === "img") {
      if (!element.hasAttribute("alt")) missingImageAlt++;
      if (!embeddedImage.test(element.getAttribute("src") ?? "")) unavailableImages++;
    }
    if (tag === "style" && externalCss.test(element.textContent ?? "")) externalStyles++;
    if (externalCss.test(element.getAttribute("style") ?? "")) externalStyles++;
  }

  const findings: SiteSourceFinding[] = [];
  const record = (code: string, message: string) => {
    findings.push({ code, message });
  };
  if (elements.length > MAX_INSPECTED_ELEMENTS) {
    record("truncated", "Документ большой: проверены только первые 3000 элементов.");
  }
  if (scripts > 0) {
    record("scripts", "Скрипты (" + scripts + ") не исполняются в статическом предпросмотре.");
  }
  if (formControls > 0) {
    const message = "Формы и элементы ввода (" + formControls + ") не работают в предпросмотре.";
    record("forms", message);
  }
  if (unsupported > 0) {
    const message = "Неподдерживаемых элементов: " + unsupported + ". В preview они удаляются.";
    record("elements", message);
  }
  if (externalReferences + externalStyles > 0) {
    const count = externalReferences + externalStyles;
    const message = "Внешние ссылки на ресурсы: " + count + ". Preview блокирует загрузку.";
    record("external", message);
  }
  if (unavailableImages > 0) {
    record("images", "Изображения без встроенного PNG/JPEG/WebP: " + unavailableImages + ".");
  }
  if (missingImageAlt > 0) {
    record("alt", "Изображения без атрибута alt: " + missingImageAlt + ".");
  }
  if (repeatedIds.size > 0) {
    const names = [...repeatedIds].slice(0, 5).join(", ");
    record("duplicate-id", "Повторяющиеся id: " + names + ".");
  }
  const missingTargets = [...new Set(targets.filter((target) => !seenIds.has(target)))];
  if (missingTargets.length > 0) {
    const names = missingTargets.slice(0, 5).map((item) => "#" + item).join(", ");
    record("anchors", "Не найдены цели внутренних ссылок: " + names + ".");
  }
  return findings;
}
