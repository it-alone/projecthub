import { describe, expect, it } from "vitest";
import {
  colToName,
  evalFormula,
  evaluateSheet,
  formatCellWithStyle,
  formatCellValue,
  isFormulaErrorCode,
  parseNumberLiteral,
  parseRefKey,
  refKey,
  offsetFormulaRefs,
  shiftFormulaRefs,
} from "~/lib/sheetFormula";

/** 构造取值上下文：坐标 → 字面值（数字字符串自动按数字） */
function ctxOf(map: Record<string, string>) {
  return {
    getCell: (col: number, row: number) => {
      const raw = map[refKey(col, row)];
      if (raw === undefined) return null;
      const num = parseNumberLiteral(raw);
      return (num === null ? raw : num) as number | string | null;
    },
  };
}

describe("引用坐标换算", () => {
  it("colToName：0→A、25→Z、26→AA、702→AAA", () => {
    expect(colToName(0)).toBe("A");
    expect(colToName(25)).toBe("Z");
    expect(colToName(26)).toBe("AA");
    expect(colToName(52)).toBe("BA");
    expect(colToName(702)).toBe("AAA");
  });

  it("refKey / parseRefKey 互逆；非法输入返回 null", () => {
    expect(refKey(0, 0)).toBe("A1");
    expect(refKey(27, 118)).toBe("AB119");
    expect(parseRefKey("AB119")).toEqual({ col: 27, row: 118 });
    expect(parseRefKey("A0")).toBeNull();
    expect(parseRefKey("AAAA1")).toBeNull();
    expect(parseRefKey("1A")).toBeNull();
  });
});

describe("evalFormula：运算与字面量", () => {
  it("四则/幂/取余与优先级", () => {
    expect(evalFormula("=1+2*3", ctxOf({}))).toEqual({ ok: true, value: 7 });
    expect(evalFormula("=(1+2)*3", ctxOf({}))).toEqual({ ok: true, value: 9 });
    expect(evalFormula("=2^10", ctxOf({}))).toEqual({ ok: true, value: 1024 });
    expect(evalFormula("=50%", ctxOf({}))).toEqual({ ok: true, value: 0.5 });
    expect(evalFormula("=-3+1", ctxOf({}))).toEqual({ ok: true, value: -2 });
    expect(evalFormula("=2^-1", ctxOf({}))).toEqual({ ok: true, value: 0.5 });
  });

  it("字符串字面量与拼接、比较运算", () => {
    expect(evalFormula('="a"&"b"', ctxOf({}))).toEqual({ ok: true, value: "ab" });
    expect(evalFormula('="He said ""hi"""', ctxOf({}))).toEqual({ ok: true, value: 'He said "hi"' });
    expect(evalFormula("=1<2", ctxOf({}))).toEqual({ ok: true, value: true });
    expect(evalFormula('="ABC"="abc"', ctxOf({}))).toEqual({ ok: true, value: true });
    expect(evalFormula("=1<>2", ctxOf({}))).toEqual({ ok: true, value: true });
    expect(evalFormula("=2>=3", ctxOf({}))).toEqual({ ok: true, value: false });
  });

  it("引用单元格参与运算（小写引用、空格容忍）", () => {
    const ctx = ctxOf({ A1: "10", B1: "4" });
    expect(evalFormula("=a1+b1", ctx)).toEqual({ ok: true, value: 14 });
    expect(evalFormula("= A1 * 2 ", ctx)).toEqual({ ok: true, value: 20 });
  });

  it("错误：除零 / 未知函数 / 未知标识符 / 语法错误", () => {
    expect(evalFormula("=1/0", ctxOf({}))).toEqual({ ok: false, code: "#DIV/0!" });
    expect(evalFormula("=FOO(1)", ctxOf({}))).toEqual({ ok: false, code: "#NAME?" });
    expect(evalFormula("=NOBODY", ctxOf({}))).toEqual({ ok: false, code: "#NAME?" });
    expect(evalFormula("=1+", ctxOf({}))).toEqual({ ok: false, code: "#ERROR!" });
    expect(evalFormula('="unclosed', ctxOf({}))).toEqual({ ok: false, code: "#ERROR!" });
    expect(evalFormula("=A1:B2", ctxOf({}))).toEqual({ ok: false, code: "#VALUE!" }); // 区域不能当标量
  });
});

