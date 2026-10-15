// 数据调色板（Data Palettes）— 用户可见颜色但非主题色：
// 与 tokens.css 的语义 Token 不同，这里的色值是「业务数据」的一部分
// （按 id 稳定取色、优先级点色等），不随明暗主题切换。
// 仅允许在 lib/ 的调色板模块中出现色值字面量（docs/standards/01-ui-spec §6）。

import type { Dict } from "~/locales/zh-CN";

/** 项目卡片角块配色：按项目 id 稳定取色（靛蓝为主的 8 色） */
const TILE_COLORS = [
  "#4f46e5",
  "#0284c7",
  "#059669",
  "#d97706",
  "#e11d48",
  "#7c3aed",
  "#0d9488",
  "#db2777",
] as const;

export function tileColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length]!;
}

/* ----- 文档/表格编辑器取色板 ----- */

/** 编辑器色板条目：用户给内容上色属于「业务数据」，色值恒定不随主题翻转 */
export interface PaletteEntry {
  /** 存进数据模型的稳定标识（单元格样式 fg/bg、markdown 导出都认这个） */
  id: string;
  /** 色值字面量（取中性明度，浅深主题下均可读） */
  value: string;
  labelKey: keyof Dict;
}

/** 文字色板（中饱和前景色） */
export const TEXT_PALETTE: readonly PaletteEntry[] = [
  { id: "gray", value: "#6b7280", labelKey: "suiteColorGray" },
  { id: "red", value: "#dc2626", labelKey: "suiteColorRed" },
  { id: "amber", value: "#d97706", labelKey: "suiteColorAmber" },
  { id: "green", value: "#059669", labelKey: "suiteColorGreen" },
  { id: "blue", value: "#4f46e5", labelKey: "suiteColorBlue" },
  { id: "purple", value: "#7c3aed", labelKey: "suiteColorPurple" },
];

/** 背景色板（浅底；上层的文字由渲染层固定为恒定墨色保证可读） */
export const BG_PALETTE: readonly PaletteEntry[] = [
  { id: "soft-muted", value: "#f4f4f5", labelKey: "suiteColorSoftMuted" },
  { id: "soft-blue", value: "#e0e7ff", labelKey: "suiteColorSoftBlue" },
  { id: "soft-red", value: "#fee2e2", labelKey: "suiteColorSoftRed" },
  { id: "soft-amber", value: "#fef3c7", labelKey: "suiteColorSoftAmber" },
  { id: "soft-green", value: "#d1fae5", labelKey: "suiteColorSoftGreen" },
];

/** 高亮笔色板（荧光笔观感的中明度色，官方 Highlight 扩展多色模式直接吃色值） */
export const HIGHLIGHT_PALETTE: readonly PaletteEntry[] = [
  { id: "hl-yellow", value: "#fde047", labelKey: "suiteColorHlYellow" },
  { id: "hl-green", value: "#86efac", labelKey: "suiteColorHlGreen" },
  { id: "hl-cyan", value: "#67e8f9", labelKey: "suiteColorHlCyan" },
  { id: "hl-pink", value: "#f9a8d4", labelKey: "suiteColorHlPink" },
  { id: "hl-purple", value: "#d8b4fe", labelKey: "suiteColorHlPurple" },
];

/** 按模型里存的 id 找色板条目（未知 id 视为未设置，防手改数据） */
export function paletteById(id: string | undefined): PaletteEntry | undefined {
  if (!id) return undefined;
  return (
    TEXT_PALETTE.find((e) => e.id === id) ??
    BG_PALETTE.find((e) => e.id === id) ??
    HIGHLIGHT_PALETTE.find((e) => e.id === id)
  );
}
