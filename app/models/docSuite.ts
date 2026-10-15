import { z } from "zod";

/**
 * 在线文档套件（对标飞书「文档 + 表格」）的数据形状：
 * doc 存 tiptap 富文本 JSON；sheet 存多页签稀疏单元格（键为 A1 式引用）。
 * 与 flows / markdownDocs 同为应用级独立模块，不挂项目权限。
 */

/** 单元格样式：只存显式设置的项（缺省即默认样式），控制 IndexedDB 体积 */
export const sheetCellStyleSchema = z.object({
  b: z.literal(true).optional(), // 加粗
  i: z.literal(true).optional(), // 斜体
  u: z.literal(true).optional(), // 下划线
  s: z.literal(true).optional(), // 删除线
  a: z.enum(["left", "center", "right"]).optional(), // 水平对齐
});
export type SheetCellStyle = z.infer<typeof sheetCellStyleSchema>;

/** 单元格：v 为原始输入（以 = 开头即公式原文） */
export const sheetCellSchema = z.object({
  v: z.string().max(10_000).default(""),
  s: sheetCellStyleSchema.optional(),
});
export type SheetCell = z.infer<typeof sheetCellSchema>;

/** 工作表页签：行列数是网格显式规模（可增不可越过上限） */
export const sheetPageSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  rows: z.number().int().min(1).max(500).default(60),
  cols: z.number().int().min(1).max(40).default(26),
  /** 列宽覆盖（键为列号十进制字符串），缺省列走默认宽 */
  colWidths: z.record(z.string(), z.number().int().min(48).max(400)).default({}),
  cells: z.record(z.string(), sheetCellSchema).default({}),
});
export type SheetPage = z.infer<typeof sheetPageSchema>;

/** 文件：kind=doc 时 content 为 tiptap JSON、sheets 恒空；kind=sheet 反之（用判别字段 kind 区分） */
export const docFileSchema = z.object({
  id: z.string(),
  kind: z.enum(["doc", "sheet"]),
  title: z.string().min(1).max(200),
  /** doc 的列表摘要（正文前若干字符）；sheet 恒空串 */
  excerpt: z.string().max(200).default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  content: z.unknown().nullable().default(null),
  sheets: z.array(sheetPageSchema).default([]),
});
export type DocFile = z.infer<typeof docFileSchema>;
