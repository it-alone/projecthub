/**
 * 浏览器端文本文件下载（Blob + 隐藏 <a>）。
 * 放 lib/ 供列表卡片与编辑页两处复用；延迟回收 URL 是为兼容 Safari
 * 在 click 返回后仍需从该 URL 读取下载内容的时序。
 */

/** 清洗文件名：去掉各平台文件系统非法字符，兜底防止空名 */
export function sanitizeFilename(name: string, fallback = "document"): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || fallback;
}

/** 下载一段文本为文件（默认 UTF-8 Markdown） */
export function downloadTextFile(filename: string, content: string, mime = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFilename(filename);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
