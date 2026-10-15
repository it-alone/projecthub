/**
 * 在线表格公式引擎（纯函数，无副作用）：词法分析 → 递归下降解析 → AST 求值。
 * 目标是对标飞书/Excel 的常用子集：
 * - 运算：+ - * / % ^ &（字符串拼接）与比较 = <> < <= > >=
 * - 引用：A1（当前工作表）；区域 A1:B3 仅作为函数参数
 * - 函数：SUM AVERAGE MIN MAX COUNT COUNTA ROUND ABS IF AND OR NOT
 * - 错误码：#ERROR!（语法）/ #DIV/0! / #NAME? / #VALUE! / #CIRC!（循环引用）
 * 引用是动态求值的（每次重算取目标格当前值），配合 evaluateSheet 的记忆化与环检测。
 */

export type CellValue = number | string | boolean;
export type FormulaErrorCode = "#ERROR!" | "#DIV/0!" | "#NAME?" | "#VALUE!" | "#CIRC!";
export type FormulaResult = { ok: true; value: CellValue } | { ok: false; code: FormulaErrorCode };

/** 单元格展示值：正常值或错误码（错误码本身是 string，并集仅为语义可读） */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type SheetDisplayValue = CellValue | FormulaErrorCode;

/** 是否为 Excel 风格错误码（错误码会沿公式引用传播，展示层按危险色渲染） */
export function isFormulaErrorCode(v: SheetDisplayValue | null | undefined): v is FormulaErrorCode {
  return typeof v === "string" && v.startsWith("#") && v.endsWith("!");
}

/** 列号（0 基）转字母：0→A、25→Z、26→AA */
export function colToName(col: number): string {
  let n = col;
  let name = "";
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/** 0 基坐标 → A1 式引用键 */
export function refKey(col: number, row: number): string {
  return `${colToName(col)}${row + 1}`;
}

/** 单个列名（A / AB）→ 0 基列号；不合法返回 null */
function colNameToIndex(name: string): number | null {
  let col = 0;
  for (const ch of name.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    col = col * 26 + (code - 64);
  }
  return col - 1;
}

/** A1 式引用 → 0 基坐标；不合法返回 null */
export function parseRefKey(key: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]{1,3})([1-9]\d{0,4})$/.exec(key.trim());
  if (!m) return null;
  const col = colNameToIndex(m[1]!);
  return col === null ? null : { col, row: Number(m[2]) - 1 };
}

/** 识别数字字面量（避免 Number() 把 ""、"0x10"、Infinity 之类误判为数字） */
export function parseNumberLiteral(s: string): number | null {
  const t = s.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/* ---------------- 词法分析 ---------------- */

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; col: number; row: number }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "punc"; v: "(" | ")" | "," | ":" };

/** 带原文区间的 token：行列增删时按区间改写公式里的引用 */
export interface TokSpan {
  tok: Tok;
  start: number;
  end: number;
}

class FormulaSyntaxError extends Error {}

