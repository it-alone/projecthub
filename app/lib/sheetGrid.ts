import { uuid } from "~/lib/id";
import { sheetPageSchema, type SheetCell, type SheetCellStyle, type SheetPage } from "~/models/docSuite";
import {
  evaluateSheet,
  formatCellValue,
  offsetFormulaRefs,
  parseRefKey,
  refKey,
  shiftFormulaRefs,
  type SheetDisplayValue,
} from "~/lib/sheetFormula";

/**
 * 在线表格的网格数据变换（纯函数，全部返回新页签对象）：
 * 行列增删时同步做两件事 —— 平移 cells 键、按 token 区间改写公式里的引用，
 * 保证 =SUM(B2:B7) 这类公式在插行/删行后仍指向原数据。
 */

export const SHEET_MAX_ROWS = 500;
export const SHEET_MAX_COLS = 40;
export const SHEET_DEFAULT_ROWS = 60;
export const SHEET_DEFAULT_COLS = 26;

export interface GridPos {
  c: number;
  r: number;
}
export interface GridRange {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

/** 两格坐标 → 规范化矩形（端点取小大） */
export function normRange(a: GridPos, b: GridPos): GridRange {
  return {
    c1: Math.min(a.c, b.c),
    r1: Math.min(a.r, b.r),
    c2: Math.max(a.c, b.c),
    r2: Math.max(a.r, b.r),
  };
}

export function newPage(name: string, rows = SHEET_DEFAULT_ROWS, cols = SHEET_DEFAULT_COLS): SheetPage {
  return sheetPageSchema.parse({ id: uuid(), name, rows, cols, colWidths: {}, cells: {} });
}

/** 引用键 → 单元格（无则 undefined） */
function cellAt(page: SheetPage, key: string) {
  return page.cells[key];
}

/** 写入单元格原文：空文本且无样式时删除键，保持 cells 稀疏 */
export function writeCell(page: SheetPage, pos: GridPos, v: string): SheetPage {
  const key = refKey(pos.c, pos.r);
  const cells = { ...page.cells };
  const prev = cellAt(page, key);
  if (v === "" && !prev?.s) {
    delete cells[key];
  } else {
    cells[key] = { ...(prev ?? {}), v };
  }
  return { ...page, cells };
}

/** 样式开关键（加粗/斜体/下划线/删除线共用同一形状） */
export type SheetStyleKey = "b" | "i" | "u" | "s";

/** 选区内统一切换样式：on=false 时显式移除该样式键 */
export function toggleStyle(page: SheetPage, range: GridRange, key: SheetStyleKey, on: boolean): SheetPage {
  const cells = { ...page.cells };
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const k = refKey(c, r);
      const prev: SheetCell = cells[k] ?? { v: "" };
      const style: SheetCellStyle = { ...prev.s };
      if (on) style[key] = true;
      else delete style[key];
      const next = { ...prev, s: style };
      if (next.v === "" && !next.s) delete cells[k]; // 空文本且无样式 → 保持稀疏
      else cells[k] = next;
    }
  }
  return { ...page, cells };
}

/** 选区统一设置对齐；null = 恢复默认（删键） */
export function setAlign(page: SheetPage, range: GridRange, a: SheetCellStyle["a"] | null): SheetPage {
  return withStyle(page, range, (style) => {
    if (a === null) delete style.a;
    else style.a = a;
  });
}

/** 选区统一设置数字格式；null = 常规 */
export function setNumfmt(page: SheetPage, range: GridRange, f: SheetCellStyle["f"] | null): SheetPage {
  return withStyle(page, range, (style) => {
    if (f === null) delete style.f;
    else style.f = f;
  });
}

/** 选区统一设置文字/背景色（存色板 id）；null = 清除该颜色 */
export function setColor(page: SheetPage, range: GridRange, kind: "fg" | "bg", id: string | null): SheetPage {
  return withStyle(page, range, (style) => {
    if (id === null) delete style[kind];
    else style[kind] = id;
  });
}