describe("evalFormula：函数", () => {
  const ctx = ctxOf({ A1: "1", A2: "2", A3: "3", A4: "x", B1: "10" });

  it("SUM/AVERAGE/MIN/MAX/COUNT/COUNTA 与区域参数", () => {
    expect(evalFormula("=SUM(A1:A3)", ctx)).toEqual({ ok: true, value: 6 });
    expect(evalFormula("=SUM(A1,A3,B1)", ctx)).toEqual({ ok: true, value: 14 });
    expect(evalFormula("=AVERAGE(A1:A3)", ctx)).toEqual({ ok: true, value: 2 });
    expect(evalFormula("=MIN(A1:A3,0)", ctx)).toEqual({ ok: true, value: 0 });
    expect(evalFormula("=MAX(A1:A3,B1)", ctx)).toEqual({ ok: true, value: 10 });
    // 区域里的非数字忽略（Excel 语义），COUNT 只数数字
    expect(evalFormula("=COUNT(A1:A4)", ctx)).toEqual({ ok: true, value: 3 });
    expect(evalFormula("=COUNTA(A1:A4)", ctx)).toEqual({ ok: true, value: 4 });
    expect(evalFormula("=SUM(A1:A4)", ctx)).toEqual({ ok: true, value: 6 });
  });

  it("区域端点自动规范化（A3:A1 等价 A1:A3）", () => {
    expect(evalFormula("=SUM(A3:A1)", ctx)).toEqual({ ok: true, value: 6 });
  });

  it("ROUND 四舍五入远离零 / ABS / IF / AND / OR / NOT", () => {
    expect(evalFormula("=ROUND(2.5)", ctx)).toEqual({ ok: true, value: 3 });
    expect(evalFormula("=ROUND(-2.5)", ctx)).toEqual({ ok: true, value: -3 });
    expect(evalFormula("=ROUND(3.14159,2)", ctx)).toEqual({ ok: true, value: 3.14 });
    expect(evalFormula("=ABS(-8)", ctx)).toEqual({ ok: true, value: 8 });
    expect(evalFormula("=IF(A1>0,\"正\",\"负\")", ctx)).toEqual({ ok: true, value: "正" });
    expect(evalFormula("=IF(A1>9,\"大\")", ctx)).toEqual({ ok: true, value: false }); // 缺省 else 为 FALSE
    expect(evalFormula("=AND(A1>0,B1>0)", ctx)).toEqual({ ok: true, value: true });
    expect(evalFormula("=OR(A1>5,B1>5)", ctx)).toEqual({ ok: true, value: true });
    expect(evalFormula("=NOT(A1>5)", ctx)).toEqual({ ok: true, value: true });
  });

  it("函数嵌套调用", () => {
    expect(evalFormula("=SUM(A1:A2,MAX(A3,B1))", ctx)).toEqual({ ok: true, value: 13 });
    expect(evalFormula("=IF(SUM(A1:A3)=6,\"ok\",\"no\")", ctx)).toEqual({ ok: true, value: "ok" });
  });
});

