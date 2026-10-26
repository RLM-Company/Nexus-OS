/** Format validation only. Browser preview applies its own independent isolation. */
export const WEBSITE_MAX_BYTES = 64 * 1024;
export const WEBSITE_OUTPUT_INSTRUCTION =
  "Website output contract: create exactly one complete self-contained static index.html file. Return the normal files JSON envelope. Use responsive HTML and inline CSS, semantic headings and the owner language. No scripts, external assets/fonts, tracking, external form services or claims of deployment. Use CSS artwork when useful. Produce useful final content, not a plan or placeholders. Keep the file below 64 KiB. The owner previews and downloads the file; no website is published.";

export function validateWebsiteDocument(content: string): string {
  if (
    !content.trim() ||
    content.includes("\0") ||
    new TextEncoder().encode(content).length > WEBSITE_MAX_BYTES ||
    !/<html(?:\s|>)/i.test(content) ||
    !/<body(?:\s|>)/i.test(content) ||
    !/<\/body\s*>/i.test(content) ||
    !/<\/html\s*>\s*$/i.test(content) ||
    /<script(?:\s|>|\/)/i.test(content) ||
    /^\s*```/.test(content)
  )
    throw new Error("INVALID_WEBSITE_RESULT");
  return content;
}
