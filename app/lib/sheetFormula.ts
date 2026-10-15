/**
 * 在线表格公式引擎（纯函数，无副作用）：词法分析 → 递归下降解析 → AST 求值。
 * 目标是对标飞书/Excel 的常用子集：
 * - 运算：+ - * / % ^ &（字符串拼接）与比较 = <> < <= > >=
 * - 引用：A1（当前工作表）；区域 A1:B3 仅作为函数参数
 * - 函数：SUM AVERAGE MIN MAX COUNT COUNTA ROUND ABS IF AND OR NOT
 *   IFERROR SUMIF COUNTIF MEDIAN PRODUCT POWER SQRT MOD INT
 *   CONCAT(CONCATENATE) UPPER LOWER TRIM LEN
 * - 错误码：#ERROR!（语法）/ #DIV/0! / #NAME? / #VALUE! / #CIRC!（循环引用）
 * 引用是动态求值的（每次重算取目标格当前值），配合 evaluateSheet 的记忆化与环检测。
 */

export type CellValue = number | string | boolean;
export type FormulaErrorCode = "#ERROR!" | "#DIV/0!" | "#NAME?" | "#VALUE!" | "#CIRC!" | "#N/A" | "#REF!";
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

/** 千分位分组（maxDec 位小数；fixedDec=false 时去尾零） */
function groupThousands(n: number, maxDec: number, fixedDec = false): string {
  const fixed = fixedDec ? n.toFixed(maxDec) : String(Math.round(n * 10 ** maxDec) / 10 ** maxDec);
  const [int, dec] = fixed.split(".");
  const sign = int!.startsWith("-") ? "-" : "";
  const digits = sign ? int!.slice(1) : int!;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${dec ? `.${dec}` : ""}`;
}

/** 单元格数字格式（飞书工具栏的「常规/数值/百分比/货币」）：非数字一律原样展示 */
export function formatCellWithStyle(v: SheetDisplayValue, f: "number" | "percent" | "currency"): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return formatCellValue(v);
  if (f === "percent") return `${groupThousands(v * 100, 2)}%`;
  if (f === "currency") return `¥${groupThousands(v, 2, true)}`;
  return groupThousands(v, 2);
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

/** 取单值实参：区域退化取首个非空值（文本/取整类函数基本都传单格或字面量） */
function firstArg(a: Arg | undefined): CellValue | null {
  if (a === undefined) return null;
  if (a.k !== "range") return a.v;
  return a.v.find((v) => v !== null) ?? null;
}

/** ROUNDUP/ROUNDDOWN：按指定位数放大后向远离零 / 趋近零取整（Excel 语义） */
function roundToward(x: number, digits: number, dir: "up" | "down"): number {
  const f = Math.pow(10, digits);
  // 放大后的浮点误差先归一（如 8.2*10=81.999…），否则 ceil 会多进一位
  const scaled = Math.round(Math.abs(x) * f * 1e9) / 1e9;
  const r = dir === "up" ? Math.ceil(scaled) : Math.floor(scaled);
  return Math.sign(x) * (r / f);
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地时区日期（TODAY/NOW 展示用，不做时区换算） */
function formatDateValue(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
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

/* ----- 条件聚合（SUMIF/COUNTIF）：需要区域坐标做位置对齐，先于实参拍平处理 ----- */

/** 区域节点的逐格坐标+值（SUMIF 的求和区按位置平移对齐条件区） */
function rangeCells(
  node: Extract<EvalNode, { k: "range" }>,
  ctx: FormulaContext,
): { col: number; row: number; v: CellValue | null }[] {
  const out: { col: number; row: number; v: CellValue | null }[] = [];
  for (let r = node.r1; r <= node.r2; r++) {
    for (let c = node.c1; c <= node.c2; c++) out.push({ col: c, row: r, v: ctx.getCell(c, r) });
  }
  return out;
}

/**
 * 条件匹配器：条件形如 ">10" "<=5" "<>x" "=x" 或裸值（数值按大小、文本忽略大小写）。
 * 非数值格与数值条件比较时按不匹配处理（"<>"/“不等于”除外，Excel 语义近似）。
 */
function makeCriteria(crit: CellValue | null): (v: CellValue | null) => boolean {
  const raw = crit === null ? "" : toText(crit).trim();
  const m = /^(<>|>=|<=|=|>|<)?([\s\S]*)$/.exec(raw)!;
  const op = m[1] ?? "=";
  const rhsText = m[2]!.trim();
  const rhsNum = parseNumberLiteral(rhsText);
  return (v) => {
    if (rhsNum !== null) {
      let num: number | null = null;
      if (typeof v === "number") num = v;
      else if (typeof v === "boolean") num = v ? 1 : 0;
      else if (typeof v === "string") num = parseNumberLiteral(v);
      if (num === null) return op === "<>";
      switch (op) {
        case "=": return num === rhsNum;
        case "<>": return num !== rhsNum;
        case ">": return num > rhsNum;
        case ">=": return num >= rhsNum;
        case "<": return num < rhsNum;
        default: return num <= rhsNum;
      }
    }
    const s = v === null ? "" : toText(v).toLowerCase();
    const r = rhsText.toLowerCase();
    switch (op) {
      case "=": return s === r;
      case "<>": return s !== r;
      case ">": return s > r;
      case ">=": return s >= r;
      case "<": return s < r;
      default: return s <= r;
    }
  };
}

function condAggregate(name: string, node: Extract<EvalNode, { k: "call" }>, ctx: FormulaContext): CellValue {
  const asRange = (n: EvalNode): Extract<EvalNode, { k: "range" }> => {
    if (n.k !== "range") throw new FormulaRuntimeError("#VALUE!"); // 条件聚合的首参必须是区域
    return n;
  };
  if (name === "COUNTIF") {
    needArgs(name, node.args, 2);
    const range = asRange(node.args[0]!);
    const match = makeCriteria(evalNode(node.args[1]!, ctx));
    return rangeCells(range, ctx).filter((x) => match(x.v)).length;
  }
  // SUMIF/AVERAGEIF(条件区, 条件, [求值区])：求值区省略时对条件区自身；按位置平移对齐
  needArgs(name, node.args, 2, 3);
  const range = asRange(node.args[0]!);
  const match = makeCriteria(evalNode(node.args[1]!, ctx));
  const sumRect = asRange(node.args[2] ?? node.args[0]!);
  let sum = 0;
  let hit = 0;
  for (const x of rangeCells(range, ctx)) {
    if (!match(x.v)) continue;
    const sc = sumRect.c1 + (x.col - range.c1);
    const sr = sumRect.r1 + (x.row - range.r1);
    if (sc > sumRect.c2 || sr > sumRect.r2) continue; // 求值区比条件区小：越界忽略
    const v = ctx.getCell(sc, sr);
    if (typeof v === "number") {
      sum += v;
      hit++;
    } else if (isFormulaErrorCode(v)) throw new FormulaRuntimeError(v);
  }
  if (name === "AVERAGEIF") {
    if (!hit) throw new FormulaRuntimeError("#DIV/0!");
    return sum / hit;
  }
  return sum;
}

/**
 * VLOOKUP/HLOOKUP：在区域首列（或首行）找查找值，返回第 index 列（或行）的值。
 * 第四参省略或 FALSE = 精确匹配（未找到 #N/A）——与 Excel 缺省 TRUE 不同：
 * 实际数据多为未排序，缺省按精确更安全；TRUE = 近似匹配（假定升序，取 ≤ 查找值的最后一条）。
 * 比较沿用条件聚合语义：数字比大小、文本忽略大小写。
 */
function lookupFunction(name: string, node: Extract<EvalNode, { k: "call" }>, ctx: FormulaContext): CellValue {
  needArgs(name, node.args, 3, 4);
  const lookup = evalNode(node.args[0]!, ctx);
  const rect = node.args[1]!;
  if (rect.k !== "range") throw new FormulaRuntimeError("#VALUE!"); // 查找区域必须是区域引用
  const index = Math.trunc(toNumber(evalNode(node.args[2]!, ctx)));
  const approx = node.args[3] !== undefined && toBool(evalNode(node.args[3], ctx));
  const vertical = name === "VLOOKUP";
  const span = vertical ? rect.r2 - rect.r1 + 1 : rect.c2 - rect.c1 + 1; // 首列/首行的条目数
  if (index < 1) throw new FormulaRuntimeError("#VALUE!");
  if (index > (vertical ? rect.c2 - rect.c1 + 1 : rect.r2 - rect.r1 + 1)) throw new FormulaRuntimeError("#REF!");
  const cmp = (a: CellValue | null, b: CellValue | null): number | null => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    const sa = a === null ? "" : toText(a).toLowerCase();
    const sb = b === null ? "" : toText(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
  let best: number | null = null; // 近似匹配：假定升序，记住 ≤ 查找值的最后一条
  for (let i = 0; i < span; i++) {
    const v = vertical ? ctx.getCell(rect.c1, rect.r1 + i) : ctx.getCell(rect.c1 + i, rect.r1);
    const c = cmp(v, lookup);
    if (c === null) continue;
    if (c === 0) {
      const hit = vertical ? ctx.getCell(rect.c1 + index - 1, rect.r1 + i) : ctx.getCell(rect.c1 + i, rect.r1 + index - 1);
      return hit ?? "";
    }
    if (c < 0) best = i;
    else if (approx) break; // 已越过查找值（升序假定），再扫只会更大
  }
  if (!approx || best === null) throw new FormulaRuntimeError("#N/A");
  const hit = vertical ? ctx.getCell(rect.c1 + index - 1, rect.r1 + best) : ctx.getCell(rect.c1 + best, rect.r1 + index - 1);
  return hit ?? "";
}

function callFunction(node: Extract<EvalNode, { k: "call" }>, ctx: FormulaContext): CellValue {
  const name = node.name;
  // IFERROR 需要短路求值（首参出错才算第二参），条件聚合需要区域坐标，都在实参拍平前处理
  if (name === "IFERROR") {
    needArgs(name, node.args, 2);
    try {
      return evalNode(node.args[0]!, ctx) ?? "";
    } catch (e) {
      if (e instanceof FormulaRuntimeError) return evalNode(node.args[1]!, ctx) ?? "";
      throw e;
    }
  }
  if (name === "SUMIF" || name === "COUNTIF" || name === "AVERAGEIF") return condAggregate(name, node, ctx);
  if (name === "VLOOKUP" || name === "HLOOKUP") return lookupFunction(name, node, ctx);
  if (name === "COUNTBLANK") {
    // 空格计数需要区域坐标（拍平后丢失矩形信息），在实参求值前处理
    needArgs(name, node.args, 1);
    const rect = node.args[0]!;
    if (rect.k !== "range") throw new FormulaRuntimeError("#VALUE!");
    return rangeCells(rect, ctx).filter((x) => x.v === null || x.v === "").length;
  }
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
    case "MEDIAN": {
      const nums = numericArgs(args).sort((x, y) => x - y);
      if (!nums.length) throw new FormulaRuntimeError("#VALUE!");
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
    }
    case "PRODUCT": return numericArgs(args).reduce((s, n) => s * n, 1);
    case "POWER": {
      needArgs(name, node.args, 2);
      const r = Math.pow(toNumber(evalNode(node.args[0]!, ctx)), toNumber(evalNode(node.args[1]!, ctx)));
      if (!Number.isFinite(r)) throw new FormulaRuntimeError("#ERROR!");
      return r;
    }
    case "SQRT": {
      needArgs(name, node.args, 1);
      const x = toNumber(evalNode(node.args[0]!, ctx));
      if (x < 0) throw new FormulaRuntimeError("#VALUE!"); // 负数开方无实数解（错误码集合无 #NUM!，就近用 #VALUE!）
      return Math.sqrt(x);
    }
    case "MOD": {
      needArgs(name, node.args, 2);
      const a = toNumber(evalNode(node.args[0]!, ctx));
      const b = toNumber(evalNode(node.args[1]!, ctx));
      if (b === 0) throw new FormulaRuntimeError("#DIV/0!");
      return a - b * Math.floor(a / b); // 符号跟随除数（Excel 语义）
    }
    case "INT": {
      needArgs(name, node.args, 1);
      return Math.floor(toNumber(evalNode(node.args[0]!, ctx)));
    }
    case "CONCAT":
    case "CONCATENATE": {
      needArgs(name, node.args, 1, 64);
      return args.map((a) => (a.k === "range" ? a.v.map(toText).join("") : toText(a.v))).join("");
    }
    case "UPPER": {
      needArgs(name, node.args, 1);
      return toText(evalNode(node.args[0]!, ctx)).toUpperCase();
    }
    case "LOWER": {
      needArgs(name, node.args, 1);
      return toText(evalNode(node.args[0]!, ctx)).toLowerCase();
    }
    case "TRIM": {
      needArgs(name, node.args, 1);
      // Excel TRIM：去首尾空白并把连续内部空白压成一个空格
      return toText(evalNode(node.args[0]!, ctx)).trim().replace(/\s+/g, " ");
    }
    case "LEN": {
      needArgs(name, node.args, 1);
      return toText(evalNode(node.args[0]!, ctx)).length;
    }
    case "LEFT": {
      needArgs(name, node.args, 1, 2);
      const n = args[1] === undefined ? 1 : Math.trunc(toNumber(firstArg(args[1])));
      if (n < 0) throw new FormulaRuntimeError("#VALUE!");
      return toText(firstArg(args[0])).slice(0, n);
    }
    case "RIGHT": {
      needArgs(name, node.args, 1, 2);
      const n = args[1] === undefined ? 1 : Math.trunc(toNumber(firstArg(args[1])));
      if (n < 0) throw new FormulaRuntimeError("#VALUE!");
      const s = toText(firstArg(args[0]));
      return n === 0 ? "" : s.slice(-n);
    }
    case "MID": {
      needArgs(name, node.args, 3);
      const start = Math.trunc(toNumber(firstArg(args[1])));
      const n = Math.trunc(toNumber(firstArg(args[2])));
      if (start < 1 || n < 0) throw new FormulaRuntimeError("#VALUE!");
      return toText(firstArg(args[0])).slice(start - 1, start - 1 + n);
    }
    case "SUBSTITUTE": {
      needArgs(name, node.args, 3, 4);
      const s = toText(firstArg(args[0]));
      const oldText = toText(firstArg(args[1]));
      const newText = toText(firstArg(args[2]));
      if (!oldText) return s; // 查找串为空：原样返回（Excel 语义）
      const nth = args[3] === undefined ? 0 : Math.trunc(toNumber(firstArg(args[3])));
      if (nth < 0) throw new FormulaRuntimeError("#VALUE!");
      if (!nth) return s.split(oldText).join(newText); // 未指定实例：全部替换
      // 只替换第 nth 次出现：逐段扫描定位
      let idx = -1;
      for (let i = 0; i < nth; i++) idx = s.indexOf(oldText, idx + 1);
      if (idx < 0) return s;
      return s.slice(0, idx) + newText + s.slice(idx + oldText.length);
    }
    case "FIND": {
      // FIND 区分大小写（Excel 语义；SEARCH 才忽略大小写），找不到/起点越界 → #VALUE!
      needArgs(name, node.args, 2, 3);
      const start = args[2] === undefined ? 1 : Math.trunc(toNumber(firstArg(args[2])));
      const s = toText(firstArg(args[1]));
      if (start < 1 || start > s.length + 1) throw new FormulaRuntimeError("#VALUE!");
      const idx = s.indexOf(toText(firstArg(args[0])), start - 1);
      if (idx < 0) throw new FormulaRuntimeError("#VALUE!");
      return idx + 1;
    }
    case "ROUNDUP": {
      needArgs(name, node.args, 1, 2);
      return roundToward(toNumber(firstArg(args[0])), args[1] === undefined ? 0 : toNumber(firstArg(args[1])), "up");
    }
    case "ROUNDDOWN": {
      needArgs(name, node.args, 1, 2);
      return roundToward(toNumber(firstArg(args[0])), args[1] === undefined ? 0 : toNumber(firstArg(args[1])), "down");
    }
    case "CEILING": {
      needArgs(name, node.args, 1, 2);
      const x = toNumber(firstArg(args[0]));
      const step = args[1] === undefined ? 1 : toNumber(firstArg(args[1]));
      if (step === 0) return 0; // Excel：显著性为 0 时 CEILING 恒为 0
      return Math.ceil(x / step) * step;
    }
    case "FLOOR": {
      needArgs(name, node.args, 1, 2);
      const x = toNumber(firstArg(args[0]));
      const step = args[1] === undefined ? 1 : toNumber(firstArg(args[1]));
      if (step === 0) throw new FormulaRuntimeError("#DIV/0!");
      return Math.floor(x / step) * step;
    }
    case "TODAY":
      return formatDateValue(new Date());
    case "NOW":
      return `${formatDateValue(new Date())} ${two(new Date().getHours())}:${two(new Date().getMinutes())}`;
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
 * 填充柄拖拽时整体平移公式引用（含区域端点）：所有引用加 (dc, dr) 偏移。
 * 相对引用语义与 Excel 一致——=A1+B1 下拉一格变 =A2+B2。
 * 偏移后越界（负坐标）的引用钳到 0，避免产生非法引用键；非法公式原样返回。
 */
export function offsetFormulaRefs(src: string, dc: number, dr: number): string {
  if (dc === 0 && dr === 0) return src;
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
    return src;
  }
  const clamp = (n: number, d: number) => Math.max(0, n + d);
  let out = "";
  let last = 0;
  const writeRef = (start: number, end: number, col: number, row: number) => {
    out += body.slice(last, start);
    out += refKey(clamp(col, dc), clamp(row, dr));
    last = end;
  };
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    if (s.tok.t !== "ref") continue;
    const colon = spans[i + 1];
    const next = spans[i + 2];
    if (colon?.tok.t === "punc" && colon.tok.v === ":" && next?.tok.t === "ref") {
      out += body.slice(last, s.start);
      const c1 = clamp(s.tok.col, dc);
      const r1 = clamp(s.tok.row, dr);
      const c2 = clamp(next.tok.col, dc);
      const r2 = clamp(next.tok.row, dr);
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