describe("evaluateSheet：整表求值", () => {
  it("字面量按类型解析：数字串→数字，其余保持文本", () => {
    const out = evaluateSheet({ A1: { v: "3.14" }, A2: { v: "hello" }, A3: { v: "-2e2" } });
    expect(out.get("A1")).toBe(3.14);
    expect(out.get("A2")).toBe("hello");
    expect(out.get("A3")).toBe(-200);
  });

  it("公式链式引用逐格求值", () => {
    const out = evaluateSheet({ A1: { v: "2" }, B1: { v: "=A1*10" }, C1: { v: "=B1+5" } });
    expect(out.get("B1")).toBe(20);
    expect(out.get("C1")).toBe(25);
  });

  it("循环引用（含经区域的环）标记 #CIRC!", () => {
    expect(evaluateSheet({ A1: { v: "=B1" }, B1: { v: "=A1" } }).get("A1")).toBe("#CIRC!");
    expect(evaluateSheet({ A1: { v: "=SUM(A1:B1)" } }).get("A1")).toBe("#CIRC!");
  });

  it("引用空单元格按 0 参与运算；结果为空引用的公式按 0 展示", () => {
    const out = evaluateSheet({ A1: { v: "=Z9+1" }, B1: { v: "=Z9" } });
    expect(out.get("A1")).toBe(1);
    expect(out.get("B1")).toBe(0);
  });

  it("错误码沿引用传播", () => {
    const out = evaluateSheet({ A1: { v: "=1/0" }, B1: { v: "=A1" } });
    expect(out.get("A1")).toBe("#DIV/0!");
    expect(isFormulaErrorCode(out.get("B1"))).toBe(true);
  });
});

describe("shiftFormulaRefs：行列增删后的公式改写", () => {
  it("插入行：引用行号 >= 插入点才 +1（含区域端点）", () => {
    const shiftDown = (n: number) => (n >= 3 ? n + 1 : n);
    expect(shiftFormulaRefs("=B2+B4", "row", shiftDown)).toBe("=B2+B5");
    expect(shiftFormulaRefs("=SUM(B2:B7)", "row", shiftDown)).toBe("=SUM(B2:B8)");
    expect(shiftFormulaRefs("=SUM(A1:B7)", "row", shiftDown)).toBe("=SUM(A1:B8)");
  });

  it("插入列：只改列号，行号不动", () => {
    // 0 基列号：B=1 不动、C=2 起右移
    const shiftRight = (n: number) => (n >= 2 ? n + 1 : n);
    expect(shiftFormulaRefs("=B2+C2", "col", shiftRight)).toBe("=B2+D2");
    expect(shiftFormulaRefs("=SUM(C2:F2)", "col", shiftRight)).toBe("=SUM(D2:G2)");
  });

  it("区域端点交叉后自动重排（映射后首端点行号大于末端点 → 规范化）", () => {
    // 0 基行号：A2 的行 1 映射到 8、B7 的行 6 不动 → 交叉后按小大重排为 A7:B9
    expect(shiftFormulaRefs("=SUM(A2:B7)", "row", (n) => (n === 1 ? 8 : n))).toBe("=SUM(A7:B9)");
  });

  it("非公式文本与不合法公式原样返回", () => {
    expect(shiftFormulaRefs("plain text", "row", (n) => n + 1)).toBe("plain text");
    expect(shiftFormulaRefs("=1+", "row", (n) => n + 1)).toBe("=1+");
  });
});

describe("offsetFormulaRefs：填充柄相对引用平移", () => {
  it("单引用与区域端点都按 (dc, dr) 平移", () => {
    expect(offsetFormulaRefs("=A1+B1", 0, 1)).toBe("=A2+B2");
    expect(offsetFormulaRefs("=SUM(A1:B3)", 1, 2)).toBe("=SUM(B3:C5)");
    expect(offsetFormulaRefs("=A1*2", 2, 0)).toBe("=C1*2");
  });

  it("零偏移与非公式文本原样返回", () => {
    expect(offsetFormulaRefs("=A1+B1", 0, 0)).toBe("=A1+B1");
    expect(offsetFormulaRefs("plain", 1, 1)).toBe("plain");
  });

  it("负向平移越界钳到 0（A1 上移一格仍在 A1）", () => {
    expect(offsetFormulaRefs("=A1", -1, -1)).toBe("=A1");
    expect(offsetFormulaRefs("=B2+A1", -1, -1)).toBe("=A1+A1");
  });

  it("平移后仍可正常求值（下拉 =A1+B1 后引用下一行）", () => {
    const ctx = ctxOf({ A1: "1", B1: "2", A2: "10", B2: "20" });
    expect(evalFormula(offsetFormulaRefs("=A1+B1", 0, 1), ctx)).toEqual({ ok: true, value: 30 });
  });
});

