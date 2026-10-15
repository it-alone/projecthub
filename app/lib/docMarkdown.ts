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
  if (marks.has("highlight")) out = `<mark>${out}</mark>`;
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
