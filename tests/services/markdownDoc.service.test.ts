import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~/repositories/db";
import { markdownDocService, MARKDOWN_DOC_MAX_CHARS } from "~/services/markdownDoc.service";

describe("markdownDocService（应用级独立模块）", () => {
  beforeEach(async () => {
    await db.markdownDocs.clear();
    await db.preferences.clear();
  });

  it("create 落库并校验名称；list 按更新时间倒序", async () => {
    const a = await markdownDocService.create("会议纪要");
    const b = await markdownDocService.create("接口文档");
    await expect(markdownDocService.create("  ")).rejects.toThrow(/名称/);
    const list = await markdownDocService.list();
    expect(list.map((d) => d.id)).toEqual([b.id, a.id]);
    expect((await markdownDocService.get(a.id))!.name).toBe("会议纪要");
    expect((await markdownDocService.get(a.id))!.content).toBe("");
    expect(await markdownDocService.get("ghost")).toBeNull();
  });

  it("create 可带初始正文并截断超长内容", async () => {
    const d = await markdownDocService.create("长文", "x".repeat(MARKDOWN_DOC_MAX_CHARS + 100));
    expect(d.content).toHaveLength(MARKDOWN_DOC_MAX_CHARS);
  });

  it("rename 重命名并拒空名", async () => {
    const d = await markdownDocService.create("旧名");
    await markdownDocService.rename(d.id, "新名");
    expect((await markdownDocService.get(d.id))!.name).toBe("新名");
    await expect(markdownDocService.rename(d.id, " ")).rejects.toThrow(/名称/);
  });

  it("saveContent 更新正文与时间戳；文档不存在时报错", async () => {
    const d = await markdownDocService.create("草稿", "v1");
    await new Promise((r) => setTimeout(r, 5)); // 保证 updatedAt 可观察到推进
    await markdownDocService.saveContent(d.id, "v2");
    const got = (await markdownDocService.get(d.id))!;
    expect(got.content).toBe("v2");
    expect(Date.parse(got.updatedAt)).toBeGreaterThan(Date.parse(d.updatedAt));
    await expect(markdownDocService.saveContent("ghost", "x")).rejects.toThrow(/不存在/);
  });

  it("remove 删除文档；require 不存在时抛领域错误", async () => {
    const d = await markdownDocService.create("待删");
    await markdownDocService.remove(d.id);
    expect(await markdownDocService.get(d.id)).toBeNull();
    expect(await markdownDocService.list()).toHaveLength(0);
    await expect(markdownDocService.require("ghost")).rejects.toThrow(/不存在/);
  });

  it("多文档互不干扰（独立文档，不挂项目）", async () => {
    const d1 = await markdownDocService.create("文档一", "一");
    const d2 = await markdownDocService.create("文档二", "二");
    await markdownDocService.saveContent(d1.id, "一改");
    expect((await markdownDocService.get(d1.id))!.content).toBe("一改");
    expect((await markdownDocService.get(d2.id))!.content).toBe("二");
  });

  it("seedGuideIfNeeded 首次播种使用指南，置位后不再重复；删除后不复活", async () => {
    await markdownDocService.seedGuideIfNeeded();
    const seeded1 = await markdownDocService.list();
    expect(seeded1).toHaveLength(1);
    expect(seeded1[0]!.name).toBe("Markdown 使用指南");
    expect(seeded1[0]!.content).toContain("# 欢迎使用 Markdown 文档");

    // 已置位：即使指南被删光也不再自动出现
    await markdownDocService.remove(seeded1[0]!.id);
    await markdownDocService.seedGuideIfNeeded();
    expect(await markdownDocService.list()).toHaveLength(0);
  });

  it("seedGuideIfNeeded 并发调用只播种一篇（StrictMode 双挂载场景）", async () => {
    await Promise.all([markdownDocService.seedGuideIfNeeded(), markdownDocService.seedGuideIfNeeded()]);
    expect(await markdownDocService.list()).toHaveLength(1);
  });
});
