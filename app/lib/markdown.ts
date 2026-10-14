/**
 * Markdown → HTML 渲染器（零依赖纯函数，遵循「优先零依赖实现」规范）。
 *
 * 安全策略（XSS 防线）：输入先整体做 HTML 转义，再按 Markdown 结构替换，
 * 因此输出可安全注入 dangerouslySetInnerHTML；链接/图片 URL 仅放行
 * http(s)/mailto/相对路径/锚点，其余协议（如 javascript:）一律降级为 "#"。
 *
 * 支持子集（笔记场景够用）：标题、段落、粗体/斜体/删除线、行内代码、
 * 围栏代码块、引用、有序/无序/任务列表（可嵌套）、表格、链接、图片、分隔线。
 * 段落内单个换行按 GFM 渲染为 <br>（笔记应用所见即所得更直观）。
 */

/** 行内代码占位符（NUL 在输入中先被剔除，不会与用户内容冲突） */
const PLACEHOLDER = "\u0000";

/** 无序列表条目：缩进 + 标记（- * + 或 1. 1)）+ 至少一个空格 + 内容 */
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** URL 白名单：仅放行 http(s)/mailto/站点相对路径/锚点，防 javascript: 等注入 */
function safeUrl(raw: string): string {
  const url = raw.trim();
  return /^(https?:\/\/|mailto:\/?|\/|\.{1,2}\/|#)/i.test(url) ? url : "#";
}

/** 行内元素渲染：代码 → 图片 → 链接 → 粗/斜/删除线（顺序影响结果，勿随意调整） */
function renderInline(src: string): string {
  // 行内代码最先占位：内部不再做任何 Markdown 解析
  const codes: string[] = [];
  let s = src.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `${PLACEHOLDER}${codes.length - 1}${PLACEHOLDER}`;
  });

  // 图片先于链接：否则 ![](url) 会被链接规则当成「文本 + 链接」吞掉
  s = s.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_m, alt: string, url: string) => {
    const imgSrc = safeUrl(url.split(/\s+/)[0] ?? "");
    return `<img src="${imgSrc}" alt="${alt}" loading="lazy" />`;
  });
  s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_m, text: string, url: string) => {
    const href = safeUrl(url.split(/\s+/)[0] ?? "");
    return `<a href="${href}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });

  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // 下划线斜体要求两侧非单词字符，避免 snake_case 变量名被误判
  s = s.replace(/(^|[^\w\\])_([^_\n]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  return s.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"), (_m, i: string) => codes[Number(i)] ?? "");
}

/** 表格分隔行：|---|:---:|---:| 形态，返回各列对齐方式（空 = 默认左对齐） */
function parseTableDelimiter(line: string): { aligns: Array<"" | "left" | "center" | "right"> } | null {
  if (!line.includes("|")) return null;
  const stripped = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = stripped.split(/(?<!\\)\|/);
  if (cells.length === 0 || stripped.trim() === "") return null;
  const aligns: Array<"" | "left" | "center" | "right"> = [];
  for (const cell of cells) {
    const m = cell.trim().match(/^(:?)(-{3,})(:?)$/);
    if (!m) return null;
    const [l, r] = [m[1] === ":", m[3] === ":"];
    aligns.push(l && r ? "center" : r ? "right" : l ? "left" : "");
  }
  return { aligns };
}

/** 拆一行表格单元格：去掉首尾包裹的 |，按未转义的 | 切分，再还原 \| 为字面竖线 */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isHrLine(l: string): boolean {
  return /^ {0,3}((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})$/.test(l);
}

/** 行是否开启一个块级结构（用于段落截断与列表条目前导文本拆分） */
function isBlockStartLine(l: string): boolean {
  return (
    l.trim() === "" ||
    /^ {0,3}(`{3,}|~{3,})/.test(l) ||
    /^#{1,6}\s/.test(l) ||
    /^ {0,3}&gt;/.test(l) ||
    LIST_ITEM_RE.test(l) ||
    isHrLine(l)
  );
}

/**
 * 解析一个列表块（含嵌套）：从 start 行起收集同缩进的条目与缩进续行，
 * 续行交给 renderBlocks 递归（自然形成嵌套列表/引用等）。
 */
