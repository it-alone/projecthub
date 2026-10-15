import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~/repositories/db";
import { docFileService, DOC_CONTENT_MAX_CHARS } from "~/services/docFile.service";
import { newPage } from "~/lib/sheetGrid";
import { refKey } from "~/lib/sheetFormula";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("docFileService（在线文档套件）", () => {
  beforeEach(async () => {
    await db.docFiles.clear();
    await db.preferences.clear();
  });

  it("create：doc 带空正文、sheet 带默认页签；空名报错；list 按更新时间倒序", async () => {
    const docFile = await docFileService.create("doc", " 会议纪要 ");
    expect(docFile.title).toBe("会议纪要");
    expect(docFile.content).toEqual({ type: "doc", content: [] });
    expect(docFile.sheets).toEqual([]);

    const sheetFile = await docFileService.create("sheet", "预算表");
    expect(sheetFile.content).toBeNull();
    expect(sheetFile.sheets).toHaveLength(1);
    expect(sheetFile.sheets[0]!.name).toBe("工作表1");
    expect(sheetFile.sheets[0]!.rows).toBe(60);
    expect(sheetFile.sheets[0]!.cols).toBe(26);

    await expect(docFileService.create("doc", "  ")).rejects.toThrow(/名称/);

    await sleep(5);
    const c = await docFileService.create("doc", "最新");
    const list = await docFileService.list();
    expect(list.map((f) => f.id)).toEqual([c.id, sheetFile.id, docFile.id]);
    expect(await docFileService.get("ghost")).toBeNull();
  });

  it("rename 重命名并拒空名 / 不存在", async () => {
    const f = await docFileService.create("doc", "旧名");
    await docFileService.rename(f.id, "新名");
    expect((await docFileService.get(f.id))!.title).toBe("新名");
    await expect(docFileService.rename(f.id, " ")).rejects.toThrow(/名称/);
    await expect(docFileService.rename("ghost", "x")).rejects.toThrow(/不存在/);
  });

  it("saveDoc 保存正文与摘要（摘要截断 200），时间戳推进；超大内容报错", async () => {
    const f = await docFileService.create("doc", "草稿");
    await sleep(5);
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "v1" }] }] };
    await docFileService.saveDoc(f.id, content, "摘".repeat(300));
    const got = (await docFileService.get(f.id))!;
    expect(got.content).toEqual(content);
    expect(got.excerpt).toHaveLength(200);
    expect(Date.parse(got.updatedAt)).toBeGreaterThan(Date.parse(f.updatedAt));

    const huge = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(DOC_CONTENT_MAX_CHARS + 10) }] }] };
    await expect(docFileService.saveDoc(f.id, huge, "")).rejects.toThrow(/上限/);
    await expect(docFileService.saveDoc("ghost", content, "")).rejects.toThrow(/不存在/);
  });

  it("saveSheets 整体替换页签，落库前清掉空文本无样式的孤儿格", async () => {
    const f = await docFileService.create("sheet", "表");
    const p = newPage("数据");
    p.cells.A1 = { v: "1" };
    p.cells.B1 = { v: "", s: {} }; // 空文本无样式 → 应被清理
    p.cells.C1 = { v: "", s: { b: true } }; // 空文本但有样式 → 保留
    await docFileService.saveSheets(f.id, [p]);
    const saved = (await docFileService.get(f.id))!.sheets[0]!;
    expect(saved.cells.A1?.v).toBe("1");
    expect(saved.cells.B1).toBeUndefined();
    expect(saved.cells.C1?.s?.b).toBe(true);

    const next = newPage("第二页");
    next.cells.A1 = { v: "2" };
    await docFileService.saveSheets(f.id, [next]);
    expect((await docFileService.get(f.id))!.sheets).toHaveLength(1); // 整体替换
    await expect(docFileService.saveSheets("ghost", [next])).rejects.toThrow(/不存在/);
  });

  it("saveSheets 页签数与单元格总量上限", async () => {
    const f = await docFileService.create("sheet", "表");
    await expect(docFileService.saveSheets(f.id, Array.from({ length: 21 }, () => newPage("p")))).rejects.toThrow(/上限/);

    const big = newPage("big");
    for (let i = 0; i < 40001; i++) {
      big.cells[refKey(i % 40, Math.floor(i / 40))] = { v: "1" };
    }
    await expect(docFileService.saveSheets(f.id, [big])).rejects.toThrow(/上限/);
  });

  it("remove 删除；require 不存在时抛领域错误", async () => {
    const f = await docFileService.create("doc", "待删");
    await docFileService.remove(f.id);
    expect(await docFileService.get(f.id)).toBeNull();
    expect(await docFileService.list()).toHaveLength(0);
    await expect(docFileService.require("ghost")).rejects.toThrow(/不存在/);
  });

  it("seedSamplesIfNeeded 首次播种示例文档与公式表格，置位后不再重复、删除不复活", async () => {
    await docFileService.seedSamplesIfNeeded();
    const list = await docFileService.list();
    expect(list).toHaveLength(2);

    const seedDoc = list.find((f) => f.kind === "doc")!;
    expect(seedDoc.title).toBe("欢迎使用文档");
    expect(seedDoc.content).not.toBeNull();

    const seedSheet = list.find((f) => f.kind === "sheet")!;
    expect(seedSheet.title).toBe("销售数据 · 公式示例");
    const hasFormula = Object.values(seedSheet.sheets[0]!.cells).some((c) => c.v.startsWith("="));
    expect(hasFormula).toBe(true);

    // 已置位：删除示例后不再自动出现
    await docFileService.remove(seedDoc.id);
    await docFileService.remove(seedSheet.id);
    await docFileService.seedSamplesIfNeeded();
    expect(await docFileService.list()).toHaveLength(0);
  });

  it("seedSamplesIfNeeded 并发调用只播种一轮（StrictMode 双挂载场景）", async () => {
    await Promise.all([docFileService.seedSamplesIfNeeded(), docFileService.seedSamplesIfNeeded()]);
    expect(await docFileService.list()).toHaveLength(2);
  });

  it("多文件互不干扰", async () => {
    const a = await docFileService.create("doc", "甲");
    const b = await docFileService.create("sheet", "乙");
    await docFileService.saveDoc(a.id, { type: "doc", content: [] }, "甲摘");
    const pb = newPage("乙页");
    pb.cells.A1 = { v: "9" };
    await docFileService.saveSheets(b.id, [pb]);
    const ga = (await docFileService.get(a.id))!;
    const gb = (await docFileService.get(b.id))!;
    expect(ga.excerpt).toBe("甲摘");
    expect(ga.sheets).toHaveLength(0);
    expect(gb.sheets[0]!.cells.A1?.v).toBe("9");
    expect(gb.excerpt).toBe("");
  });
});
