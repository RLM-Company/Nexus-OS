import { describe, expect, it } from "vitest";
import { editSiteBlock, editSiteResource, parseSiteProject } from "./site-project";

const html = "<html><body><h1>Космический курьер</h1><p>Игра про доставку.</p></body></html>";
const source = JSON.stringify({
  format: "kosmora.site-project.v1",
  title: "Сайт игры",
  blocks: [
    { id: "hero", title: "Главный экран", html: "<h1>Космический курьер</h1>" },
    { id: "features", title: "Механика", html: "<p>Доставь груз за 60 секунд</p>" }
  ],
  resources: [{ name: "poster.png", media_type: "image/png", data_base64: "iVBORw0KGgo=" }],
  html
});

describe("addressable site project", () => {
  it("changes one block and preserves all other blocks, resources and html", () => {
    const result = editSiteBlock(source, "features", {
      title: "Новая механика",
      html: "<p>Доставь груз за 45 секунд</p>"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.blocks[0]).toEqual({
      id: "hero",
      title: "Главный экран",
      html: "<h1>Космический курьер</h1>"
    });
    expect(result.project.blocks[1]?.title).toBe("Новая механика");
    expect(result.project.resources[0]?.name).toBe("poster.png");
    expect(result.project.html).toBe(html);
  });

  it("adds a linked resource without changing blocks", () => {
    const result = editSiteResource(source, {
      name: "rules.txt",
      media_type: "text/plain",
      data_base64: "UHJhdmlsYQ=="
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseSiteProject(source);
    expect(result.project.resources).toHaveLength(2);
    expect(result.project.blocks).toEqual(parsed.blocks);
  });

  it("refuses an unknown block, a script in html and a duplicate id", () => {
    const parsed = parseSiteProject(source);
    expect(editSiteBlock(source, "missing", { title: "x", html: "y" })).toMatchObject({
      ok: false,
      error: "BLOCK_NOT_FOUND"
    });
    expect(() =>
      parseSiteProject(
        JSON.stringify({
          ...JSON.parse(source),
          html: "<html><body><script>x</script></body></html>"
        })
      )
    ).toThrow("INVALID_SITE_PROJECT");
    expect(() =>
      parseSiteProject(
        JSON.stringify({
          ...JSON.parse(source),
          blocks: [parsed.blocks[0], parsed.blocks[0]]
        })
      )
    ).toThrow("INVALID_SITE_PROJECT");
  });
});