describe("formatCellValue：展示格式", () => {
  it("去掉浮点尾差", () => {
    expect(formatCellValue(0.1 + 0.2)).toBe("0.3");
    expect(formatCellValue(1 / 3)).toBe("0.3333333333");
    expect(formatCellValue(0)).toBe("0");
    expect(formatCellValue("text")).toBe("text");
    expect(formatCellValue(true)).toBe("TRUE");
    expect(formatCellValue("#DIV/0!")).toBe("#DIV/0!");
  });
});

describe("新函数：文本与数学", () => {
  it("CONCAT / UPPER / LOWER / TRIM / LEN", () => {
    expect(evalFormula('=CONCAT("a","b")', ctxOf({}))).toEqual({ ok: true, value: "ab" });
    expect(evalFormula("=UPPER(A1)", ctxOf({ A1: "abc" }))).toEqual({ ok: true, value: "ABC" });
    expect(evalFormula("=LOWER(A1)", ctxOf({ A1: "ABC" }))).toEqual({ ok: true, value: "abc" });
    expect(evalFormula('=TRIM("  a   b  ")', ctxOf({}))).toEqual({ ok: true, value: "a b" });
    expect(evalFormula("=LEN(A1)", ctxOf({ A1: "hello" }))).toEqual({ ok: true, value: 5 });
  });

  it("POWER / SQRT / MOD / INT / MEDIAN / PRODUCT", () => {
    expect(evalFormula("=POWER(2,10)", ctxOf({}))).toEqual({ ok: true, value: 1024 });
    expect(evalFormula("=SQRT(16)", ctxOf({}))).toEqual({ ok: true, value: 4 });
    expect(evalFormula("=SQRT(-1)", ctxOf({}))).toEqual({ ok: false, code: "#VALUE!" });
    expect(evalFormula("=MOD(7,3)", ctxOf({}))).toEqual({ ok: true, value: 1 });
    expect(evalFormula("=MOD(-7,3)", ctxOf({}))).toEqual({ ok: true, value: 2 }); // 余数符号随除数
    expect(evalFormula("=MOD(7,0)", ctxOf({}))).toEqual({ ok: false, code: "#DIV/0!" });
    expect(evalFormula("=INT(-1.5)", ctxOf({}))).toEqual({ ok: true, value: -2 });
    expect(evalFormula("=MEDIAN(1,2,3,4)", ctxOf({}))).toEqual({ ok: true, value: 2.5 });
    expect(evalFormula("=PRODUCT(2,3,4)", ctxOf({}))).toEqual({ ok: true, value: 24 });
  });
});

