import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { docJsonToMarkdown } from "~/lib/docMarkdown";

const text = (value: string, marks?: string[]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});
const para = (...children: JSONContent[]): JSONContent => ({ type: "paragraph", content: children });
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: "doc", content: blocks });

describe("docJsonToMarkdown：块级节点", () => {
  it("null / 空文档导出空串", () => {
    expect(docJsonToMarkdown(null)).toBe("");
    expect(docJsonToMarkdown({ type: "doc", content: [] })).toBe("");
  });

  it("标题层级（1-6 透传，越界钳制）", () => {
    expect(docJsonToMarkdown(doc({ type: "heading", attrs: { level: 1 }, content: [text("大标题")] }))).toBe("# 大标题");
    expect(docJsonToMarkdown(doc({ type: "heading", attrs: { level: 3 }, content: [text("三")] }))).toBe("### 三");
    expect(docJsonToMarkdown(doc({ type: "heading", attrs: { level: 99 }, content: [text("深")] }))).toBe("###### 深");
    expect(docJsonToMarkdown(doc({ type: "heading", attrs: { level: 0 }, content: [text("浅")] }))).toBe("# 浅");
  });

  it("块之间以空行连接", () => {
    const md = docJsonToMarkdown(doc(para(text("第一段")), para(text("第二段"))));
    expect(md).toBe("第一段\n\n第二段");
  });

  it("代码块带语言、去掉尾部空行", () => {
    const code: JSONContent = {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const a = 1;\n")],
    };
    expect(docJsonToMarkdown(doc(code))).toBe("```ts\nconst a = 1;\n```");
  });

  it("引用块逐段加 > 前缀；分隔线；硬换行", () => {
    const quote: JSONContent = { type: "blockquote", content: [para(text("一")), para(text("二"))] };
    expect(docJsonToMarkdown(doc(quote))).toBe("> 一\n> 二");
    expect(docJsonToMarkdown(doc({ type: "horizontalRule" }))).toBe("---");
    expect(docJsonToMarkdown(doc(para(text("a"), { type: "hardBreak" }, text("b"))))).toBe("a  \nb");
  });

  it("未知节点按纯文本兜底，不丢内容", () => {
    const custom: JSONContent = { type: "customBlock", content: [text("内容")] };
    expect(docJsonToMarkdown(doc(custom))).toBe("内容");
  });
});

describe("docJsonToMarkdown：列表", () => {
  it("无序 / 有序列表", () => {
    const bullet: JSONContent = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para(text("甲"))] },
        { type: "listItem", content: [para(text("乙"))] },
      ],
    };
    expect(docJsonToMarkdown(doc(bullet))).toBe("- 甲\n- 乙");

    const ordered: JSONContent = {
      type: "orderedList",
      content: [
        { type: "listItem", content: [para(text("一"))] },
        { type: "listItem", content: [para(text("二"))] },
        { type: "listItem", content: [para(text("三"))] },
      ],
    };
    expect(docJsonToMarkdown(doc(ordered))).toBe("1. 一\n2. 二\n3. 三");
  });

  it("列表项内嵌套子列表（缩进两格）", () => {
    const nested: JSONContent = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            para(text("父")),
            {
              type: "orderedList",
              content: [{ type: "listItem", content: [para(text("子"))] }],
            },
          ],
        },
      ],
    };
    expect(docJsonToMarkdown(doc(nested))).toBe("- 父\n  1. 子");
  });
});

describe("docJsonToMarkdown：行内标记", () => {
  it("粗体 / 斜体 / 删除线 / 下划线 / 高亮", () => {
    expect(docJsonToMarkdown(doc(para(text("粗", ["bold"]))))).toBe("**粗**");
    expect(docJsonToMarkdown(doc(para(text("斜", ["italic"]))))).toBe("*斜*");
    expect(docJsonToMarkdown(doc(para(text("删", ["strike"]))))).toBe("~~删~~");
    expect(docJsonToMarkdown(doc(para(text("下", ["underline"]))))).toBe("<u>下</u>");
    expect(docJsonToMarkdown(doc(para(text("亮", ["highlight"]))))).toBe("<mark>亮</mark>");
  });

  it("行内代码优先：不再叠加其他标记", () => {
    expect(docJsonToMarkdown(doc(para(text("x", ["code", "bold"]))))).toBe("`x`");
  });

  it("多标记叠加（斜体在内、粗体在外）", () => {
    expect(docJsonToMarkdown(doc(para(text("x", ["bold", "italic"]))))).toBe("***x***");
  });
});
