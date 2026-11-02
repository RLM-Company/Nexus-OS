/** Accept only a complete JSON value, optionally in one observed relay wrapper.
 * Do not extract arbitrary braces, decode HTML, or change strings inside JSON.
 * Callers must still validate their stage-specific schema before using the value.
 */
export function parseModelJson(text: string): unknown {
  let json = text.trim();
  if (json.startsWith("<escape>") && json.endsWith("</escape>"))
    json = json.slice("<escape>".length, -"</escape>".length).trim();
  return JSON.parse(json) as unknown;
}
