import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~/repositories/db";
import { flowService, FLOW_NODE_MAX, FLOW_NODE_MIN, FLOW_NODE_SIZE } from "~/services/flow.service";
import { flowNodeKinds } from "~/models/flow";

describe("flowService（应用级独立模块）", () => {
  beforeEach(async () => {
    await db.flows.clear();
  });

  it("create 落库并校验名称；list 按更新时间倒序", async () => {
    const a = await flowService.create("登录流程");
    const b = await flowService.create("审批流程");
    await expect(flowService.create("  ")).rejects.toThrow(/名称/);
    const list = await flowService.list();
    expect(list.map((f) => f.id)).toEqual([b.id, a.id]);
    expect((await flowService.get(a.id))!.name).toBe("登录流程");
    expect(await flowService.get("ghost")).toBeNull();
  });

  it("rename 重命名并拒空名；remove 删除文档", async () => {
    const f = await flowService.create("旧名");
    await flowService.rename(f.id, "新名");
    expect((await flowService.get(f.id))!.name).toBe("新名");
    await expect(flowService.rename(f.id, " ")).rejects.toThrow(/名称/);
    await flowService.remove(f.id);
    expect(await flowService.get(f.id)).toBeNull();
    expect(await flowService.list()).toHaveLength(0);
  });

  it("addNode 落库；空文字回退为类型名", async () => {
    const f = await flowService.create("主流程");
    const n1 = await flowService.addNode(f.id, { kind: "process", x: 10, y: 10, w: 144, h: 56, text: "审批" });
    const n2 = await flowService.addNode(f.id, { kind: "start", x: 0, y: 0, w: 96, h: 40, text: "  " });
    const got = (await flowService.get(f.id))!;
    expect(got.nodes).toHaveLength(2);
    expect(got.nodes.find((n) => n.id === n1.id)!.text).toBe("审批");
    expect(got.nodes.find((n) => n.id === n2.id)!.text).toBe("start");
  });

  it("moveNode/renameNode 更新节点；rename 拒绝空文字", async () => {
    const f = await flowService.create("主流程");
    const n = await flowService.addNode(f.id, { kind: "process", x: 0, y: 0, w: 144, h: 56, text: "A" });
    await flowService.moveNode(f.id, n.id, 120, 80);
    await flowService.renameNode(f.id, n.id, "审批通过");
    let got = (await flowService.get(f.id))!;
    expect(got.nodes[0]).toMatchObject({ x: 120, y: 80, text: "审批通过" });
    await expect(flowService.renameNode(f.id, n.id, " ")).rejects.toThrow(/不能为空/);
    got = (await flowService.get(f.id))!;
    expect(got.nodes[0]!.text).toBe("审批通过");
  });

  it("resizeNode 更新几何；尺寸夹取到安全区间；文档不存在报错", async () => {
    const f = await flowService.create("主流程");
    const n = await flowService.addNode(f.id, { kind: "process", x: 100, y: 100, w: 148, h: 56, text: "A" });
    await flowService.resizeNode(f.id, n.id, 100, 100, 320.4, 120.6);
    expect((await flowService.get(f.id))!.nodes[0]).toMatchObject({ x: 100, y: 100, w: 320, h: 121 });
    // 拖左上角：x/y 随对角锚定一起平移，尺寸低于下限时被夹取
    await flowService.resizeNode(f.id, n.id, 40, 36, 10, 5);
    expect((await flowService.get(f.id))!.nodes[0]).toMatchObject({ x: 40, y: 36, w: FLOW_NODE_MIN.w, h: FLOW_NODE_MIN.h });
    await flowService.resizeNode(f.id, n.id, 0, 0, 9999, 9999);
    expect((await flowService.get(f.id))!.nodes[0]).toMatchObject({ w: FLOW_NODE_MAX.w, h: FLOW_NODE_MAX.h });
    await expect(flowService.resizeNode("ghost", n.id, 0, 0, 100, 100)).rejects.toThrow(/不存在/);
  });

  it("removeNode 级联删除其所有连线", async () => {
    const f = await flowService.create("主流程");
    const a = await flowService.addNode(f.id, { kind: "start", x: 0, y: 0, w: 96, h: 40, text: "开始" });
    const b = await flowService.addNode(f.id, { kind: "process", x: 200, y: 0, w: 144, h: 56, text: "B" });
    const c = await flowService.addNode(f.id, { kind: "end", x: 400, y: 0, w: 96, h: 40, text: "结束" });
    await flowService.connect(f.id, a.id, b.id);
    await flowService.connect(f.id, b.id, c.id);
    expect((await flowService.get(f.id))!.edges).toHaveLength(2);
    await flowService.removeNode(f.id, b.id);
    const got = (await flowService.get(f.id))!;
    expect(got.nodes.map((n) => n.id)).toEqual([a.id, c.id]);
    expect(got.edges).toHaveLength(0);
  });

  it("connect 拒绝自环与不存在端点；重复连线去重", async () => {
    const f = await flowService.create("主流程");
    const a = await flowService.addNode(f.id, { kind: "start", x: 0, y: 0, w: 96, h: 40, text: "A" });
    const b = await flowService.addNode(f.id, { kind: "end", x: 200, y: 0, w: 96, h: 40, text: "B" });
    await expect(flowService.connect(f.id, a.id, a.id)).rejects.toThrow(/自身/);
    await expect(flowService.connect(f.id, a.id, "ghost")).rejects.toThrow(/不存在/);
    await flowService.connect(f.id, a.id, b.id, "通过");
    await flowService.connect(f.id, a.id, b.id);
    const got = (await flowService.get(f.id))!;
    expect(got.edges).toHaveLength(1);
    expect(got.edges[0]!.label).toBe("通过");
  });

  it("setEdgeLabel/removeEdge 编辑与删除连线", async () => {
    const f = await flowService.create("主流程");
    const a = await flowService.addNode(f.id, { kind: "start", x: 0, y: 0, w: 96, h: 40, text: "A" });
    const b = await flowService.addNode(f.id, { kind: "end", x: 200, y: 0, w: 96, h: 40, text: "B" });
    await flowService.connect(f.id, a.id, b.id);
    const edge = (await flowService.get(f.id))!.edges[0]!;
    await flowService.setEdgeLabel(f.id, edge.id, "  是  ");
    expect((await flowService.get(f.id))!.edges[0]!.label).toBe("是");
    await flowService.removeEdge(f.id, edge.id);
    expect((await flowService.get(f.id))!.edges).toHaveLength(0);
  });

  it("文档不存在时写操作报错", async () => {
    await expect(
      flowService.addNode("ghost", { kind: "process", x: 0, y: 0, w: 144, h: 56, text: "A" }),
    ).rejects.toThrow(/不存在或已被删除/);
  });

  it("形状库完整：每种 kind 都有默认尺寸且为正数", () => {
    for (const kind of flowNodeKinds) {
      const size = FLOW_NODE_SIZE[kind];
      expect(size.w).toBeGreaterThan(0);
      expect(size.h).toBeGreaterThan(0);
    }
  });

  it("多文档互不干扰（独立文档，不挂项目）", async () => {
    const f1 = await flowService.create("流程一");
    const f2 = await flowService.create("流程二");
    await flowService.addNode(f1.id, { kind: "start", x: 0, y: 0, w: 96, h: 40, text: "一" });
    expect((await flowService.get(f1.id))!.nodes).toHaveLength(1);
    expect((await flowService.get(f2.id))!.nodes).toHaveLength(0);
  });
});