/** 选区内逐格改样式键（空文本且无样式的格子维持原稀疏策略） */
function withStyle(page: SheetPage, range: GridRange, mutate: (style: SheetCellStyle) => void): SheetPage {
  const cells = { ...page.cells };
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const k = refKey(c, r);
      const prev: SheetCell = cells[k] ?? { v: "" };
      const style: SheetCellStyle = { ...prev.s };
      mutate(style);
      const next = { ...prev, s: style };
      if (next.v === "" && !next.s) delete cells[k];
      else cells[k] = next;
    }
  }
  return { ...page, cells };
}

/** 清空选区内容（保留行列规模） */
export function clearRange(page: SheetPage, range: GridRange): SheetPage {
  const cells = { ...page.cells };
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      delete cells[refKey(c, r)];
    }
  }
  return { ...page, cells };
}

/** cells 键整体平移（行/列插入删除共用的坐标重排） */
function mapCells(
  cells: SheetPage["cells"],
  f: (pos: { col: number; row: number }) => { col: number; row: number } | null,
): SheetPage["cells"] {
  const next: SheetPage["cells"] = {};
  for (const [key, cell] of Object.entries(cells)) {
    const pos = parseRefKey(key);
    if (!pos) continue; // 不合法键直接丢弃（防御历史脏数据）
    const to = f(pos);
    if (to) next[refKey(to.col, to.row)] = cell;
  }
  return next;
}

/** 公式引用随行列平移改写（与 mapCells 同一映射规则） */
function mapFormulas(cells: SheetPage["cells"], axis: "row" | "col", mapCoord: (n: number) => number): void {
  for (const [key, cell] of Object.entries(cells)) {
    if (cell.v.startsWith("=")) {
      cells[key] = { ...cell, v: shiftFormulaRefs(cell.v, axis, mapCoord) };
    }
  }
}

/** 在 at 行之前插入一行；已达行数上限返回 null（调用方提示） */
export function insertRow(page: SheetPage, at: number): SheetPage | null {
  if (page.rows >= SHEET_MAX_ROWS) return null;
  const cells = mapCells(page.cells, (p) => (p.row >= at ? { col: p.col, row: p.row + 1 } : p));
  mapFormulas(cells, "row", (n) => (n >= at ? n + 1 : n));
  return { ...page, rows: page.rows + 1, cells, rowHeights: shiftSizeMap(page.rowHeights, at, 1) };
}

/** 删除 at 行：引用 at 行的公式改指补位行（Excel 会变 #REF!，这里保持可用性优先） */
export function deleteRow(page: SheetPage, at: number): SheetPage {
  const cells = mapCells(page.cells, (p) => {
    if (p.row === at) return null;
    return p.row > at ? { col: p.col, row: p.row - 1 } : p;
  });
  mapFormulas(cells, "row", (n) => (n > at ? n - 1 : n));
  return { ...page, rows: Math.max(1, page.rows - 1), cells, rowHeights: shiftSizeMap(page.rowHeights, at, -1) };
}

/** 在 at 列之前插入一列；已达列数上限返回 null */
export function insertCol(page: SheetPage, at: number): SheetPage | null {
  if (page.cols >= SHEET_MAX_COLS) return null;
  const cells = mapCells(page.cells, (p) => (p.col >= at ? { col: p.col + 1, row: p.row } : p));
  mapFormulas(cells, "col", (n) => (n >= at ? n + 1 : n));
  return { ...page, cols: page.cols + 1, cells, colWidths: shiftSizeMap(page.colWidths, at, 1) };
}

export function deleteCol(page: SheetPage, at: number): SheetPage {
  const cells = mapCells(page.cells, (p) => {
    if (p.col === at) return null;
    return p.col > at ? { col: p.col - 1, row: p.row } : p;
  });
  mapFormulas(cells, "col", (n) => (n > at ? n - 1 : n));
  return { ...page, cols: Math.max(1, page.cols - 1), cells, colWidths: shiftSizeMap(page.colWidths, at, -1) };
}

/** 行列覆盖表（列宽/行高）随增删平移：插入时 ≥at 的下标 +1；删除时 at 位移除、>at 的 -1 */
function shiftSizeMap(map: Record<string, number>, at: number, delta: 1 | -1): Record<string, number> {
  if (!Object.keys(map).length) return map;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k);
    if (delta === 1) out[String(i >= at ? i + 1 : i)] = v;
    else if (i !== at) out[String(i > at ? i - 1 : i)] = v;
  }
  return out;
}