export function tokenizeSpans(src: string): TokSpan[] {
  const out: TokSpan[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const start = i;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === '"') {
      // 字符串字面量，"" 转义一个引号
      let s = "";
      i++;
      let closed = false;
      while (i < src.length) {
        const c = src[i]!;
        if (c === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        s += c;
        i++;
      }
      if (!closed) throw new FormulaSyntaxError("未闭合的字符串");
      out.push({ tok: { t: "str", v: s }, start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError("非法数字");
      i += m[0].length;
      out.push({ tok: { t: "num", v: Number(m[0]) }, start, end: i });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(src.slice(i))!;
      const word = m[0];
      i += word.length;
      // 形如 A1 / AB12 的是单元格引用（后面跟 ":" 时由解析器组成区域）
      const rm = /^([A-Za-z]{1,3})([1-9]\d{0,4})$/.exec(word);
      if (rm) {
        const col = colNameToIndex(rm[1]!);
        if (col !== null) {
          out.push({ tok: { t: "ref", col, row: Number(rm[2]) - 1 }, start, end: i });
          continue;
        }
      }
      // 其余按标识符处理（函数名 / TRUE / FALSE），统一大写便于匹配
      out.push({ tok: { t: "ident", v: word.toUpperCase() }, start, end: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      i += 2;
      out.push({ tok: { t: "op", v: two }, start, end: i });
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      i++;
      out.push({ tok: { t: "op", v: ch }, start, end: i });
      continue;
    }
    if ("(),:".includes(ch)) {
      i++;
      out.push({ tok: { t: "punc", v: ch as "(" | ")" | "," | ":" }, start, end: i });
      continue;
    }
    throw new FormulaSyntaxError(`意外字符 "${ch}"`);
  }
  return out;
}

/* ---------------- 语法分析（递归下降） ---------------- */

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; col: number; row: number }
  | { k: "range"; c1: number; r1: number; c2: number; r2: number }
  | { k: "un"; op: "-" | "+"; a: Node }
  | { k: "pct"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] };

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  private eat(v: string): boolean {
    const t = this.peek();
    if (t && ((t.t === "punc" || t.t === "op") && t.v === v)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expect(v: string): void {
    if (!this.eat(v)) throw new FormulaSyntaxError(`缺少 "${v}"`);
  }

  parse(): Node {
    const n = this.expr();
    if (this.pos < this.toks.length) throw new FormulaSyntaxError("存在多余内容");
    return n;
  }

  private expr(): Node {
    return this.cmp();
  }
  private cmp(): Node {
    let a = this.cat();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(t.v)) {
        this.pos++;
        a = { k: "bin", op: t.v, a, b: this.cat() };
      } else return a;
    }
  }
  private cat(): Node {
    let a = this.add();
    while (this.eat("&")) a = { k: "bin", op: "&", a, b: this.add() };
    return a;
  }
  private add(): Node {
    let a = this.mul();
    for (;;) {
      if (this.eat("+")) a = { k: "bin", op: "+", a, b: this.mul() };
      else if (this.eat("-")) a = { k: "bin", op: "-", a, b: this.mul() };
      else return a;
    }
  }
  private mul(): Node {
    let a = this.unary();
    for (;;) {
      if (this.eat("*")) a = { k: "bin", op: "*", a, b: this.unary() };
      else if (this.eat("/")) a = { k: "bin", op: "/", a, b: this.unary() };
      else return a;
    }
  }
  private unary(): Node {
    if (this.eat("-")) return { k: "un", op: "-", a: this.unary() };
    if (this.eat("+")) return { k: "un", op: "+", a: this.unary() };
    return this.power();
  }
  private power(): Node {
    const base = this.postfix();
    if (this.eat("^")) return { k: "bin", op: "^", a: base, b: this.unary() }; // 右结合
    return base;
  }
  private postfix(): Node {
    let a = this.primary();
    while (this.eat("%")) a = { k: "pct", a };
    return a;
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaSyntaxError("表达式不完整");
    if (t.t === "num") {
      this.pos++;
      return { k: "num", v: t.v };
    }
    if (t.t === "str") {
      this.pos++;
      return { k: "str", v: t.v };
    }
    if (t.t === "ident") {
      this.pos++;
      if (t.v === "TRUE") return { k: "bool", v: true };
      if (t.v === "FALSE") return { k: "bool", v: false };
      // 裸标识符（后面不是括号）按未知名称报 #NAME?，与未知函数一致（Excel 语义）
      const open = this.peek();
      if (!(open && open.t === "punc" && open.v === "(")) throw new FormulaRuntimeError("#NAME?");
      this.expect("(");
      const args: Node[] = [];
      if (!this.eat(")")) {
        do {
          args.push(this.expr());
        } while (this.eat(","));
        this.expect(")");
      }
      return { k: "call", name: t.v, args };
    }
    if (t.t === "ref") {
      this.pos++;
      const colon = this.peek();
      const next = this.toks[this.pos + 1];
      // ref ":" ref → 区域（端点规范化，A3:A1 等价 A1:A3）
      if (colon?.t === "punc" && colon.v === ":" && next?.t === "ref") {
        this.pos += 2;
        return {
          k: "range",
          c1: Math.min(t.col, next.col),
          r1: Math.min(t.row, next.row),
          c2: Math.max(t.col, next.col),
          r2: Math.max(t.row, next.row),
        };
      }
      return { k: "ref", col: t.col, row: t.row };
    }
    if (t.t === "punc" && t.v === "(") {
      this.pos++;
      const inner = this.expr();
      this.expect(")");
      return inner;
    }
    throw new FormulaSyntaxError("意外的符号");
  }
}

/* ---------------- 求值 ---------------- */

class FormulaRuntimeError extends Error {
  constructor(public readonly code: FormulaErrorCode) {
    super(code);
  }
}

export interface FormulaContext {
  /** 取单元格已求值的结果；null 表示空单元格 */
  getCell: (col: number, row: number) => CellValue | null;
}

/** 函数实参：标量或区域（区域仅出现在函数参数位置） */
type Arg = { k: "scalar"; v: CellValue | null } | { k: "range"; v: CellValue[] };

function toNumber(v: CellValue | null): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const lit = parseNumberLiteral(v);
  if (lit === null) throw new FormulaRuntimeError("#VALUE!");
  return lit;
}
function toText(v: CellValue | null): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatNumber(v);
  return v;
}
function toBool(v: CellValue | null): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const u = v.trim().toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  throw new FormulaRuntimeError("#VALUE!");
}
/** Excel 风格比较：数值按大小、字符串忽略大小写按字典序 */
function compare(op: string, a: CellValue | null, b: CellValue | null): boolean {
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "=": return a === b;
      case "<>": return a !== b;
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      default: return a >= b;
    }
  }
  const sa = toText(a).toLowerCase();
  const sb = toText(b).toLowerCase();
  switch (op) {
    case "=": return sa === sb;
    case "<>": return sa !== sb;
    case "<": return sa < sb;
    case "<=": return sa <= sb;
    case ">": return sa > sb;
    default: return sa >= sb;
  }
}

