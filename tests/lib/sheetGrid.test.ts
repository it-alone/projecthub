import { describe, expect, it } from "vitest";
import { evaluateSheet } from "~/lib/sheetFormula";
import type { SheetPage } from "~/models/docSuite";
import {
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  addRows,
  clearRange,
  clonePage,
  deleteCol,
  fillRange,
  deleteRow,
  insertCol,
  insertRow,
  newPage,
  normRange,
  pagesToCsv,
  parseClipboardTsv,
  rangeStats,
  rangeTsv,
  setColor,
  setNumfmt,
  setAlign,
  sortRange,
  toggleFrozen,
  toggleStyle,
  writeBlock,
  writeCell,
} from "~/lib/sheetGrid";

const R = (c1: number, r1: number, c2: number, r2: number) => ({ c1, r1, c2, r2 });

describe("sheetGrid：单元格写入与样式", () => {
  it("newPage 默认 60×26、cells 稀疏为空", () => {
    const p = newPage("S");
    expect(p.rows).toBe(60);
    expect(p.cols).toBe(26);
    expect(p.cells).toEqual({});
  });

  it("writeCell：空文本且无样式时删除键保持稀疏", () => {
    const p = writeCell(newPage("S"), { c: 0, r: 0 }, "hi");
    expect(p.cells.A1?.v).toBe("hi");
    const cleared = writeCell(p, { c: 0, r: 0 }, "");
    expect(cleared.cells.A1).toBeUndefined();
  });

  it("toggleStyle/setAlign：样式合并、互不影响、可移除", () => {
    let p = writeCell(newPage("S"), { c: 0, r: 0 }, "x");
    p = toggleStyle(p, R(0, 0, 1, 0), "b", true); // A1:B1 同时加粗
    expect(p.cells.A1?.s?.b).toBe(true);
    expect(p.cells.B1?.s?.b).toBe(true);
    p = setAlign(p, R(0, 0, 0, 0), "center");
    expect(p.cells.A1?.s).toEqual({ b: true, a: "center" });
    p = toggleStyle(p, R(0, 0, 0, 0), "b", false); // 去粗保留对齐
    expect(p.cells.A1?.s?.b).toBeUndefined();
    expect(p.cells.A1?.s?.a).toBe("center");
    p = setAlign(p, R(0, 0, 0, 0), null); // 恢复默认对齐
    expect(p.cells.A1?.s?.a).toBeUndefined();
  });

  it("clearRange 清空选区内容（保留行列规模）", () => {
    let p = newPage("S");
    p = writeCell(writeCell(p, { c: 0, r: 0 }, "a"), { c: 1, r: 1 }, "b");
    p = clearRange(p, R(0, 0, 0, 0));
    expect(p.cells.A1).toBeUndefined();
    expect(p.cells.B2?.v).toBe("b");
    expect(p.rows).toBe(60);
  });
});

describe("sheetGrid：行列增删（单元格平移 + 公式改写）", () => {
  function fixture() {
    let p = newPage("S");
    p = writeCell(p, { c: 0, r: 1 }, "5"); // A2
    p = writeCell(p, { c: 3, r: 0 }, "=SUM(A2:A5)"); // D1
    return p;
  }

  it("insertRow：下方单元格下移，公式引用同步 +1", () => {
    const p = insertRow(fixture(), 1)!;
    expect(p.rows).toBe(61);
    expect(p.cells.A3?.v).toBe("5"); // 原 A2 → A3
    expect(p.cells.D1?.v).toBe("=SUM(A3:A6)");
  });

  it("deleteRow：删除行的数据消失，公式引用收缩；引用被删行的公式改指补位行", () => {
    let p = fixture();
    p = writeCell(p, { c: 4, r: 3 }, "=A2*2"); // E4 引用将被删除的 A2
    const next = deleteRow(p, 1);
    expect(next.rows).toBe(59);
    expect(next.cells.A2?.v).toBeUndefined(); // 原 A2 被删（其后无数据上移补位）
    expect(next.cells.E3?.v).toBe("=A2*2"); // E4 上移到 E3；引用被删行 → 改指补位行 A2，保持可用
    expect(next.cells.D1?.v).toBe("=SUM(A2:A4)");
  });

  it("insertCol / deleteCol 同理作用于列", () => {
    let p = newPage("S");
    p = writeCell(p, { c: 1, r: 0 }, "1"); // B1
    p = writeCell(p, { c: 5, r: 0 }, "=B1+C1"); // F1
    const inserted = insertCol(p, 1)!;
    expect(inserted.cols).toBe(27);
    expect(inserted.cells.C1?.v).toBe("1"); // B1 → C1
    expect(inserted.cells.G1?.v).toBe("=C1+D1"); // F1 → G1
    const deleted = deleteCol(inserted, 1);
    expect(deleted.cells.B1?.v).toBe("1"); // C1 → B1
    expect(deleted.cells.F1?.v).toBe("=B1+C1"); // G1 → F1
  });

  it("行/列数达上限时插入返回 null；addRows 封顶", () => {
    expect(insertRow(newPage("s", SHEET_MAX_ROWS, 10), 3)).toBeNull();
    expect(insertCol(newPage("s", 10, SHEET_MAX_COLS), 3)).toBeNull();
    expect(addRows(newPage("s", 490, 5), 20).rows).toBe(500);
    expect(addRows(newPage("s", 500, 5), 5).rows).toBe(500);
  });
});