/** 复制工作表：内容/样式/视图设置全量拷贝，仅换 id 与名称（本库全量不可变更新，浅拷贝安全） */
export function clonePage(page: SheetPage, name: string): SheetPage {
  return sheetPageSchema.parse({ ...page, id: uuid(), name });
}

/** 追加 n 行（封顶），用于焦点触底自动扩行与粘贴扩容 */
export function addRows(page: SheetPage, n: number): SheetPage {
  return { ...page, rows: Math.min(SHEET_MAX_ROWS, page.rows + n) };
}

/** 切换冻结窗格（首行/首列独立开关，组合出 none/row/col/both） */
export function toggleFrozen(page: SheetPage, kind: "row" | "col"): SheetPage {
  const hasRow = page.frozen === "row" || page.frozen === "both";
  const hasCol = page.frozen === "col" || page.frozen === "both";
  const row = kind === "row" ? !hasRow : hasRow;
  const col = kind === "col" ? !hasCol : hasCol;
  const frozen = row && col ? "both" : row ? "row" : col ? "col" : "none";
  return { ...page, frozen };
}

/**
 * 选区排序：以 by 列的显示值为键重排选区内各行（单元格对象整体随行移动，
 * 公式引用按位置语义不变——与 Excel 一致）。数字与数字比数值，其余按文本忽略
 * 大小写字典序；空格恒排最后。稳定排序保持同键原相对顺序；不足两行返回 null。
 */
export function sortRange(
  page: SheetPage,
  range: GridRange,
  by: { col: number; asc: boolean },
): SheetPage | null {
  const rowCount = range.r2 - range.r1 + 1;
  if (rowCount < 2) return null;
  const display = evaluateSheet(page.cells);
  const keyOf = (r: number): number | string | null => {
    const v = display.get(refKey(by.col, r));
    if (v === undefined) return null;
    if (typeof v === "number") return v;
    return formatCellValue(v).toLowerCase();
  };
  const order = Array.from({ length: rowCount }, (_, i) => range.r1 + i);
  order.sort((ra, rb) => {
    const a = keyOf(ra);
    const b = keyOf(rb);
    if (a === null && b === null) return 0;
    if (a === null) return 1; // 空格恒排最后，不随升降序翻转（Excel 观感）
    if (b === null) return -1;
    let cmp: number;
    if (typeof a === "number" && typeof b === "number") cmp = a - b;
    // 文本按中文区域排序（拼音序），与飞书/Excel 观感一致
    else cmp = String(a).localeCompare(String(b), "zh");
    return by.asc ? cmp : -cmp;
  });
  // 取出选区矩形内的格子快照，再按排序后的行号重新铺回
  const grid: (SheetCell | undefined)[][] = [];
  for (let i = 0; i < rowCount; i++) {
    grid.push([]);
    for (let c = range.c1; c <= range.c2; c++) grid[i]!.push(page.cells[refKey(c, range.r1 + i)]);
  }
  const cells = { ...page.cells };
  order.forEach((srcRow, dstIdx) => {
    for (let c = range.c1; c <= range.c2; c++) {
      const cell = grid[srcRow - range.r1]![c - range.c1]!;
      const key = refKey(c, range.r1 + dstIdx);
      if (cell) cells[key] = cell;
      else delete cells[key];
    }
  });
  return { ...page, cells };
}

/**
 * 填充柄：以 src 为模板填充 dst（dst 必须是 src 沿单轴的延伸，且包含 src）。
 * 目标格沿填充轴按 src 长度取模回溯到源格：值照抄、公式引用按位移平移（Excel 相对引用）、
 * 样式随行；src 自身的格子不动，目标处原有内容被覆盖。
 */
