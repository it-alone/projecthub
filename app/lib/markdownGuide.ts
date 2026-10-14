import type { Locale } from "~/lib/i18n";

/**
 * 《Markdown 使用指南》示例文档内容（新建用户的教学种子）。
 * 放 lib 而非 locales：这是「文档种子数据」而非界面标签，且为多行 Markdown，
 * 塞进 i18n 字典会破坏单行键值的可维护性；语法只使用渲染器支持的子集。
 */

const ZH_GUIDE = `# 欢迎使用 Markdown 文档

这篇文档是一份**可编辑的使用指南**：左侧是源码，右侧是实时渲染的预览。
随便改、随便删，掌握之后清空它写成你自己的内容即可。

## 编辑器怎么用

- 内容会**自动保存**，工具条上会显示「已自动保存」，无需手动保存
- 顶部按钮可切换 **编辑 / 分屏 / 预览** 三种视图
- 点「下载 .md」可把当前文档下载到本地
- 返回列表后，悬浮卡片可重命名、下载或删除文档

## 文本样式

**粗体**、*斜体*、~~删除线~~、\`行内代码\`

## 列表

1. 有序列表第一项
2. 有序列表第二项

- 无序列表
  - 缩进两个空格即可嵌套
- [ ] 未完成的任务
- [x] 已完成的任务

## 引用

> 引用适合放提示、备注或摘抄的内容。

## 代码块

\`\`\`ts
// 三个反引号 + 语言名开启代码块
function hello(name: string) {
  return \`你好，\${name}！\`;
}
\`\`\`

## 表格

| 写法 | 效果 |
| --- | --- |
| \`**粗体**\` | **粗体** |
| \`*斜体*\` | *斜体* |
| \`~~删除线~~\` | ~~删除线~~ |

## 链接

[点我打开示例链接](https://example.com)

## 分隔线

---

## 小提示

- 段落内直接回车就会换行，不需要特殊标记
- 链接仅支持 http(s) 等安全协议
- 清空内容后，预览区的「插入使用指南示例」按钮可以随时找回这份示例
`;

const EN_GUIDE = `# Welcome to Markdown Docs

This document is an **editable guide**: source on the left, live preview on the right.
Change or delete anything — once you are comfortable, clear it and write your own.

## Using the editor

- Content is **autosaved** — the toolbar shows "Autosaved", no manual save needed
- The top buttons switch between **Edit / Split / Preview** views
- Click "Download .md" to save the document to your computer
- Back on the list, hover a card to rename, download, or delete a document

## Text styles

**Bold**, *italic*, ~~strikethrough~~, \`inline code\`

## Lists

1. First ordered item
2. Second ordered item

- Unordered item
  - Indent two spaces to nest
- [ ] Unfinished task
- [x] Finished task

## Quote

> Quotes are great for tips, notes, or excerpts.

## Code blocks

\`\`\`ts
// Open a code block with three backticks plus a language
function hello(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Tables

| Syntax | Result |
| --- | --- |
| \`**Bold**\` | **Bold** |
| \`*Italic*\` | *Italic* |
| \`~~Strike~~\` | ~~Strike~~ |

## Links

[Open an example link](https://example.com)

## Divider

---

## Tips

- Pressing Enter inside a paragraph starts a new line — no special marker needed
- Links support safe protocols such as http(s) only
- After clearing the content, the "Insert guide example" button in the preview brings this guide back
`;

/** 按当前语言构建使用指南示例正文 */
export function buildMarkdownGuide(locale: Locale): string {
  return locale === "zh-CN" ? ZH_GUIDE : EN_GUIDE;
}
