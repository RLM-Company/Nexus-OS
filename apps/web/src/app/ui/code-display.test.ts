import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineDiff } from "./inline-diff";
import { TerminalOutput } from "./terminal-output";

describe("untrusted code and executor output", () => {
  const payload = '<img src="https://invalid.test/pixel"><script>bad()</script>';
  it("renders code, diff and terminal output as inert text", () => {
    for (const element of [
      createElement(InlineDiff, { text: `@@ -0,0 +1 @@\n+${payload}\n` }),
      createElement(TerminalOutput, { stdout: payload, stderr: payload })
    ]) {
      const html = renderToStaticMarkup(element);
      expect(html).not.toMatch(/<(?:img|script|iframe)\b/);
      expect(html).toContain("&lt;script&gt;");
    }
  });
  it("keeps stdout and stderr separate and reports server truncation", () => {
    const html = renderToStaticMarkup(
      createElement(TerminalOutput, {
        stdout: "actual output",
        stderr: "actual warning",
        status: "failed",
        truncated: true
      })
    );
    expect(html).toContain('aria-label="Стандартный вывод"');
    expect(html).toContain('aria-label="Вывод ошибок"');
    expect(html).toContain("actual output");
    expect(html).toContain("actual warning");
    expect(html).toContain("Вывод ограничен сервером.");
    expect(html).toContain("Ошибка");
  });
});