/** 数字转展示文本：去掉浮点尾差（0.1+0.2 → 0.3），超大数直接原样 */
function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "#ERROR!";
  if (v === 0) return "0";
  if (Math.abs(v) >= 1e12) return String(v);
  return String(Math.round(v * 1e10) / 1e10);
}

/** 展示格式：错误码原样；数字走 formatNumber；布尔大写（Excel 语义）；字符串按原文 */
export function formatCellValue(v: SheetDisplayValue): string {
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function needArgs(name: string, args: Node[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new FormulaRuntimeError("#ERROR!");
}

/** 拍平函数实参里的数字：区域中的非数字忽略（Excel 语义），错误码沿聚合传播 */
function numericArgs(args: Arg[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (a.k === "range") {
      for (const v of a.v) {
        if (isFormulaErrorCode(v)) throw new FormulaRuntimeError(v);
        if (typeof v === "number") out.push(v);
      }
    } else if (a.v !== null) {
      if (isFormulaErrorCode(a.v)) throw new FormulaRuntimeError(a.v);
      out.push(toNumber(a.v));
    }
  }
  return out;
}

/** 拍平布尔实参：数字按非 0，字符串认 TRUE/FALSE，区域里的其他值忽略 */
function boolArgs(args: Arg[]): boolean[] {
  const out: boolean[] = [];
  for (const a of args) {
    if (a.k === "range") {
      for (const v of a.v) {
        if (isFormulaErrorCode(v)) throw new FormulaRuntimeError(v);
        if (typeof v === "boolean") out.push(v);
        else if (typeof v === "number") out.push(v !== 0);
      }
    } else if (a.v !== null) {
      if (isFormulaErrorCode(a.v)) throw new FormulaRuntimeError(a.v);
      out.push(toBool(a.v));
    }
  }
  return out;
}

type EvalNode = Node;

function evalNode(node: EvalNode, ctx: FormulaContext): CellValue | null {
  switch (node.k) {
    case "num": return node.v;
    case "str": return node.v;
    case "bool": return node.v;
    case "ref": return ctx.getCell(node.col, node.row);
    case "range": throw new FormulaRuntimeError("#VALUE!"); // 区域只能作函数参数
    case "un": {
      const v = toNumber(evalNode(node.a, ctx));
      return node.op === "-" ? -v : v;
    }
    case "pct": return toNumber(evalNode(node.a, ctx)) / 100;
    case "bin": {
      const { op, a, b } = node;
      if (op === "&") return toText(evalNode(a, ctx)) + toText(evalNode(b, ctx));
      if (["=", "<>", "<", "<=", ">", ">="].includes(op)) {
        return compare(op, evalNode(a, ctx), evalNode(b, ctx));
      }
      const x = toNumber(evalNode(a, ctx));
      const y = toNumber(evalNode(b, ctx));
      switch (op) {
        case "+": return x + y;
        case "-": return x - y;
        case "*": return x * y;
        case "/":
          if (y === 0) throw new FormulaRuntimeError("#DIV/0!");
          return x / y;
        default: {
          const r = Math.pow(x, y);
          if (!Number.isFinite(r)) throw new FormulaRuntimeError("#ERROR!");
          return r;
        }
      }
    }
    case "call": return callFunction(node, ctx);
  }
}

function evalArg(node: EvalNode, ctx: FormulaContext): Arg {
  if (node.k === "range") {
    const vals: CellValue[] = [];
    for (let r = node.r1; r <= node.r2; r++) {
      for (let c = node.c1; c <= node.c2; c++) {
        const v = ctx.getCell(c, r);
        if (v !== null) vals.push(v);
      }
    }
    return { k: "range", v: vals };
  }
  return { k: "scalar", v: evalNode(node, ctx) };
}

function callFunction(node: Extract<EvalNode, { k: "call" }>, ctx: FormulaContext): CellValue {
  const name = node.name;
  const args = node.args.map((a) => evalArg(a, ctx));
  switch (name) {
    case "SUM": return numericArgs(args).reduce((s, n) => s + n, 0);
    case "AVERAGE": {
      const nums = numericArgs(args);
      if (!nums.length) throw new FormulaRuntimeError("#DIV/0!");
      return nums.reduce((s, n) => s + n, 0) / nums.length;
    }
    case "MIN": {
      const nums = numericArgs(args);
      return nums.length ? Math.min(...nums) : 0;
    }
    case "MAX": {
      const nums = numericArgs(args);
      return nums.length ? Math.max(...nums) : 0;
    }
    case "COUNT": return numericArgs(args).length;
    case "COUNTA": {
      // 非空计数：区域值已排除空格；标量实参只要传了就计数
      let n = 0;
      for (const a of args) n += a.k === "range" ? a.v.length : a.v === null ? 0 : 1;
      return n;
    }
    case "ROUND": {
      needArgs(name, node.args, 1, 2);
      const x = toNumber(evalNode(node.args[0]!, ctx));
      const d = node.args[1] === undefined ? 0 : Math.trunc(toNumber(evalNode(node.args[1], ctx)));
      const p = Math.pow(10, d);
      // 四舍五入远离零（Excel 语义：ROUND(0.5)=1、ROUND(-0.5)=-1）
      return (Math.sign(x) * Math.round(Math.abs(x) * p)) / p;
    }
    case "ABS": {
      needArgs(name, node.args, 1);
      return Math.abs(toNumber(evalNode(node.args[0]!, ctx)));
    }
    case "IF": {
      needArgs(name, node.args, 2, 3);
      if (!toBool(evalNode(node.args[0]!, ctx))) {
        return node.args[2] === undefined ? false : (evalNode(node.args[2], ctx) ?? false);
      }
      return evalNode(node.args[1]!, ctx) ?? false;
    }
    case "AND": {
      const bs = boolArgs(args);
      if (!bs.length) throw new FormulaRuntimeError("#VALUE!");
      return bs.every(Boolean);
    }
    case "OR": {
      const bs = boolArgs(args);
      if (!bs.length) throw new FormulaRuntimeError("#VALUE!");
      return bs.some(Boolean);
    }
    case "NOT": {
      needArgs(name, node.args, 1);
      return !toBool(evalNode(node.args[0]!, ctx));
    }
    default:
      throw new FormulaRuntimeError("#NAME?");
  }
}

/** 求值一条公式（以 = 开头；空串按空文本处理） */
export function evalFormula(src: string, ctx: FormulaContext): FormulaResult {
  const body = src.trim().replace(/^=/, "");
  if (!body) return { ok: true, value: "" };
  try {
    const toks = tokenizeSpans(body).map((s) => s.tok);
    const ast = new Parser(toks).parse();
    const value = evalNode(ast, ctx);
    return { ok: true, value: value ?? 0 }; // 公式结果为空引用时按 0 展示（Excel 语义）
  } catch (e) {
    if (e instanceof FormulaRuntimeError) return { ok: false, code: e.code };
    if (e instanceof FormulaSyntaxError) return { ok: false, code: "#ERROR!" };
    return { ok: false, code: "#ERROR!" };
  }
}

/**
 * 计算一个页签全部单元格的显示值：
 * - 字面量按类型解析（数字 / 原文本）
 * - 公式动态求值并记忆化；环上的格子得到 #CIRC!
 * 返回 Map 仅包含非空单元格（键为 A1 式引用）。
 */
export function evaluateSheet(cells: Record<string, { v?: string }>): Map<string, SheetDisplayValue> {
  const out = new Map<string, SheetDisplayValue>();
  const cache = new Map<string, SheetDisplayValue | null>(); // null = 空
  const visiting = new Set<string>();

  const evalCell = (col: number, row: number): SheetDisplayValue | null => {
    const key = refKey(col, row);
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) return "#CIRC!"; // 回边：环上所有格子最终都会得到该错误码
    const cell = cells[key];
    if (!cell || cell.v === undefined || cell.v === "") {
      cache.set(key, null);
      return null;
    }
    const raw = cell.v;
    if (!raw.startsWith("=")) {
      const num = parseNumberLiteral(raw);
      const lit: CellValue = num === null ? raw : num;
      cache.set(key, lit);
      out.set(key, lit);
      return lit;
    }
    visiting.add(key);
    let result: SheetDisplayValue;
    try {
      const r = evalFormula(raw, {
        getCell: (c, rw) => {
          const v = evalCell(c, rw);
          // 空格按空处理；错误码作为字符串值传递（引用错误格 → 结果也展示错误）
          return v === null ? null : v;
        },
      });
      result = r.ok ? r.value : r.code;
    } finally {
      visiting.delete(key);
    }
    cache.set(key, result);
    out.set(key, result);
    return result;
  };

  for (const key of Object.keys(cells)) {
    const pos = parseRefKey(key);
    if (pos) evalCell(pos.col, pos.row);
  }
  return out;
}

/**
 * 行列增删后改写公式里的引用（含区域端点）：
 * mapper 决定旧坐标 → 新坐标；被改写的引用按原 token 区间原位替换，其余原文保留。
 */
export function shiftFormulaRefs(src: string, axis: "row" | "col", mapCoord: (n: number) => number): string {
  let body = src;
  let eq = "";
  if (body.trimStart().startsWith("=")) {
    const idx = src.indexOf("=");
    eq = src.slice(0, idx + 1);
    body = src.slice(idx + 1);
  }
  let spans: TokSpan[];
  try {
    spans = tokenizeSpans(body);
  } catch {
    return src; // 公式本身不合法就不强求改写，原样保留
  }
  let out = "";
  let last = 0;
  const writeRef = (start: number, end: number, col: number, row: number) => {
    out += body.slice(last, start);
    out += refKey(axis === "col" ? mapCoord(col) : col, axis === "row" ? mapCoord(row) : row);
    last = end;
  };
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    if (s.tok.t !== "ref") continue;
    const colon = spans[i + 1];
    const next = spans[i + 2];
    if (colon?.tok.t === "punc" && colon.tok.v === ":" && next?.tok.t === "ref") {
      // 区域：两个端点一起改写，跨度取首 token 起点到末 token 终点
      out += body.slice(last, s.start);
      const c1 = axis === "col" ? mapCoord(s.tok.col) : s.tok.col;
      const r1 = axis === "row" ? mapCoord(s.tok.row) : s.tok.row;
      const c2 = axis === "col" ? mapCoord(next.tok.col) : next.tok.col;
      const r2 = axis === "row" ? mapCoord(next.tok.row) : next.tok.row;
      out += `${refKey(Math.min(c1, c2), Math.min(r1, r2))}:${refKey(Math.max(c1, c2), Math.max(r1, r2))}`;
      last = next.end;
      i += 2;
    } else {
      writeRef(s.start, s.end, s.tok.col, s.tok.row);
    }
  }
  out += body.slice(last);
  return eq + out;
}