describe("sheetGrid：剪贴板与导出", () => {
  it("writeBlock 按需扩容并返回结束坐标", () => {
    const { page, end } = writeBlock(newPage("S"), { c: 24, r: 58 }, [
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    expect(page.cols).toBe(27); // 24+3 超出 26 → 扩到 27
    expect(page.rows).toBe(60); // 58+2 恰好不超
    expect(end).toEqual({ c: 26, r: 59 });
    expect(page.cells.AA60?.v).toBe("f");
  });

  it("writeBlock 超出封顶的部分丢弃", () => {
    const { page, end } = writeBlock(newPage("s", SHEET_MAX_ROWS, SHEET_MAX_COLS), { c: 39, r: 499 }, [["x", "y"]]);
    expect(page.rows).toBe(SHEET_MAX_ROWS);
    expect(page.cols).toBe(SHEET_MAX_COLS);
    expect(page.cells.AN500?.v).toBe("x"); // 最后一格写入
    expect(end).toEqual({ c: 39, r: 499 });
  });

  it("rangeTsv 输出计算值（公式格取结果）", () => {
    let p = newPage("S");
    p = writeCell(writeCell(p, { c: 0, r: 0 }, "1"), { c: 1, r: 0 }, "=A1*2");
    expect(rangeTsv(p, R(0, 0, 1, 0))).toBe("1\t2");
    expect(rangeTsv(p, R(0, 0, 2, 0))).toBe("1\t2\t");
  });

  it("parseClipboardTsv 兼容 CRLF", () => {
    expect(parseClipboardTsv("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseClipboardTsv("x")).toEqual([["x"]]);
  });

  it("pagesToCsv：单页无分节头，多页以「# 页签名」分节；含逗号/引号/换行时加引号转义", () => {
    let p1 = newPage("P1");
    p1 = writeCell(writeCell(p1, { c: 0, r: 0 }, "1"), { c: 0, r: 1 }, "x,y");
    expect(pagesToCsv([p1])).toBe('1\n"x,y"\n');

    let p2 = newPage("P2");
    p2 = writeCell(writeCell(writeCell(p2, { c: 0, r: 0 }, "2"), { c: 1, r: 0 }, 'He said "hi"'), { c: 0, r: 1 }, "l1\nl2");
    expect(pagesToCsv([p1, p2])).toBe('# P1\n1\n"x,y"\n\n# P2\n2,"He said ""hi"""\n"l1\nl2",\n');
  });

  it("rangeStats 汇总数字（公式按显示值计），无数字返回 null", () => {
    let p = newPage("S");
    p = writeCell(writeCell(writeCell(writeCell(p, { c: 0, r: 0 }, "1"), { c: 1, r: 0 }, "=A1+1"), { c: 2, r: 0 }, "文本"), { c: 0, r: 1 }, "4");
    expect(rangeStats(p, R(0, 0, 2, 1))).toEqual({ sum: 7, avg: 7 / 3, count: 3 });
    expect(rangeStats(p, R(2, 0, 2, 1))).toBeNull();
  });

  it("normRange 端点取小大", () => {
    expect(normRange({ c: 3, r: 5 }, { c: 1, r: 2 })).toEqual({ c1: 1, r1: 2, c2: 3, r2: 5 });
  });
});

describe("fillRange：填充柄", () => {
  it("值照抄、样式随行、源区不动", () => {
    let p = newPage("S");
    p = writeCell(p, { c: 0, r: 0 }, "x");
    p = { ...p, cells: { ...p.cells, A1: { v: "x", s: { b: true } } } };
    p = fillRange(p, R(0, 0, 0, 0), R(0, 0, 0, 2));
    expect(p.cells.A1).toEqual({ v: "x", s: { b: true } });
    expect(p.cells.A2).toEqual({ v: "x", s: { b: true } });
    expect(p.cells.A3).toEqual({ v: "x", s: { b: true } });
  });

  it("公式按相对引用平移（下拉 =A1+B1 → =A2+B2）", () => {
    let p = newPage("S");
    p = writeCell(p, { c: 2, r: 0 }, "=A1+B1");
    p = fillRange(p, R(2, 0, 2, 0), R(2, 0, 2, 2));
    expect(p.cells.C2?.v).toBe("=A2+B2");
    expect(p.cells.C3?.v).toBe("=A3+B3");
  });

  it("多行源按行循环（周期 = 源长度）", () => {
    let p = newPage("S");
    p = writeCell(writeCell(p, { c: 0, r: 0 }, "a"), { c: 0, r: 1 }, "b");
    p = fillRange(p, R(0, 0, 0, 1), R(0, 0, 0, 3));
    expect(p.cells.A2?.v).toBe("b");
    expect(p.cells.A3?.v).toBe("a"); // 回到源首行
  });

  it("横向填充与向左（负方向）填充", () => {
    let p = newPage("S");
    p = writeCell(p, { c: 1, r: 0 }, "=B2");
    p = fillRange(p, R(1, 0, 1, 0), R(1, 0, 3, 0));
    expect(p.cells.C1?.v).toBe("=C2");
    expect(p.cells.D1?.v).toBe("=D2");
    // 源在 B1，向左填到 A1：引用同样左移一格
    p = fillRange(p, R(1, 0, 1, 0), R(0, 0, 1, 0));
    expect(p.cells.A1?.v).toBe("=A2");
  });

  it("空源格填充会清掉目标处已有内容（保持稀疏）", () => {
    let p = newPage("S");
    p = writeCell(p, { c: 0, r: 2 }, "old");
    p = fillRange(p, R(0, 0, 0, 0), R(0, 0, 0, 2));
    expect(p.cells.A3).toBeUndefined();
  });

  it("填充后公式立即可求值（evaluateSheet 联动）", () => {
    let p = newPage("S");
    p = writeCell(writeCell(p, { c: 0, r: 0 }, "1"), { c: 0, r: 1 }, "2");
    p = writeCell(p, { c: 1, r: 0 }, "=A1*10");
    p = fillRange(p, R(1, 0, 1, 0), R(1, 0, 1, 1));
    const display = evaluateSheet(p.cells);
    expect(display.get("B1")).toBe(10);
    expect(display.get("B2")).toBe(20);
  });
});

describe("样式扩展：数字格式与颜色", () => {
  const single = { c1: 0, r1: 0, c2: 0, r2: 0 };

  it("setNumfmt / setColor 设置与清除", () => {
    let p = writeCell(newPage("t"), { c: 0, r: 0 }, "12");
    p = setNumfmt(p, single, "currency");
    expect(p.cells.A1?.s?.f).toBe("currency");
    p = setColor(p, single, "bg", "soft-blue");
    expect(p.cells.A1?.s?.bg).toBe("soft-blue");
    p = setColor(p, single, "fg", "red");
    expect(p.cells.A1?.s?.fg).toBe("red");
    p = setNumfmt(p, single, null);
    expect(p.cells.A1?.s?.f).toBeUndefined();
    p = setColor(p, single, "bg", null);
    expect(p.cells.A1?.s?.bg).toBeUndefined();
    expect(p.cells.A1?.s?.fg).toBe("red"); // 清背景不影响文字色
  });

  it("toggleFrozen：行/列独立开关组合", () => {
    const p0 = newPage("t");
    expect(toggleFrozen(p0, "row").frozen).toBe("row");
    expect(toggleFrozen(toggleFrozen(p0, "row"), "col").frozen).toBe("both");
    expect(toggleFrozen(toggleFrozen(toggleFrozen(p0, "row"), "col"), "row").frozen).toBe("col");
    expect(toggleFrozen(toggleFrozen(toggleFrozen(toggleFrozen(p0, "row"), "col"), "row"), "col").frozen).toBe("none");
  });
});

describe("sortRange：选区排序", () => {
  const build = (): SheetPage => {
    let p = newPage("t");
    p = writeCell(p, { c: 0, r: 0 }, "香蕉");
    p = writeCell(p, { c: 1, r: 0 }, "3");
    p = writeCell(p, { c: 0, r: 1 }, "苹果");
    p = writeCell(p, { c: 1, r: 1 }, "1");
    p = writeCell(p, { c: 0, r: 2 }, "梨");
    p = writeCell(p, { c: 1, r: 2 }, "2");
    return p;
  };
  const range = { c1: 0, r1: 0, c2: 1, r2: 2 };

  it("升序按首列文本排，同行值随行移动", () => {
    const p = sortRange(build(), range, { col: 0, asc: true })!;
    expect(p.cells.A1?.v).toBe("梨"); // 拼音序：li < ping < xiang
    expect(p.cells.B1?.v).toBe("2");
    expect(p.cells.A2?.v).toBe("苹果");
    expect(p.cells.B2?.v).toBe("1");
    expect(p.cells.A3?.v).toBe("香蕉");
  });

  it("空值行恒排最后（降序也不翻到最前）", () => {
    let p = build();
    p = writeCell(p, { c: 0, r: 1 }, ""); // 苹果行首列清空
    const s = sortRange(p, range, { col: 0, asc: false })!;
    expect(s.cells.A1?.v).toBe("香蕉"); // 降序：xiang > li
    expect(s.cells.A2?.v).toBe("梨");
    expect(s.cells.A3?.v ?? "").toBe(""); // 空行沉底
  });

  it("数字列按数值排序；单行选区返回 null", () => {
    expect(sortRange(build(), { c1: 0, r1: 0, c2: 1, r2: 0 }, { col: 0, asc: true })).toBeNull();
    let p = newPage("t2");
    p = writeCell(p, { c: 0, r: 0 }, "10");
    p = writeCell(p, { c: 0, r: 1 }, "9");
    p = writeCell(p, { c: 0, r: 2 }, "2");
    const s = sortRange(p, { c1: 0, r1: 0, c2: 0, r2: 2 }, { col: 0, asc: true })!;
    expect(s.cells.A1?.v).toBe("2");
    expect(s.cells.A2?.v).toBe("9");
    expect(s.cells.A3?.v).toBe("10");
  });
});

describe("行高列宽随行列增删平移 + 复制工作表", () => {
  it("插入/删除行使 rowHeights 下标平移", () => {
    let p = newPage("t");
    p = { ...p, rowHeights: { "1": 60, "2": 40 } };
    const inserted = insertRow(p, 1)!;
    expect(inserted.rowHeights).toEqual({ "2": 60, "3": 40 });
    const removed = deleteRow(inserted, 2);
    expect(removed.rowHeights).toEqual({ "2": 40 });
  });

  it("插入/删除列使 colWidths 下标平移", () => {
    let p = newPage("t");
    p = { ...p, colWidths: { "0": 120, "2": 200 } };
    const removed = deleteCol(p, 0);
    expect(removed.colWidths).toEqual({ "1": 200 });
    const inserted = insertCol(p, 0)!;
    expect(inserted.colWidths).toEqual({ "1": 120, "3": 200 });
  });

  it("clonePage 换 id 换名，内容样式全量拷贝", () => {
    let p = newPage("源");
    p = writeCell(p, { c: 0, r: 0 }, "1");
    p = setNumfmt(p, { c1: 0, r1: 0, c2: 0, r2: 0 }, "currency");
    const copy = clonePage(p, "副本");
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe("副本");
    expect(copy.cells.A1?.v).toBe("1");
    expect(copy.cells.A1?.s?.f).toBe("currency");
  });
});
