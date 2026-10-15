import { useEffect } from "react";
import { useI18n } from "~/lib/i18n";
import { BG_PALETTE, HIGHLIGHT_PALETTE, TEXT_PALETTE, type PaletteEntry } from "~/lib/palette";

export interface ColorPaletteProps {
  /** text = 文字色板；fill = 背景色板；highlight = 高亮笔色板 */
  mode: "text" | "fill" | "highlight";
  /** 视口坐标（锚在触发按钮下方） */
  x: number;
  y: number;
  /** 选中条目（null = 清除颜色）后回调，是否关闭由父组件决定 */
  onPick: (entry: PaletteEntry | null) => void;
  onClose: () => void;
}

/**
 * 文档/表格共用的取色浮层：数据色板（恒定色值）+ 无颜色清除项。
 * 点击外部 / Esc 关闭；自身 mousedown 阻止冒泡以免先触发外层菜单关闭。
 */
export function ColorPalette({ mode, x, y, onPick, onClose }: ColorPaletteProps) {
  const { t } = useI18n();
  const list = mode === "text" ? TEXT_PALETTE : mode === "fill" ? BG_PALETTE : HIGHLIGHT_PALETTE;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onClose);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 180));
  const top = Math.max(8, Math.min(y, window.innerHeight - 120));

  return (
    // 色板浮层是纯指针增强的弹出菜单，键盘用户经触发按钮的 Enter 打开、Esc 关闭
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="color-palette"
      style={{ left, top }}
      role="menu"
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {list.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          className="color-palette__swatch"
          style={{ background: entry.value }}
          title={t(entry.labelKey)}
          aria-label={t(entry.labelKey)}
          onClick={() => onPick(entry)}
        />
      ))}
      <button type="button" role="menuitem" className="color-palette__none" onClick={() => onPick(null)}>
        {t("suiteColorNone")}
      </button>
    </div>
  );
}