export function fillRange(page: SheetPage, src: GridRange, dst: GridRange): SheetPage {
  const axis: "col" | "row" = dst.c1 !== src.c1 || dst.c2 !== src.c2 ? "col" : "row";
  const srcLen = axis === "col" ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
  const cells = { ...page.cells };
  for (let r = dst.r1; r <= dst.r2; r++) {
    for (let c = dst.c1; c <= dst.c2; c++) {
      if (c >= src.c1 && c <= src.c2 && r >= src.r1 && r <= src.r2) continue; // 源区不动
      // 双向填充都成立：负方向位移取正模（向左/向上填充时源在尾部循环）
      const back = (((axis === "col" ? c - src.c1 : r - src.r1) % srcLen) + srcLen) % srcLen;
      const fromC = axis === "col" ? src.c1 + back : c;
      const fromR = axis === "row" ? src.r1 + back : r;
      const from = cells[refKey(fromC, fromR)];
      const v = from ? (from.v.startsWith("=") ? offsetFormulaRefs(from.v, c - fromC, r - fromR) : from.v) : "";
      const key = refKey(c, r);
      if (v === "" && !from?.s) delete cells[key];
      else cells[key] = { v, ...(from?.s ? { s: from.s } : {}) };
    }
  }
  return { ...page, cells };
}

/** 从 start 起写入一块文本（粘贴展开）；行列不足时按需扩容（封顶），返回写到的结束坐标 */
export function writeBlock(
  page: SheetPage,
  start: GridPos,
  block: string[][],
): { page: SheetPage; end: GridPos } {
  const needRows = start.r + block.length;
  const needCols = start.c + Math.max(...block.map((line) => line.length), 1);
  let next: SheetPage = {
    ...page,
    rows: Math.max(page.rows, Math.min(SHEET_MAX_ROWS, needRows)),
    cols: Math.max(page.cols, Math.min(SHEET_MAX_COLS, needCols)),
  };
  let end = start;
  block.forEach((line, dr) => {
    line.forEach((text, dc) => {
      const c = start.c + dc;
      const r = start.r + dr;
      if (c >= next.cols || r >= next.rows) return; // 超出封顶的部分丢弃
      next = writeCell(next, { c, r }, text);
      if (c >= end.c || r >= end.r) end = { c: Math.max(end.c, c), r: Math.max(end.r, r) };
    });
  });
  return { page: next, end };
}

/** 选区显示值 → TSV（复制/剪切用，公式格取计算结果） */
export function rangeTsv(page: SheetPage, range: GridRange): string {
  const display = evaluateSheet(page.cells);
  const lines: string[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    const cols: string[] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const v = display.get(refKey(c, r));
      cols.push(v === undefined ? "" : formatCellValue(v));
    }
    lines.push(cols.join("\t"));
  }
  return lines.join("\n");
}

/** 解析粘贴文本 → 文本块（无制表/换行则视为单格输入） */
export function parseClipboardTsv(text: string): string[][] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.split("\t"));
}

function csvQuote(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * 页签 → CSV：仅导出有数据的矩形范围（行/列到最大使用位为止），
 * 公式格取计算结果；多页签合并为一个文件时以「# 页签名」分节（CSV 单表语义放不下多页签，
 * 分节行用 # 前缀便于 Excel/文本编辑器中肉眼区分）。
 */
export function pagesToCsv(pages: SheetPage[]): string {
  const sections = pages.map((page) => {
    let maxRow = -1;
    let maxCol = -1;
    for (const key of Object.keys(page.cells)) {
      const pos = parseRefKey(key);
      if (!pos) continue;
      maxRow = Math.max(maxRow, pos.row);
      maxCol = Math.max(maxCol, pos.col);
    }
    if (maxRow < 0) return "";
    const display = evaluateSheet(page.cells);
    const lines: string[] = [];
    for (let r = 0; r <= maxRow; r++) {
      const cols: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        const v = display.get(refKey(c, r));
        cols.push(csvQuote(v === undefined ? "" : formatCellValue(v)));
      }
      lines.push(cols.join(","));
    }
    return lines.join("\n");
  });
  const named = pages.map((page, i) => `# ${page.name}\n${sections[i]}`);
  const body = pages.length > 1 ? named.filter(Boolean).join("\n\n") : (sections[0] ?? "");
  return `${body}\n`;
}

/** 选区数值统计（状态栏 Σ）：空/无数字返回 null */
export function rangeStats(
  page: SheetPage,
  range: GridRange,
): { sum: number; avg: number; count: number } | null {
  const display: Map<string, SheetDisplayValue> = evaluateSheet(page.cells);
  let sum = 0;
  let count = 0;
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const v = display.get(refKey(c, r));
      if (typeof v === "number") {
        sum += v;
        count++;
      }
    }
  }
  return count ? { sum, avg: sum / count, count } : null;
}