describe("新函数：IFERROR 与条件聚合", () => {
  it("IFERROR 捕获错误回退、正常值直通", () => {
    expect(evalFormula('=IFERROR(1/0,"空")', ctxOf({}))).toEqual({ ok: true, value: "空" });
    expect(evalFormula("=IFERROR(10/2,0)", ctxOf({}))).toEqual({ ok: true, value: 5 });
    // 回退值自身出错则错误继续传播
    expect(evalFormula("=IFERROR(1/0,UNKNOWNFN())", ctxOf({}))).toEqual({ ok: false, code: "#NAME?" });
  });

  it("COUNTIF 支持比较符、裸值与文本", () => {
    const ctx = ctxOf({ A1: "10", A2: "20", A3: "30" });
    expect(evalFormula('=COUNTIF(A1:A3,">15")', ctx)).toEqual({ ok: true, value: 2 });
    expect(evalFormula("=COUNTIF(A1:A3,20)", ctx)).toEqual({ ok: true, value: 1 });
    expect(evalFormula('=COUNTIF(A1:A3,"<>10")', ctx)).toEqual({ ok: true, value: 2 });
    const texts = ctxOf({ A1: "苹果", A2: "梨" });
    expect(evalFormula('=COUNTIF(A1:A2,"苹果")', texts)).toEqual({ ok: true, value: 1 });
  });

  it("SUMIF 求和区平移对齐；省略时对条件区自身求和", () => {
    const ctx = ctxOf({ A1: "苹果", B1: "10", A2: "香蕉", B2: "20", A3: "苹果", B3: "30" });
    expect(evalFormula('=SUMIF(A1:A3,"苹果",B1:B3)', ctx)).toEqual({ ok: true, value: 40 });
    const nums = ctxOf({ A1: "5", A2: "15" });
    expect(evalFormula('=SUMIF(A1:A2,">10")', nums)).toEqual({ ok: true, value: 15 });
  });

  it("条件聚合首参不是区域时报 #VALUE!", () => {
    expect(evalFormula("=COUNTIF(10,\">1\")", ctxOf({}))).toEqual({ ok: false, code: "#VALUE!" });
  });
});

describe("formatCellWithStyle：数字格式", () => {
  it("数值千分位去尾零 / 货币固定两位 / 百分比", () => {
    expect(formatCellWithStyle(1234.5, "number")).toBe("1,234.5");
    expect(formatCellWithStyle(1234.567, "number")).toBe("1,234.57");
    expect(formatCellWithStyle(1234.5, "currency")).toBe("¥1,234.50");
    expect(formatCellWithStyle(0.1234, "percent")).toBe("12.34%");
    expect(formatCellWithStyle(-98765, "number")).toBe("-98,765");
  });

  it("非数字与错误码原样", () => {
    expect(formatCellWithStyle("abc", "number")).toBe("abc");
    expect(formatCellWithStyle("#DIV/0!", "percent")).toBe("#DIV/0!");
  });
});

describe("查找与引用函数（第四期）", () => {
  const fruit = ctxOf({ A1: "苹果", B1: "3", A2: "梨", B2: "1", A3: "香蕉", B3: "2" });

  it("VLOOKUP 精确匹配（缺省即精确）与未找到 #N/A", () => {
    expect(evalFormula('=VLOOKUP("梨", A1:B3, 2)', fruit)).toEqual({ ok: true, value: 1 });
    expect(evalFormula('=VLOOKUP("梨", A1:B3, 2, FALSE)', fruit)).toEqual({ ok: true, value: 1 });
    expect(evalFormula('=VLOOKUP("葡萄", A1:B3, 2)', fruit)).toEqual({ ok: false, code: "#N/A" });
  });

  it("VLOOKUP 近似匹配（升序假定）与列号越界", () => {
    const nums = ctxOf({ A1: "10", A2: "20", A3: "30", B1: "a", B2: "b", B3: "c" });
    expect(evalFormula("=VLOOKUP(25, A1:B3, 2, TRUE)", nums)).toEqual({ ok: true, value: "b" });
    expect(evalFormula("=VLOOKUP(5, A1:B3, 2, TRUE)", nums)).toEqual({ ok: false, code: "#N/A" });
    expect(evalFormula("=VLOOKUP(10, A1:B3, 3)", nums)).toEqual({ ok: false, code: "#REF!" });
    expect(evalFormula("=VLOOKUP(10, A1:B3, 0)", nums)).toEqual({ ok: false, code: "#VALUE!" });
  });

  it("HLOOKUP 按首行查找", () => {
    const wide = ctxOf({ A1: "名称", B1: "数量", A2: "苹果", B2: "5" });
    expect(evalFormula('=HLOOKUP("数量", A1:B2, 2)', wide)).toEqual({ ok: true, value: 5 });
    expect(evalFormula('=HLOOKUP("缺失", A1:B2, 2)', wide)).toEqual({ ok: false, code: "#N/A" });
  });

  it("AVERAGEIF / COUNTBLANK", () => {
    expect(evalFormula('=AVERAGEIF(A1:A3, "<>", B1:B3)', fruit)).toEqual({ ok: true, value: 2 });
    expect(evalFormula('=AVERAGEIF(A1:A3, "葡萄", B1:B3)', fruit)).toEqual({ ok: false, code: "#DIV/0!" });
    const blanks = ctxOf({ A1: "1", A2: "", A3: "3" });
    expect(evalFormula("=COUNTBLANK(A1:A5)", blanks)).toEqual({ ok: true, value: 3 }); // A2 空串 + A4/A5 未填
  });
});

