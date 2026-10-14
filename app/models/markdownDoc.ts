import { z } from "zod";

/** 应用级 Markdown 文档（独立菜单模块，不挂项目），正文整存整取，与 Flow 同一文档模式 */
export const markdownDocSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  content: z.string().max(500_000).default(""), // 上限防误粘贴巨型文本拖垮 IndexedDB/liveQuery
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MarkdownDoc = z.infer<typeof markdownDocSchema>;
