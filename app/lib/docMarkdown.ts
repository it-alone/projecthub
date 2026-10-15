import type { JSONContent } from "@tiptap/react";

/**
 * tiptap 富文本 JSON → Markdown（文档导出 .md 用，零依赖手写序列化）。
 * 只覆盖文档编辑器实际可产出的节点/标记；未知节点按纯文本兜底，保证导出不丢内容。
 */

/** 行内标记 → Markdown 包裹（code 优先，避免与其他标记嵌套产生歧义） */
function inlineText(node: JSONContent): string {
  if (node.type === "hardBreak") return "  \n";
  const text = node.text ?? "";
  if (!text) return "";
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  if (marks.has("code")) return `\`${text}\``;
  let out = text;
  if (marks.has("italic")) out = `*${out}*`;
  if (marks.has("bold")) out = `**${out}**`;
  if (marks.has("strike")) out = `~~${out}~~`;
  if (marks.has("underline")) out = `<u>${out}</u>`;
  // 高亮多色：官方 Highlight 扩展把色值存 attrs.color；老数据无色值时退回纯 <mark>
  const hlColor = (node.marks ?? []).find((m) => m.type === "highlight")?.attrs as { color?: string } | undefined;
  if (marks.has("highlight")) {
    out = hlColor?.color ? `<mark style="background-color:${hlColor.color}">${out}</mark>` : `<mark>${out}</mark>`;
  }
  // 文字/背景色/字号（GFM 无原生语法，保留行内 HTML，主流渲染器可用）
  const textStyle = (node.marks ?? []).find((m) => m.type === "textStyle")?.attrs as
    | { color?: string; backgroundColor?: string; fontSize?: string }
    | undefined;
  if (textStyle?.backgroundColor) out = `<span style="background-color:${textStyle.backgroundColor}">${out}</span>`;
  if (textStyle?.fontSize) out = `<span style="font-size:${textStyle.fontSize}">${out}</span>`;
  if (textStyle?.color) out = `<span style="color:${textStyle.color}">${out}</span>`;
  // 链接包最外层（[带样式文本](href) 是合法 GFM）
  const href = (node.marks ?? []).find((m) => m.type === "link")?.attrs as { href?: string } | undefined;
  if (href?.href) out = `[${out}](${href.href})`;
  return out;
}

function inline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? []).map(inlineText).join("");
}

function listItemText(node: JSONContent): string {
  // 列表项里可能是纯行内，也可能嵌套子列表
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "bulletList" || child.type === "orderedList") {
      parts.push(listBlock(child, "  "));
    } else if (child.type === "text") {
      parts.push(inlineText(child));
    } else {
      parts.push(inline(child.content)); // 段落等容器节点 → 取其行内内容
    }
  }
  return parts.join("\n"); // 文本与嵌套子列表之间换行，保证缩进列表合法
}

function listBlock(node: JSONContent, indent: string): string {
  const lines: string[] = [];
  let order = 1;
  for (const item of node.content ?? []) {
    if (item.type !== "listItem") continue;
    const marker = node.type === "orderedList" ? `${order++}. ` : "- ";
    lines.push(`${indent}${marker}${listItemText(item).trim()}`);
  }
  return lines.join("\n");
}

/** 待办列表：- [ ] / - [x]（GFM 任务列表语法，缩进随嵌套层级） */
function taskBlock(node: JSONContent, indent: string): string {
  const lines: string[] = [];
  for (const item of node.content ?? []) {
    if (item.type !== "taskItem") continue;
    const checked = item.attrs?.checked === true ? "x" : " ";
    const parts: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === "taskList") parts.push(taskBlock(child, `${indent}  `));
      else parts.push(inline(child.content).trim());
    }
    lines.push(`${indent}- [${checked}] ${parts.filter(Boolean).join("\n")}`);
  }
  return lines.filter(Boolean).join("\n");
}

/** 表格 → GFM 管道表（首行为表头是编辑器插入表格的约定） */
function tableBlock(node: JSONContent): string {
  const rows = (node.content ?? []).filter((c) => c.type === "tableRow");
  if (!rows.length) return "";
  // 单元格里是段落等容器节点，取其行内内容拼接
  const cellText = (cell: JSONContent): string =>
    (cell.content ?? []).map((ch) => inline(ch.content).trim()).join(" ");
  const rowText = (row: JSONContent): string =>
    (row.content ?? []).map((td) => cellText(td).replaceAll("|", "\\|")).join(" | ");
  const colCount = Math.max(...rows.map((r) => r.content?.length ?? 0), 1);
  const lines = rows.map((row) => `| ${rowText(row)} |`);
  lines.splice(1, 0, `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
  return lines.join("\n");
}

function block(node: JSONContent): string {
  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${inline(node.content).trim()}`;
    }
    case "paragraph":
      return inline(node.content).trim();
    case "bulletList":
    case "orderedList":
      return listBlock(node, "");
    case "taskList":
      return taskBlock(node, "");
    case "table":
      return tableBlock(node);
    case "blockquote": {
      // 引用块内通常是段落；逐段加 "> " 前缀
      const inner = (node.content ?? [])
        .map((child) => (child.type === "paragraph" ? inline(child.content).trim() : block(child)))
        .filter(Boolean)
        .map((line) => `> ${line}`)
        .join("\n");
      return inner;
    }
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      return `\`\`\`${lang}\n${code.replace(/\n$/, "")}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    default: {
      // 未知节点：有行内内容就按段落导出，避免内容丢失
      const text = inline(node.content).trim();
      if (text) return text;
      return (node.content ?? []).map(block).filter(Boolean).join("\n\n");
    }
  }
}

/** 文档 JSON → Markdown 文本（块之间空一行） */
export function docJsonToMarkdown(json: JSONContent | null): string {
  if (!json) return "";
  const blocks = (json.content ?? []).map(block).filter((s) => s.length > 0);
  return blocks.join("\n\n");
}
