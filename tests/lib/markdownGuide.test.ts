import { describe, expect, it } from "vitest";
import { buildMarkdownGuide } from "~/lib/markdownGuide";
import { renderMarkdown } from "~/lib/markdown";

describe("buildMarkdownGuide（使用指南种子内容）", () => {
  it("双语内容存在且覆盖同一组语法要点", () => {
    const zh = buildMarkdownGuide("zh-CN");
    const en = buildMarkdownGuide("en");
    expect(zh).toContain("# 欢迎使用 Markdown 文档");
    expect(en).toContain("# Welcome to Markdown Docs");
    for (const g of [zh, en]) {
      // 指南必须示范的核心语法清单（与渲染器支持面一致）
      for (const marker of ["**", "~~", "```ts", "| 写法 |", "| Syntax |", "[", "> "]) {
        if (marker === "| 写法 |" && g === en) continue;
        if (marker === "| Syntax |" && g === zh) continue;
        expect(g).toContain(marker);
      }
      expect(g).toContain("- [ ]");
      expect(g).toContain("- [x]");
    }
  });

  it("指南全文可被渲染器完整解析（种子内容与渲染器同步的集成保障）", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const html = renderMarkdown(buildMarkdownGuide(locale));
      expect(html).toContain("<h1>");
      expect(html).toContain("<table>");
      expect(html).toContain("language-ts");
      expect(html).toContain('class="md-task"');
      expect(html).toContain("<blockquote>");
      expect(html).not.toContain("<script");
    }
  });
});