describe("文本与取整函数（第四期）", () => {
  it("LEFT / RIGHT / MID 截取与越界", () => {
    expect(evalFormula('=LEFT("飞书表格", 2)', ctxOf({}))).toEqual({ ok: true, value: "飞书" });
    expect(evalFormula('=LEFT("abc")', ctxOf({}))).toEqual({ ok: true, value: "a" });
    expect(evalFormula('=RIGHT("飞书表格", 2)', ctxOf({}))).toEqual({ ok: true, value: "表格" });
    expect(evalFormula('=MID("ABCDEFG", 2, 3)', ctxOf({}))).toEqual({ ok: true, value: "BCD" });
    expect(evalFormula('=MID("ABC", 0, 2)', ctxOf({}))).toEqual({ ok: false, code: "#VALUE!" });
  });

  it("SUBSTITUTE 全量与指定实例；FIND 区分大小写", () => {
    expect(evalFormula('=SUBSTITUTE("a-b-c", "-", "+")', ctxOf({}))).toEqual({ ok: true, value: "a+b+c" });
    expect(evalFormula('=SUBSTITUTE("a-b-c", "-", "+", 2)', ctxOf({}))).toEqual({ ok: true, value: "a-b+c" });
    expect(evalFormula('=FIND("b", "abcabc", 4)', ctxOf({}))).toEqual({ ok: true, value: 5 });
    expect(evalFormula('=FIND("B", "abc")', ctxOf({}))).toEqual({ ok: false, code: "#VALUE!" });
  });

  it("ROUNDUP/ROUNDDOWN 远离/趋近零；CEILING/FLOOR 按显著性", () => {
    expect(evalFormula("=ROUNDUP(3.21, 1)", ctxOf({}))).toEqual({ ok: true, value: 3.3 });
    expect(evalFormula("=ROUNDUP(-3.21, 1)", ctxOf({}))).toEqual({ ok: true, value: -3.3 });
    expect(evalFormula("=ROUNDDOWN(3.99, 1)", ctxOf({}))).toEqual({ ok: true, value: 3.9 });
    expect(evalFormula("=ROUNDDOWN(-3.99, 1)", ctxOf({}))).toEqual({ ok: true, value: -3.9 });
    expect(evalFormula("=CEILING(7, 5)", ctxOf({}))).toEqual({ ok: true, value: 10 });
    expect(evalFormula("=CEILING(4.3)", ctxOf({}))).toEqual({ ok: true, value: 5 });
    expect(evalFormula("=CEILING(4.3, 0)", ctxOf({}))).toEqual({ ok: true, value: 0 });
    expect(evalFormula("=FLOOR(7, 5)", ctxOf({}))).toEqual({ ok: true, value: 5 });
    expect(evalFormula("=FLOOR(4.7)", ctxOf({}))).toEqual({ ok: true, value: 4 });
    expect(evalFormula("=FLOOR(4.7, 0)", ctxOf({}))).toEqual({ ok: false, code: "#DIV/0!" });
  });

  it("TODAY/NOW 输出本地时间格式", () => {
    const today = evalFormula("=TODAY()", ctxOf({}));
    const now = evalFormula("=NOW()", ctxOf({}));
    expect(today.ok && typeof today.value === "string" ? today.value : "").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(now.ok && typeof now.value === "string" ? now.value : "").toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
