import { Extension } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { Editor, Range } from "@tiptap/react";

/**
 * 「/」斜杠菜单扩展（飞书式块插入）：
 * 基于 @tiptap/suggestion 触发，菜单 UI 由组件层渲染；
 * 键盘 ↑↓/Enter 在 render.onKeyDown 里接管，Escape 交给插件默认关闭。
 */

export interface SlashItem {
  id: string;
  /** 菜单左侧的字形徽标（H1 / • / ❞ 等文本字形，不走 svg） */
  glyph: string;
  label: string;
  /** 过滤关键词（小写匹配 label/keywords） */
  keywords: string;
  command: (args: { editor: Editor; range: Range }) => void;
}

export interface SlashMenuState {
  open: boolean;
  x: number;
  y: number;
  query: string;
  items: SlashItem[];
  activeIndex: number;
  /** 选中某项：走 suggestion 插件的 command 通道（会正确删除触发文本 "/query"） */
  select: (index: number) => void;
}

export interface SlashMenuConfig {
  /** 全量菜单项（组件层按 i18n 构造，语言切换后取最新） */
  getItems: () => SlashItem[];
  /** 菜单状态回调（open/位置/过滤结果/激活项） */
  onState: (state: SlashMenuState) => void;
}

const CLOSED: SlashMenuState = { open: false, x: 0, y: 0, query: "", items: [], activeIndex: 0, select: () => {} };

function filterItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) => it.label.toLowerCase().includes(q) || it.keywords.toLowerCase().includes(q) || it.id.includes(q),
  );
}

export function createSlashMenuExtension(config: SlashMenuConfig) {
  // 激活项与当前 suggestion props 存在扩展闭包里：键盘事件与点击共用同一选择通道
  let activeIndex = 0;
  let lastQuery = "";
  let current: { items: SlashItem[]; command: (item: SlashItem) => void; rect: DOMRect | null } | null = null;

  const publish = (open: boolean, items: SlashItem[] = []) => {
    if (!open || !current) {
      config.onState(CLOSED);
      return;
    }
    if (activeIndex >= items.length) activeIndex = items.length ? items.length - 1 : 0;
    const rect = current.rect;
    config.onState({
      open: true,
      x: rect?.left ?? 0,
      y: (rect?.bottom ?? 0) + 4,
      query: lastQuery,
      items,
      activeIndex,
      select: (index: number) => {
        const item = current?.items[index];
        if (item) current?.command(item);
      },
    });
  };

  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        Suggestion({
          editor,
          char: "/",
          // 前缀不限制：中文后直接打「/」也要能触发（默认只认空格前缀，对 CJK 不友好）
          allowedPrefixes: null,
          // 代码块内 "/" 是代码本身，不触发菜单
          allow: ({ state }) => state.selection.$from.parent.type.name !== "codeBlock",
          items: ({ query }) => filterItems(config.getItems(), query),
          command: ({ editor: ed, range, props: item }: { editor: Editor; range: Range; props: SlashItem }) => {
            item.command({ editor: ed, range });
          },
          render: () => ({
            onStart(props) {
              activeIndex = 0;
              lastQuery = props.query;
              current = { items: props.items, command: (item) => props.command(item), rect: props.clientRect?.() ?? null };
              publish(true, props.items);
            },
            onUpdate(props) {
              lastQuery = props.query;
              current = { items: props.items, command: (item) => props.command(item), rect: props.clientRect?.() ?? null };
              publish(true, props.items);
            },
            onExit() {
              current = null;
              publish(false);
            },
            onKeyDown({ event }) {
              if (!current) return false;
              if (event.key === "ArrowDown") {
                activeIndex = current.items.length ? (activeIndex + 1) % current.items.length : 0;
                publish(true, current.items);
                return true;
              }
              if (event.key === "ArrowUp") {
                activeIndex = current.items.length
                  ? (activeIndex - 1 + current.items.length) % current.items.length
                  : 0;
                publish(true, current.items);
                return true;
              }
              if (event.key === "Enter") {
                const item = current.items[activeIndex];
                if (item) current.command(item);
                return true;
              }
              return false;
            },
          }),
        }),
      ];
    },
  });
}
