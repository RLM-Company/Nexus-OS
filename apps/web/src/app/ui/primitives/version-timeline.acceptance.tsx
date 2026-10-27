import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionDiffBadge, VersionTimeline } from "./version-timeline";

describe("VersionTimeline host boundary", () => {
  it("shows restore only when supplied and never for the current version", () => {
    const versions = [
      {
        id: "old",
        label: "Первая",
        createdAt: "2026-10-09T10:00:00+03:00",
        status: "saved" as const
      },
      {
        id: "now",
        label: "Текущая",
        createdAt: "2026-10-09T11:00:00+03:00",
        status: "current" as const
      }
    ];
    const readOnly = renderToStaticMarkup(createElement(VersionTimeline, { versions }));
    expect(readOnly).not.toContain("<button");
    expect(readOnly).toContain("2026-10-09 07:00:00 UTC");
    const interactive = renderToStaticMarkup(
      createElement(VersionTimeline, {
        versions,
        onRequestRestore: () => {},
        restoringId: "old"
      })
    );
    expect(interactive.match(/<button/g)).toHaveLength(1);
    expect(interactive).toContain("disabled");
    expect(interactive).toContain("Восстановление…");
  });
  it("escapes user titles and retains invalid dates as text without invalid dateTime", () => {
    const markup = renderToStaticMarkup(
      createElement(VersionTimeline, {
        versions: [
          { id: "bad", label: "<script>x</script>", createdAt: "not-a-date", detail: "<img>" }
        ]
      })
    );
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("<time>not-a-date</time>");
  });
  it("does not expose non-finite or negative diff counts", () => {
    const markup = renderToStaticMarkup(
      createElement(VersionDiffBadge, { added: Infinity, removed: -2 })
    );
    expect(markup).toContain("Добавлено 0 строк, удалено 0 строк");
    expect(markup).not.toContain("Infinity");
  });
});
