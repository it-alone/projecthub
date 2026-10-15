import type { JSONContent } from "@tiptap/react";
import type { Locale } from "~/lib/i18n";
import { uuid } from "~/lib/id";
import { sheetPageSchema, type SheetPage } from "~/models/docSuite";

/** 首次进入「文档」模块播种的示例内容（按当前语言），让新用户开箱即可体验块编辑与公式 */

function text(t: string, marks?: JSONContent["marks"]): JSONContent {
  return marks ? { type: "text", text: t, marks } : { type: "text", text: t };
}

export function buildSeedDocJson(locale: Locale): JSONContent {
  if (locale === "en") {
    return {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Welcome to Docs")] },
        {
          type: "paragraph",
          content: [
            text("This is a Feishu-style rich text document. Everything is stored locally in your browser — type "),
            text("/", [{ type: "code" }]),
            text(" anywhere to open the block insert menu."),
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [text("Try the essentials")] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [text("Use the toolbar to switch headings, lists and quotes")] }],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    text("Select text and press "),
                    text("Ctrl/Cmd + B", [{ type: "code" }]),
                    text(" for bold, "),
                    text("Ctrl/Cmd + I", [{ type: "code" }]),
                    text(" for italic"),
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [text("Everything auto-saves as you type")] }],
            },
          ],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [text("A quote block is perfect for a key sentence.")] }],
        },
        {
          type: "codeBlock",
          attrs: { language: "plain" },
          content: [text("Create a Spreadsheet to try formulas like =SUM(B2:B7)")],
        },
      ],
    };
  }
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [text("欢迎使用文档")] },
      {
        type: "paragraph",
        content: [
          text("这是一篇飞书式富文本文档，所有内容保存在本地浏览器。在正文任意位置输入 "),
          text("/", [{ type: "code" }]),
          text(" 即可唤起块插入菜单。"),
        ],
      },
      { type: "heading", attrs: { level: 2 }, content: [text("上手要点")] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [text("顶部工具栏可切换标题、列表、引用与代码块")] }],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  text("选中文字后 "),
                  text("Ctrl/⌘ + B", [{ type: "code" }]),
                  text(" 加粗、"),
                  text("Ctrl/⌘ + I", [{ type: "code" }]),
                  text(" 斜体"),
                ],
              },
            ],
          },
          { type: "listItem", content: [{ type: "paragraph", content: [text("内容随输入自动保存，无需手动点保存")] }] },
        ],
      },
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [text("引用块适合放一句需要被记住的话。")] }],
      },
      {
        type: "codeBlock",
        attrs: { language: "plain" },
        content: [text("新建一个「表格」即可体验 =SUM(B2:B7) 这样的公式")],
      },
    ],
  };
}

/** 示例表格：带表头样式、基础数据与 SUM/AVERAGE/MAX 公式，直观演示引擎能力 */
export function buildSeedSheetPages(locale: Locale): SheetPage[] {
  const zh = locale === "zh-CN";
  const cells: SheetPage["cells"] = {};
  const put = (key: string, v: string, s?: { b?: true; a?: "center" }) => {
    cells[key] = s ? { v, s } : { v };
  };
  const months = zh
    ? ["一月", "二月", "三月", "四月", "五月", "六月"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  put("A1", zh ? "月份" : "Month", { b: true, a: "center" });
  put("B1", zh ? "销售额" : "Revenue", { b: true, a: "center" });
  put("C1", zh ? "成本" : "Cost", { b: true, a: "center" });
  put("D1", zh ? "利润" : "Profit", { b: true, a: "center" });
  months.forEach((m, i) => {
    const row = i + 2;
    put(`A${row}`, m);
    put(`B${row}`, String(12000 + i * 2600));
    put(`C${row}`, String(7300 + i * 1500));
    put(`D${row}`, `=B${row}-C${row}`);
  });
  put("A8", zh ? "合计" : "Total", { b: true });
  put("B8", "=SUM(B2:B7)", { b: true });
  put("C8", "=SUM(C2:C7)", { b: true });
  put("D8", "=SUM(D2:D7)", { b: true });
  put("A10", zh ? "月均销售额" : "Avg revenue");
  put("B10", "=AVERAGE(B2:B7)");
  put("A11", zh ? "最高单月利润" : "Max profit");
  put("B11", "=MAX(D2:D7)");
  return [
    sheetPageSchema.parse({
      id: uuid(),
      name: zh ? "销售数据" : "Sales",
      rows: 60,
      cols: 26,
      colWidths: {},
      cells,
    }),
  ];
}
