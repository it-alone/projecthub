import { z } from "zod";

/**
 * 流程图节点形状（对齐 Worktile/draw.io 流程图形状库，36 种）：
 * 基础：start/end（胶囊）、process（矩形）、rounded（圆角）、decision（菱形）、io（平行四边形）、connector（圆）、offpage（页外连接）、
 *       manualOperation（手动操作倒梯形）、or（或门圆十字）、note（虚线便签）、card（切角卡片）
 * 数据：document（文档）、multiDoc（多文档）、database（圆柱）、internalStorage（内部存储）、display（显示）、manualInput（手动输入）、
 *       tape（磁带）、directAccess（直接存取横置磁鼓）、paperTape（纸带）、storedData（数据存储开口框）、cloud（云）、folder（文件夹）
 * 流程：predefined（子流程）、preparation（预设六边形）、merge（合并梯形）、delay（延迟 D 形）、summing（汇总连接圆叉）、annotation（批注括号）、
 *       loopLimit（循环上限斜角）、collate（整理锯齿）、controlTransfer（控制传递箭头）、parallelMode（并行双竖线）、frame（分组标题框）、chevron（人字步骤条）
 */
export const flowNodeKinds = [
  "start",
  "end",
  "process",
  "rounded",
  "decision",
  "io",
  "connector",
  "offpage",
  "manualOperation",
  "or",
  "note",
  "card",
  "document",
  "multiDoc",
  "database",
  "internalStorage",
  "display",
  "manualInput",
  "tape",
  "directAccess",
  "paperTape",
  "storedData",
  "cloud",
  "folder",
  "predefined",
  "preparation",
  "merge",
  "delay",
  "summing",
  "annotation",
  "loopLimit",
  "collate",
  "controlTransfer",
  "parallelMode",
  "frame",
  "chevron",
] as const;
export type FlowNodeKind = (typeof flowNodeKinds)[number];

export const flowNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(flowNodeKinds),
  x: z.number(), // 画布坐标（px，未缩放）
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  text: z.string().max(200),
});

export const flowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(), // 起点节点 id
  to: z.string(), // 终点节点 id
  label: z.string().max(40).default(""), // 分支条件（如 是/否）
});

/** 应用级流程图文档（独立菜单模块，不挂项目），节点/连线整存整取 */
export const flowSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  nodes: z.array(flowNodeSchema).default([]),
  edges: z.array(flowEdgeSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Flow = z.infer<typeof flowSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
