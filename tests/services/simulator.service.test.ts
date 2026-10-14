import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~/repositories/db";
import { simService } from "~/services/simulator.service";
import { SIM_FIELDS, SIM_SAMPLE, type SimDocType } from "~/models/simDoc";

describe("simService（证件模拟器）", () => {
  beforeEach(async () => {
    await db.simDocs.clear();
  });

  it("getByType 未编辑过返回 null；save 首次落库可读回", async () => {
    expect(await simService.getByType("idCard")).toBeNull();
    await simService.save("idCard", { ...SIM_SAMPLE.idCard, name: "李四" });
    const doc = await simService.getByType("idCard");
    expect(doc?.data.name).toBe("李四");
    expect(doc?.data.idNumber).toBe(SIM_SAMPLE.idCard.idNumber);
  });

  it("save 裁剪：trim、长度封顶、未知键丢弃；同类型 upsert 复用 id", async () => {
    const first = await simService.save("idCard", {
      ...SIM_SAMPLE.idCard,
      name: "  王五  ",
      hacker: "<script>",
    });
    const second = await simService.save("idCard", { ...SIM_SAMPLE.idCard, name: "赵六" });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    const row = await simService.getByType("idCard");
    expect(row?.data.name).toBe("赵六");
    expect(Object.keys(row?.data ?? {})).not.toContain("hacker");

    const long = await simService.save("driverLicense", {
      ...SIM_SAMPLE.driverLicense,
      name: "超".repeat(50),
    });
    expect(long.data.name).toHaveLength(30); // 模型字段 max=30
  });

  it("photo：有 photo 的证面保留，无 photo 的证面丢弃；超大 dataURL 拒绝", async () => {
    const dataUrl = "data:image/jpeg;base64,xxx";
    const withPhoto = await simService.save("idCard", { ...SIM_SAMPLE.idCard, photo: dataUrl });
    expect(withPhoto.data.photo).toBe(dataUrl);
    // 营业执照版式没有人像位，photo 键即使传入也不落库
    const noPhoto = await simService.save("businessLicense", { ...SIM_SAMPLE.businessLicense, photo: dataUrl });
    expect(noPhoto.data.photo).toBeUndefined();
    await expect(
      simService.save("passport", { ...SIM_SAMPLE.passport, photo: `data:image/jpeg;base64,${"x".repeat(2_100_000)}` }),
    ).rejects.toThrow(/照片/);
  });

  it("reset 恢复内置样本，保留文档 id 与创建时间", async () => {
    const created = await simService.save("roadTransport", { ...SIM_SAMPLE.roadTransport, ownerName: "改名物流" });
    const reset = await simService.reset("roadTransport");
    expect(reset.id).toBe(created.id);
    expect(reset.data.ownerName).toBe(SIM_SAMPLE.roadTransport.ownerName);
    expect(reset.data).toEqual(SIM_SAMPLE.roadTransport);
  });

  it("list 返回全部已存证面并按更新时间倒序；未知类型报错", async () => {
    await simService.save("idCard", SIM_SAMPLE.idCard);
    await new Promise((r) => setTimeout(r, 5));
    await simService.save("passport", SIM_SAMPLE.passport);
    const list = await simService.list();
    expect(list.map((d) => d.type)).toEqual(["passport", "idCard"]);
    await expect(simService.save("ghost" as SimDocType, {})).rejects.toThrow(/不支持/);
    await expect(simService.reset("ghost" as SimDocType)).rejects.toThrow(/不支持/);
  });

  it("各证面字段配置与样本数据一一对应", () => {
    const types = ["idCard", "passport", "businessLicense", "roadTransport", "driverLicense"] as const;
    for (const type of types) {
      // 样本数据必须覆盖全部表单键，缺键会让编辑器首屏出现空字段
      const fieldKeys = SIM_FIELDS[type].map((f) => f.key).sort();
      expect(Object.keys(SIM_SAMPLE[type]).sort()).toEqual(fieldKeys);
    }
  });
});
