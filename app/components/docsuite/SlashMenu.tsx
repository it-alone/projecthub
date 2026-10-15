import { useEffect, useRef } from "react";
import { useI18n } from "~/lib/i18n";
import type { SlashItem, SlashMenuState } from "~/components/docsuite/slashExtension";

/**
 * 斜杠菜单浮层：fixed 定位贴着光标下方，键盘 ↑↓/Enter 已由扩展层接管，
 * 这里只负责展示与点击选择；渲染时把坐标钳制在视口内。
 */
export function SlashMenu({ state }: { state: SlashMenuState }) {
  const { t } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);

  // 激活项变化时滚进可视区（键盘连按时）
  useEffect(() => {
    const el = listRef.current?.children[state.activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [state.activeIndex]);

  if (!state.open) return null;
  const left = Math.max(8, Math.min(state.x, window.innerWidth - 264));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - 280));

  return (
    <div className="slash-menu" style={{ left, top }} role="dialog" aria-label={t("suiteSlashMenuLabel")}>
      {state.items.length === 0 ? (
        <p className="slash-menu__empty">{t("suiteSlashNoMatch")}</p>
      ) : (
        <ul ref={listRef} className="slash-menu__list" role="listbox" aria-label={t("suiteSlashMenuLabel")}>
          {state.items.map((item: SlashItem, i: number) => (
            <li key={item.id} role="option" aria-selected={i === state.activeIndex}>
              <button
                type="button"
                className={`slash-menu__item${i === state.activeIndex ? " is-active" : ""}`}
                onMouseDown={(e) => {
                  // mousedown 抢在编辑器失焦前选择，避免光标状态被破坏
                  e.preventDefault();
                  state.select(i);
                }}
              >
                <span className="slash-menu__glyph" aria-hidden>
                  {item.glyph}
                </span>
                <span className="slash-menu__label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