function parseList(lines: string[], start: number): [string, number] {
  const first = lines[start]!.match(LIST_ITEM_RE)!;
  const base = first[1]!.length;
  const tag = /\d/.test(first[2]!) ? "ol" : "ul";
  const items: string[][] = [];
  let current: string[] | null = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      // 空行后若仍是同层/更深条目则列表继续，否则列表结束
      const next = lines[i + 1];
      const nm = next?.match(LIST_ITEM_RE);
      if (nm && nm[1]!.length >= base) {
        i++;
        continue;
      }
      break;
    }
    const m = line.match(LIST_ITEM_RE);
    if (m && m[1]!.length === base) {
      current = [m[3]!];
      items.push(current);
      i++;
      continue;
    }
    if (m && m[1]!.length < base) break; // 外层列表的条目，交还调用方
    if (current) {
      // 条目续行（更深缩进的嵌套内容）：剥掉一级条目缩进后并入内容
      current.push(line.slice(Math.min(base + 2, line.length)));
      i++;
      continue;
    }
    break;
  }

  const html = items
    .map((content) => {
      const [firstLine, ...rest] = content;
      // 紧列表：前导纯文本行（含任务勾选行）按行内渲染（不包 <p>），
      // 其余交给块级递归（嵌套列表/引用等）——任务项同样要保留嵌套内容
      const lead: string[] = [];
      let k = 0;
      while (k < rest.length && !isBlockStartLine(rest[k]!)) {
        lead.push(rest[k]!);
        k++;
      }
      const blockHtml = k < rest.length ? renderBlocks(rest.slice(k)) : "";
      const tm = firstLine!.match(/^\[( |x|X)\]\s+(.*)$/);
      const headLine = tm ? tm[2]! : firstLine!;
      const leadHtml = [headLine, ...lead].map((l) => renderInline(l)).join("<br />");
      const checkbox = tm ? `<input type="checkbox" disabled${tm[1] === " " ? "" : " checked"} /> ` : "";
      return `<li${tm ? ' class="md-task"' : ""}>${checkbox}${leadHtml}${blockHtml}</li>`;
    })
    .join("");

  return [`<${tag}>${html}</${tag}>`, i];
}

/** 块级渲染：逐行状态机（围栏代码 → 标题 → 分隔线 → 引用 → 列表 → 表格 → 段落） */
function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    // 围栏代码块：闭合围栏须不短于开启围栏；EOF 未闭合也照常收尾
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence && !fence[2]!.trim().startsWith("`")) {
      const fenceChar = fence[1]![0]!;
      const len = fence[1]!.length;
      const lang = fence[2]!.trim().split(/\s+/)[0] ?? "";
      const buf: string[] = [];
      i++;
      const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${len},}\\s*$`);
      while (i < lines.length && !closeRe.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      i++;
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${buf.join("\n")}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${renderInline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }

    if (isHrLine(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // 引用标记 > 在整体转义后已是 &gt;，这里按转义形态识别
    if (/^ {0,3}&gt;/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^ {0,3}&gt;/.test(lines[i]!)) {
        inner.push(lines[i]!.replace(/^ {0,3}&gt; ?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`);
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const [html, next] = parseList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const delim = i + 1 < lines.length ? parseTableDelimiter(lines[i + 1]!) : null;
    if (line.includes("|") && delim) {
      const head = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|") && !LIST_ITEM_RE.test(lines[i]!)) {
        rows.push(splitTableRow(lines[i]!));
        i++;
      }
      const alignAttr = (x: number) => (delim.aligns[x] ? ` style="text-align: ${delim.aligns[x]}"` : "");
      const thead = `<tr>${head.map((c, x) => `<th${alignAttr(x)}>${renderInline(c)}</th>`).join("")}</tr>`;
      const tbody = rows
        .map((r) => `<tr>${r.map((c, x) => `<td${alignAttr(x)}>${renderInline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    // 段落：吃到空行或下一个块级结构；单换行按 GFM 渲染为 <br>
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (!l.trim()) break;
      if (
        /^ {0,3}(`{3,}|~{3,})/.test(l) ||
        /^#{1,6}\s/.test(l) ||
        /^ {0,3}&gt;/.test(l) ||
        LIST_ITEM_RE.test(l) ||
        isHrLine(l)
      ) {
        break;
      }
      if (l.includes("|") && i + 1 < lines.length && parseTableDelimiter(lines[i + 1]!)) break;
      para.push(l);
      i++;
    }
    out.push(`<p>${para.map((l) => renderInline(l)).join("<br />")}</p>`);
  }
  return out.join("");
}

/** 渲染 Markdown 文本为可直接注入的 HTML 字符串（输入不可信也已安全） */
export function renderMarkdown(src: string): string {
  // 剔除 NUL（占位符字符不外泄进内容）；统一换行；整体转义是安全的前提
  const text = escapeHtml(src.replace(/\0/g, "").replace(/\r\n?/g, "\n"));
  return renderBlocks(text.split("\n"));
}
