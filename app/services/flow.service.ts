import { db } from "~/repositories/db";
import { uuid } from "~/lib/id";
import { t } from "~/lib/i18n";
import { flowSchema, type Flow, type FlowNode, type FlowNodeKind } from "~/models/flow";

/**
 * 流程图服务：应用级独立模块（同用户管理的本地文档模式，不挂项目权限）。
 * 列表/建图/重命名/删除 + 节点/连线整存整取；无软删除——画布编辑是高频小步操作，删除即时生效。
 */
export const flowService = {
  /** 全部流程图，按更新时间倒序（最近编辑优先） */
  async list(): Promise<Flow[]> {
    const rows = await db.flows.toArray();
    return rows
      .map((r) => flowSchema.parse(r))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async get(flowId: string): Promise<Flow | null> {
    const row = await db.flows.get(flowId);
    return row ? flowSchema.parse(row) : null;
  },

  async create(name: string): Promise<Flow> {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) throw new Error(t("errFlowNameRequired"));
    const now = new Date().toISOString();
    const flow: Flow = flowSchema.parse({
      id: uuid(),
      name: trimmed,
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.flows.add(flow);
    return flow;
  },

  async rename(flowId: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) throw new Error(t("errFlowNameRequired"));
    await db.flows.update(flowId, { name: trimmed, updatedAt: new Date().toISOString() });
  },

  async remove(flowId: string): Promise<void> {
    await db.flows.delete(flowId);
  },

  async addNode(flowId: string, node: Pick<FlowNode, "kind" | "x" | "y" | "w" | "h" | "text">): Promise<FlowNode> {
    const flow = await this.require(flowId);
    const next: FlowNode = { id: uuid(), ...node, text: node.text.trim() || node.kind };
    await db.flows.update(flow.id, {
      nodes: [...flow.nodes, next],
      updatedAt: new Date().toISOString(),
    });
    return next;
  },

  async moveNode(flowId: string, nodeId: string, x: number, y: number): Promise<void> {
    const flow = await this.require(flowId);
    await db.flows.update(flow.id, {
      nodes: flow.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * 节点缩放：拖左/上角会同时平移 x/y（对角锚定），尺寸夹取到安全区间，
   * 防止落库 0 尺寸（Zod positive 拒绝）或超出画布的巨型节点。
   */
  async resizeNode(flowId: string, nodeId: string, x: number, y: number, w: number, h: number): Promise<void> {
    const flow = await this.require(flowId);
    const cw = Math.round(Math.min(Math.max(w, FLOW_NODE_MIN.w), FLOW_NODE_MAX.w));
    const ch = Math.round(Math.min(Math.max(h, FLOW_NODE_MIN.h), FLOW_NODE_MAX.h));
    await db.flows.update(flow.id, {
      nodes: flow.nodes.map((n) =>
        n.id === nodeId ? { ...n, x: Math.round(x), y: Math.round(y), w: cw, h: ch } : n,
      ),
      updatedAt: new Date().toISOString(),
    });
  },

  async renameNode(flowId: string, nodeId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("节点文字不能为空");
    const flow = await this.require(flowId);
    await db.flows.update(flow.id, {
      nodes: flow.nodes.map((n) => (n.id === nodeId ? { ...n, text: trimmed } : n)),
      updatedAt: new Date().toISOString(),
    });
  },

  /** 删除节点并级联移除其所有连线 */
  async removeNode(flowId: string, nodeId: string): Promise<void> {
    const flow = await this.require(flowId);
    await db.flows.update(flow.id, {
      nodes: flow.nodes.filter((n) => n.id !== nodeId),
      edges: flow.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
      updatedAt: new Date().toISOString(),
    });
  },

  async connect(flowId: string, from: string, to: string, label = ""): Promise<void> {
    if (from === to) throw new Error("连线不能指向自身");
    const flow = await this.require(flowId);
    const has = flow.nodes.some((n) => n.id === from) && flow.nodes.some((n) => n.id === to);
    if (!has) throw new Error("连线端点节点不存在");
    if (flow.edges.some((e) => e.from === from && e.to === to)) return; // 去重
    await db.flows.update(flow.id, {
      edges: [...flow.edges, { id: uuid(), from, to, label }],
      updatedAt: new Date().toISOString(),
    });
  },

  async setEdgeLabel(flowId: string, edgeId: string, label: string): Promise<void> {
    const flow = await this.require(flowId);
    await db.flows.update(flow.id, {
      edges: flow.edges.map((e) => (e.id === edgeId ? { ...e, label: label.trim() } : e)),
      updatedAt: new Date().toISOString(),
    });
  },

  async removeEdge(flowId: string, edgeId: string): Promise<void> {
    const flow = await this.require(flowId);
    await db.flows.update(flow.id, {
      edges: flow.edges.filter((e) => e.id !== edgeId),
      updatedAt: new Date().toISOString(),
    });
  },

  async require(flowId: string): Promise<Flow> {
    const flow = await this.get(flowId);
    if (!flow) throw new Error(t("flowNotFound"));
    return flow;
  },
};

/** 节点缩放安全区间（px，画布坐标）：下限保证句柄可抓、文字可读，上限防巨型节点 */
export const FLOW_NODE_MIN = { w: 48, h: 36 };
export const FLOW_NODE_MAX = { w: 720, h: 480 };

/** 供 palette/快捷创建使用的默认尺寸（px，画布坐标）；与形状观感匹配（如菱形更宽、圆更小） */
export const FLOW_NODE_SIZE: Record<FlowNodeKind, { w: number; h: number }> = {
  start: { w: 96, h: 44 },
  end: { w: 96, h: 44 },
  process: { w: 148, h: 56 },
  rounded: { w: 148, h: 56 },
  decision: { w: 140, h: 96 },
  io: { w: 152, h: 56 },
  connector: { w: 64, h: 64 },
  offpage: { w: 108, h: 68 },
  document: { w: 144, h: 64 },
  multiDoc: { w: 140, h: 60 },
  database: { w: 116, h: 68 },
  internalStorage: { w: 132, h: 64 },
  display: { w: 144, h: 56 },
  manualInput: { w: 148, h: 56 },
  predefined: { w: 152, h: 56 },
  preparation: { w: 148, h: 62 },
  merge: { w: 132, h: 56 },
  delay: { w: 124, h: 52 },
  summing: { w: 72, h: 72 },
  annotation: { w: 132, h: 56 },
};
