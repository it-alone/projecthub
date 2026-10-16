import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem } from "@tiptap/extension-list/task-item";
import { TaskList } from "@tiptap/extension-list/task-list";
import { TableKit } from "@tiptap/extension-table";
import { BackgroundColor, Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/react";
import { docFileService } from "~/services/docFile.service";
import { docJsonToMarkdown } from "~/lib/docMarkdown";
import { downloadTextFile } from "~/lib/download";
import { useI18n } from "~/lib/i18n";
import { Icon } from "~/components/ui/Icon";
import { useToast } from "~/components/ui/Toast";
import { SlashMenu } from "~/components/docsuite/SlashMenu";
import { ColorPalette } from "~/components/docsuite/ColorPalette";
import { createSlashMenuExtension, type SlashItem, type SlashMenuState } from "~/components/docsuite/slashExtension";
import type { DocFile } from "~/models/docSuite";

type SaveState = "saved" | "saving" | "error";
type Anchor2D = { x: number; y: number };
/** 取色浮层模式：text 文字色 / fill 背景色 / highlight 高亮笔 */
type PaletteMode = "text" | "fill" | "highlight";
interface OutlineItem {
  level: number;
  text: string;
  pos: number;
}

const CLOSED_SLASH: SlashMenuState = { open: false, x: 0, y: 0, query: "", items: [], activeIndex: 0, select: () => {} };

/** 字号候选（px；空 = 默认字号） */
const FONT_SIZES = ["", "12px", "14px", "16px", "18px", "24px", "32px", "48px"] as const;

/** 对齐按钮文案键（固定工具栏与划选浮动栏共用） */
function alignKey(a: "left" | "center" | "right") {
  return a === "left" ? "suiteAlignLeft" : a === "center" ? "suiteAlignCenter" : "suiteAlignRight";
}

export interface DocPageEditorProps {
  file: DocFile;
}

/**
 * 飞书式富文本文档编辑器：顶部轻量栏（标题 + 保存状态 + 导出）+
 * 固定格式工具栏（内容上方常驻：块样式/内联样式/列表/对齐/插入）+
 * 划选浮动格式工具栏 + 块悬浮把手（上移/下移/复制/删除）+ "/" 斜杠菜单。
 * 文件名在顶栏（内容块上方），正文首行默认为内容标题 H1 并跟随改名；
 * 草稿只在 tiptap 实例里，600ms 无输入才落库，卸载时兜底保存防丢最后一段输入。
 */
export function DocPageEditor({ file }: DocPageEditorProps) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(file.title);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [slash, setSlash] = useState<SlashMenuState>(CLOSED_SLASH);
  const [, setTick] = useState(0); // 事务后刷新工具栏激活态（isActive/can）
  const [floatBar, setFloatBar] = useState<Anchor2D | null>(null);
  const [blockHandle, setBlockHandle] = useState<(Anchor2D & { start: number }) | null>(null);
  const [blockMenu, setBlockMenu] = useState<(Anchor2D & { start: number }) | null>(null);
  const [palette, setPalette] = useState<{ mode: PaletteMode; x: number; y: number } | null>(null);
  const [tableBar, setTableBar] = useState<Anchor2D | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  // 链接编辑浮层：initial 是已有 href（光标在链接内时），apply 时回写
  const [linkEdit, setLinkEdit] = useState<(Anchor2D & { initial: string }) | null>(null);
  const [linkDraft, setLinkDraft] = useState("");

  const initialContent = (file.content ?? { type: "doc", content: [] }) as JSONContent;
  const itemsRef = useRef<SlashItem[]>([]);
  itemsRef.current = buildSlashItems(t);

  const pendingRef = useRef({ dirty: false, json: initialContent, text: "" });
  const timerRef = useRef<number | null>(null);

  const editor = useEditor({
    // Remix SSR：延后渲染编辑器实例，避免 hydration 不一致
    immediatelyRender: false,
    extensions: [
      StarterKit,
      // 高亮笔多色：色值来自 ~/lib/palette 高亮色板，attrs.color 随文档持久化
      Highlight.configure({ multicolor: true }),
      // 链接：编辑器内不直接点开（避免误触跳走），Ctrl/⌘+K 或浮动栏编辑
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      // 段落/标题对齐（正文排版三态）
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // 飞书式待办清单：勾选框可点，nested 允许清单嵌套
      TaskList,
      TaskItem.configure({ nested: true }),
      // 文档内表格块（列宽不开放拖拽，保持简单）
      TableKit.configure({ table: { resizable: false } }),
      // 文字/背景色/字号（span 内联样式，色值来自 ~/lib/palette 数据色板）
      TextStyle,
      Color,
      BackgroundColor,
      FontSize,
      createSlashMenuExtension({ getItems: () => itemsRef.current, onState: setSlash }),
    ],
    content: initialContent,
    autofocus: false,
    editorProps: {
      handleKeyDown: (view, event) => {
        // Ctrl/⌘+K 唤起链接编辑（业界惯例快捷键）
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          const { from } = view.state.selection;
          try {
            const coords = view.coordsAtPos(from);
            openLinkEditorAt((coords.left + coords.right) / 2, coords.top - 44);
          } catch {
            openLinkEditorAt(window.innerWidth / 2, 120);
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => scheduleSave(ed),
    onTransaction: () => setTick((n) => n + 1),
  });

  function scheduleSave(ed: NonNullable<typeof editor>) {
    const json = ed.getJSON();
    const text = ed.getText();
    pendingRef.current = { dirty: true, json, text };
    setSaveState("saving");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void docFileService
        .saveDoc(file.id, json, text.slice(0, 200))
        .then(() => {
          pendingRef.current.dirty = false;
          setSaveState("saved");
        })
        .catch((e: unknown) => {
          setSaveState("error");
          toast.error(e instanceof Error ? e.message : t("updateFailed"));
        });
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      // 卸载兜底：把尚未过防抖间隔的草稿立即落库
      if (!pendingRef.current.dirty) return;
      void docFileService.saveDoc(file.id, pendingRef.current.json, pendingRef.current.text.slice(0, 200)).catch(() => {
        // 页面已离开无法再向用户反馈，此处兜底失败只能放弃（避免未处理 Promise 拒绝）
      });
    };
  }, [file.id]);

  /* ----- 划选浮动工具栏 + 表格工具条：选区/事务/滚动时测量，失焦隐藏 ----- */
  useEffect(() => {
    if (!editor) return;
    const measure = (): void => {
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      if (empty || !editor.isFocused || editor.isActive("codeBlock")) {
        setFloatBar(null);
      } else {
        try {
          const a = view.coordsAtPos(from);
          const b = view.coordsAtPos(to);
          const x = (a.left + b.left) / 2;
          const y = Math.min(a.top, b.top) - 46;
          const xClamped = Math.max(140, Math.min(x, window.innerWidth - 140));
          setFloatBar((prev) =>
            prev && Math.abs(prev.x - xClamped) < 1 && Math.abs(prev.y - y) < 1 ? prev : { x: xClamped, y: Math.max(60, y) },
          );
        } catch {
          setFloatBar(null); // 坐标测量失败（节点刚卸载等）宁可隐藏也不闪错位置
        }
      }
      // 光标落在表格内 → 表格工具条贴表格顶缘居中
      if (!editor.isActive("table")) {
        setTableBar(null);
        return;
      }
      try {
        const $from = state.selection.$from;
        let depth = $from.depth;
        while (depth > 0 && $from.node(depth).type.name !== "table") depth--;
        if (depth < 1) {
          setTableBar(null);
          return;
        }
        const dom = view.nodeDOM($from.before(depth));
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          const next = { x: rect.left + rect.width / 2, y: Math.max(52, rect.top - 42) };
          setTableBar((prev) =>
            prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 ? prev : next,
          );
        }
      } catch {
        setTableBar(null);
      }
    };
    editor.on("selectionUpdate", measure);
    editor.on("transaction", measure);
    editor.on("blur", () => {
      setFloatBar(null);
      setTableBar(null);
    });
    window.addEventListener("scroll", measure, true);
    return () => {
      editor.off("selectionUpdate", measure);
      editor.off("transaction", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [editor]);

  /* ----- 大纲：顶层标题收集（点击跳转定位），事务时增量刷新 ----- */
  useEffect(() => {
    if (!editor) return;
    const collect = (): void => {
      const items: OutlineItem[] = [];
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading") {
          items.push({ level: Number(node.attrs.level ?? 1), text: node.textContent.trim(), pos: offset });
        }
      });
      setOutline((prev) => {
        if (prev.length !== items.length) return items;
        for (let i = 0; i < items.length; i++) {
          if (prev[i]!.pos !== items[i]!.pos || prev[i]!.text !== items[i]!.text || prev[i]!.level !== items[i]!.level) {
            return items;
          }
        }
        return prev; // 内容没变不重设引用，避免无谓渲染
      });
    };
    editor.on("transaction", collect);
    collect();
    return () => {
      editor.off("transaction", collect);
    };
  }, [editor]);

  /* ----- 块把手菜单：点击外部 / Esc / 滚动关闭（菜单自身 mousedown 已阻止冒泡） ----- */
  useEffect(() => {
    if (!blockMenu) return;
    const close = () => setBlockMenu(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setBlockMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [blockMenu]);

  /** 悬停定位当前块：解析到顶层块边界，把手落在块左侧留白槽（飞书式 gutter） */
  function onPaperMouseMove(e: React.MouseEvent) {
    if (!editor || blockMenu) return;
    // 指针在正文以外（把手/内边距/标题）：保持现状，否则悬停把手本身会把把手清掉
    const prose = editor.view.dom;
    if (!(e.target instanceof Node) || !prose.contains(e.target)) return;
    const posInfo = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!posInfo) return;
    const $p = editor.state.doc.resolve(posInfo.inside >= 0 ? posInfo.inside : posInfo.pos);
    if ($p.depth < 1) return; // 块间隙：保持现状（移出画布才隐藏，避免斜向移动时把手闪烁）
    const start = $p.before(1);
    const dom = editor.view.nodeDOM(start);
    if (!(dom instanceof HTMLElement)) {
      setBlockHandle(null);
      return;
    }
    const rect = dom.getBoundingClientRect();
    const next = { x: rect.left - 30, y: rect.top + Math.max(0, (rect.height - 22) / 2), start };
    setBlockHandle((prev) =>
      prev && prev.start === next.start && Math.abs(prev.x - next.x) < 2 && Math.abs(prev.y - next.y) < 2 ? prev : next,
    );
  }

  /* ----- 块级操作：start 为目标块前位置；统一走事务派发以进入撤销历史 ----- */
  function moveBlock(start: number, dir: -1 | 1) {
    if (!editor) return;
    const doc = editor.state.doc;
    const node = doc.resolve(start).nodeAfter;
    if (!node) return;
    let insertPos: number;
    if (dir === -1) {
      const prev = doc.resolve(start).nodeBefore;
      if (!prev) return;
      insertPos = start - prev.nodeSize;
    } else {
      const next = doc.resolve(start + node.nodeSize).nodeAfter;
      if (!next) return;
      insertPos = start + next.nodeSize;
    }
    const tr = editor.state.tr;
    tr.delete(start, start + node.nodeSize);
    tr.insert(insertPos, node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    editor.view.dispatch(tr);
    setBlockMenu(null);
  }

  function duplicateBlock(start: number) {
    if (!editor) return;
    const node = editor.state.doc.resolve(start).nodeAfter;
    if (!node) return;
    const at = start + node.nodeSize;
    const copy = node.type.create(node.attrs, node.content, node.marks);
    const tr = editor.state.tr;
    tr.insert(at, copy);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
    editor.view.dispatch(tr);
    setBlockMenu(null);
  }

  function deleteBlock(start: number) {
    if (!editor) return;
    const node = editor.state.doc.resolve(start).nodeAfter;
    if (!node) return;
    const tr = editor.state.tr;
    tr.delete(start, start + node.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start, tr.doc.content.size))));
    editor.view.dispatch(tr);
    setBlockMenu(null);
  }

  /** 表格工具条动作（tiptap 原生命令，自动进撤销历史） */
  function runTableCmd(cmd: "addRowAfter" | "addColumnAfter" | "deleteRow" | "deleteColumn" | "deleteTable") {
    editor?.chain().focus()[cmd]().run();
  }

  /** 块样式下拉当前值：按光标所在块推导（列表类走独立按钮，不进下拉） */
  function currentBlockType(): string {
    if (editor?.isActive("heading", { level: 1 })) return "h1";
    if (editor?.isActive("heading", { level: 2 })) return "h2";
    if (editor?.isActive("heading", { level: 3 })) return "h3";
    if (editor?.isActive("blockquote")) return "quote";
    if (editor?.isActive("codeBlock")) return "code";
    return "text";
  }

  /** 块样式切换：标题/引用/代码块互斥切换，其余回落正文 */
  function applyBlockType(v: string) {
    const chain = editor?.chain().focus();
    if (!chain) return;
    if (v === "h1") chain.toggleHeading({ level: 1 }).run();
    else if (v === "h2") chain.toggleHeading({ level: 2 }).run();
    else if (v === "h3") chain.toggleHeading({ level: 3 }).run();
    else if (v === "quote") chain.toggleBlockquote().run();
    else if (v === "code") chain.toggleCodeBlock().run();
    else chain.setParagraph().run();
  }

  /** 列表缩进：普通列表用 listItem、待办用 taskItem（两者是不同节点类型） */
  function runIndent(dir: 1 | -1) {
    if (!editor) return;
    const itemType = editor.isActive("taskList") ? "taskItem" : "listItem";
    if (dir === 1) editor.chain().focus().sinkListItem(itemType).run();
    else editor.chain().focus().liftListItem(itemType).run();
  }

  /** 对齐切换：再次点击当前对齐 = 恢复默认（unset），与文字处理的开关观感一致 */
  function toggleAlign(a: "left" | "center" | "right") {
    if (editor?.isActive({ textAlign: a })) editor.chain().focus().unsetTextAlign().run();
    else editor?.chain().focus().setTextAlign(a).run();
  }

  /** 字号应用：空值 = 恢复默认字号 */
  function applyFontSize(v: string) {
    if (v) editor?.chain().focus().setFontSize(v).run();
    else editor?.chain().focus().unsetFontSize().run();
  }

  /** 清除格式：块归一为正文 + 去掉全部内联样式（tiptap 标准组合） */
  function clearFormatting() {
    editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }

  /** 取色浮层回调：选中色板条目写入对应 mark；null = 清除颜色 */
  function pickColor(entry: { value: string } | null) {
    const mode = palette?.mode;
    setPalette(null);
    const chain = editor?.chain().focus();
    if (!chain || !mode) return;
    if (mode === "text") {
      if (entry) chain.setColor(entry.value).run();
      else chain.unsetColor().run();
    } else if (mode === "highlight") {
      if (entry) chain.setHighlight({ color: entry.value }).run();
      else chain.unsetHighlight().run();
    } else {
      if (entry) chain.setBackgroundColor(entry.value).run();
      else chain.unsetBackgroundColor().run();
    }
  }

  /** 打开链接编辑浮层：带出光标所在链接的 href（无则空） */
  function openLinkEditorAt(x: number, y: number) {
    const current = (editor?.getAttributes("link").href as string | undefined) ?? "";
    setLinkDraft(current);
    setLinkEdit({ x: Math.max(140, Math.min(x, window.innerWidth - 140)), y: Math.max(60, y), initial: current });
  }

  /** 应用链接：无协议的裸域名补 https://；空输入按移除处理 */
  function applyLink() {
    const raw = linkDraft.trim();
    const href = !raw ? "" : /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const chain = editor?.chain().focus().extendMarkRange("link");
    if (!chain) return;
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    setLinkEdit(null);
  }

  /** 移除链接（保留文字） */
  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkEdit(null);
  }

  /* ----- 链接浮层：点击外部 / Esc / 滚动关闭（自身 mousedown 已阻止冒泡） ----- */
  useEffect(() => {
    if (!linkEdit) return;
    const close = () => setLinkEdit(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setLinkEdit(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [linkEdit]);

  /** 大纲跳转：光标落到标题块内并滚动进视区 */
  function jumpToHeading(pos: number) {
    editor?.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  }

  /** 标题提交：Enter/失焦触发；空名回退原标题 */
  function commitTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === file.title) {
      setTitle(file.title);
      return;
    }
    void docFileService
      .rename(file.id, trimmed)
      .then(() => {
        syncFirstHeading(trimmed, file.title);
        toast.success(t("saved"));
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : t("updateFailed"));
        setTitle(file.title);
      });
  }

  /** 改名后默认把正文首行 H1 同步为新标题：首行为空或仍是旧标题时才跟随，用户自拟后不再改写 */
  function syncFirstHeading(newTitle: string, oldTitle: string) {
    if (!editor) return;
    const first = editor.state.doc.firstChild;
    if (!first || first.type.name !== "heading" || Number(first.attrs.level ?? 0) !== 1) return;
    const text = first.textContent;
    if (text === newTitle || (text && text !== oldTitle)) return;
    // insertText 走纯文本替换（insertContent 会把字符串当 HTML 解析，标题含 < > 时会被吞掉）
    editor.view.dispatch(editor.state.tr.insertText(newTitle, 1, 1 + first.content.size));
  }

  function exportMd() {
    if (!editor) return;
    downloadTextFile(`${title.trim() || file.title}.md`, docJsonToMarkdown(editor.getJSON()));
    toast.success(t("suiteExportDone"));
  }

  const statusText =
    saveState === "saving" ? t("suiteSaveSaving") : saveState === "error" ? t("suiteSaveFailed") : t("suiteSaveSaved");
  const charCount = editor?.getText().length ?? 0;
  // 文件名在顶栏，空态只看正文（新建文档首行自带 H1 标题，通常不触发）
  const isEmpty = editor?.isEmpty ?? false;

  type MarkBtn = { id: string; label: string; title: string; cls: string; active: boolean; run: () => void };
  const markBtns: MarkBtn[] = [
    { id: "bold", label: "B", title: t("suiteTbBold"), cls: "is-b", active: editor?.isActive("bold") ?? false, run: () => editor?.chain().focus().toggleBold().run() },
    { id: "italic", label: "I", title: t("suiteTbItalic"), cls: "is-i", active: editor?.isActive("italic") ?? false, run: () => editor?.chain().focus().toggleItalic().run() },
    { id: "underline", label: "U", title: t("suiteTbUnderline"), cls: "is-u", active: editor?.isActive("underline") ?? false, run: () => editor?.chain().focus().toggleUnderline().run() },
    { id: "strike", label: "S", title: t("suiteTbStrike"), cls: "is-s", active: editor?.isActive("strike") ?? false, run: () => editor?.chain().focus().toggleStrike().run() },
    { id: "code", label: "</>", title: t("suiteTbCode"), cls: "is-code", active: editor?.isActive("code") ?? false, run: () => editor?.chain().focus().toggleCode().run() },
  ];

  /** 列表三态按钮（固定工具栏）：图标 + 激活态（bullet/ordered/task） */
  const listBtns = [
    {
      id: "bullet",
      icon: "list",
      labelKey: "suiteBlockBullet",
      active: editor?.isActive("bulletList") ?? false,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered",
      icon: "listOrdered",
      labelKey: "suiteBlockOrdered",
      active: editor?.isActive("orderedList") ?? false,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "task",
      icon: "listTodo",
      labelKey: "suiteBlockTask",
      active: editor?.isActive("taskList") ?? false,
      run: () => editor?.chain().focus().toggleTaskList().run(),
    },
  ] as const;

  // 缩进可用性：普通列表与待办列表是不同节点类型，两种都探测
  const canIndent = !!editor && (editor.can().sinkListItem("listItem") || editor.can().sinkListItem("taskItem"));
  const canOutdent = !!editor && (editor.can().liftListItem("listItem") || editor.can().liftListItem("taskItem"));

  const blockMenuItems: readonly { key: string; label: string; run: () => void }[] = [
    { key: "up", label: t("suiteBlockUp"), run: () => blockMenu && moveBlock(blockMenu.start, -1) },
    { key: "down", label: t("suiteBlockDown"), run: () => blockMenu && moveBlock(blockMenu.start, 1) },
    { key: "duplicate", label: t("suiteBlockDuplicate"), run: () => blockMenu && duplicateBlock(blockMenu.start) },
    { key: "delete", label: t("suiteBlockDelete"), run: () => blockMenu && deleteBlock(blockMenu.start) },
  ];

  return (
    <div className="doc-page">
      <div className="doc-page__head">
        <button type="button" className="doc-page__back" onClick={() => navigate("/docs")} aria-label={t("backToDocs")}>
          <Icon name="back" size={15} />
          {t("docsMenu")}
        </button>
        {/* 文件名在内容块上方（与表格编辑器同款顶栏标题位）；正文首行另有 H1 内容标题 */}
        <input
          className="suite-doc__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
              // 回车落到正文首行（内容标题）开始写作
              editor?.commands.focus("start");
            }
            if (e.key === "Escape") setTitle(file.title);
          }}
          placeholder={t("suiteTitlePlaceholder")}
          aria-label={t("suiteTitleAria")}
          maxLength={200}
          spellCheck={false}
        />
        <span className={`doc-status${saveState === "error" ? " is-error" : ""}`} data-state={saveState}>
          {statusText} · {t("suiteWordCount", { n: charCount })}
        </span>
        <div className="doc-page__actions">
          <button type="button" className="btn" onClick={exportMd}>
            <Icon name="download" size={14} />
            {t("suiteExportMd")}
          </button>
        </div>
      </div>

      {/* 固定格式工具栏：常驻内容上方（在滚动容器外，滚动不消失）。
          mousedown 阻止默认保住编辑器选区，下拉控件单独放行原生交互 */}
      <div
        className="doc-toolbar"
        role="toolbar"
        aria-label={t("suiteDocToolbar")}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbUndo")}
          aria-label={t("suiteTbUndo")}
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!editor?.can().undo()}
        >
          <Icon name="undo" size={15} />
        </button>
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbRedo")}
          aria-label={t("suiteTbRedo")}
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!editor?.can().redo()}
        >
          <Icon name="redo" size={15} />
        </button>
        <span className="suite-toolbar__divider" aria-hidden />
        <select
          className="suite-toolbar__select"
          value={currentBlockType()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyBlockType(e.target.value)}
          title={t("suiteTbBlockType")}
          aria-label={t("suiteTbBlockType")}
        >
          <option value="text">{t("suiteBlockText")}</option>
          <option value="h1">{t("suiteBlockHeading1")}</option>
          <option value="h2">{t("suiteBlockHeading2")}</option>
          <option value="h3">{t("suiteBlockHeading3")}</option>
          <option value="quote">{t("suiteBlockQuote")}</option>
          <option value="code">{t("suiteBlockCode")}</option>
        </select>
        <span className="suite-toolbar__divider" aria-hidden />
        {markBtns.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`suite-toolbar__btn ${b.cls}${b.active ? " is-active" : ""}`}
            title={b.title}
            aria-label={b.title}
            aria-pressed={b.active}
            onClick={b.run}
          >
            {b.label}
          </button>
        ))}
        <span className="suite-toolbar__divider" aria-hidden />
        <select
          className="suite-toolbar__select"
          value={(editor?.getAttributes("textStyle").fontSize as string | undefined) ?? ""}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyFontSize(e.target.value)}
          title={t("suiteFontSize")}
          aria-label={t("suiteFontSize")}
        >
          {FONT_SIZES.map((s) => (
            <option key={s || "default"} value={s}>
              {s || t("suiteFontSizeDefault")}
            </option>
          ))}
        </select>
        {(["text", "fill", "highlight"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`suite-toolbar__btn is-color${palette?.mode === mode ? " is-active" : ""}`}
            title={mode === "text" ? t("suiteColorText") : mode === "fill" ? t("suiteColorBg") : t("suiteTbHighlight")}
            aria-label={mode === "text" ? t("suiteColorText") : mode === "fill" ? t("suiteColorBg") : t("suiteTbHighlight")}
            aria-pressed={palette?.mode === mode}
            aria-haspopup="menu"
            onClick={(e) => {
              if (palette?.mode === mode) {
                setPalette(null);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setPalette({ mode, x: rect.left, y: rect.bottom + 6 });
            }}
          >
            {mode === "highlight" ? (
              <Icon name="highlighter" size={15} />
            ) : (
              <span className="doc-color-glyph" aria-hidden>
                A
                <span className="doc-color-glyph__bar" data-mode={mode} />
              </span>
            )}
          </button>
        ))}
        <span className="suite-toolbar__divider" aria-hidden />
        {listBtns.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`suite-toolbar__btn${it.active ? " is-active" : ""}`}
            title={t(it.labelKey)}
            aria-label={t(it.labelKey)}
            aria-pressed={it.active}
            onClick={it.run}
          >
            <Icon name={it.icon} size={15} />
          </button>
        ))}
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbOutdent")}
          aria-label={t("suiteTbOutdent")}
          onClick={() => runIndent(-1)}
          disabled={!canOutdent}
        >
          <Icon name="outdent" size={15} />
        </button>
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbIndent")}
          aria-label={t("suiteTbIndent")}
          onClick={() => runIndent(1)}
          disabled={!canIndent}
        >
          <Icon name="indent" size={15} />
        </button>
        <span className="suite-toolbar__divider" aria-hidden />
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`suite-toolbar__btn${editor?.isActive({ textAlign: a }) ? " is-active" : ""}`}
            title={t(alignKey(a))}
            aria-label={t(alignKey(a))}
            aria-pressed={editor?.isActive({ textAlign: a }) ?? false}
            onClick={() => toggleAlign(a)}
          >
            <span className="doc-align-glyph" data-align={a} aria-hidden />
          </button>
        ))}
        <span className="suite-toolbar__divider" aria-hidden />
        <button
          type="button"
          className={`suite-toolbar__btn${editor?.isActive("link") ? " is-active" : ""}`}
          title={t("suiteTbLink")}
          aria-label={t("suiteTbLink")}
          aria-pressed={editor?.isActive("link") ?? false}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openLinkEditorAt(rect.left + rect.width / 2, rect.bottom + 6);
          }}
        >
          <Icon name="link" size={15} />
        </button>
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteBlockTable")}
          aria-label={t("suiteBlockTable")}
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Icon name="table" size={15} />
        </button>
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteBlockDivider")}
          aria-label={t("suiteBlockDivider")}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <Icon name="divider" size={15} />
        </button>
        <span className="suite-toolbar__divider" aria-hidden />
        <button
          type="button"
          className="suite-toolbar__btn"
          title={t("suiteTbClearFormat")}
          aria-label={t("suiteTbClearFormat")}
          onClick={clearFormatting}
        >
          <Icon name="eraser" size={15} />
        </button>
      </div>

      <div className="suite-doc__scroll">
        <div className="suite-doc__layout">
        {/* 画布空白点击/悬停是纯指针增强：键盘用户直接 Tab 进入标题与正文即可，豁免静态元素交互检查 */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="suite-doc__paper"
          onMouseMove={onPaperMouseMove}
          onMouseLeave={() => {
            if (!blockMenu) setBlockHandle(null);
          }}
          onMouseDown={(e) => {
            // 点击画布空白（纸张内边距区域）→ 焦点落到正文末尾（飞书交互）
            if (e.target === e.currentTarget && editor) editor.commands.focus("end");
          }}
        >
          {/* 文件名已上移顶栏，画布从正文首行（内容标题 H1）开始 */}
          {editor && <EditorContent editor={editor} className="suite-doc__prose" />}
          {isEmpty && <p className="suite-doc__placeholder">{t("suiteDocEmptyHint")}</p>}
          {/* 块悬浮把手：挂在画布内（fixed 定位不变），指针移到把手上不会触发画布 mouseleave */}
          {blockHandle && !blockMenu && (
            <button
              type="button"
              className="doc-block-handle"
              style={{ left: `${blockHandle.x}px`, top: `${blockHandle.y}px` }}
              aria-label={t("suiteBlockMenuAria")}
              aria-haspopup="menu"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setBlockMenu(blockHandle)}
            >
              ⋮⋮
            </button>
          )}
        </div>
        {/* 大纲侧栏：标题导航（窄屏隐藏，避免挤压画布） */}
        <aside className="doc-outline" aria-label={t("suiteOutline")}>
          <p className="doc-outline__title">{t("suiteOutline")}</p>
          {outline.length === 0 ? (
            <p className="doc-outline__empty">{t("suiteOutlineEmpty")}</p>
          ) : (
            outline.map((h, i) => (
              <button
                key={`${h.pos}-${i}`}
                type="button"
                className={`doc-outline__item is-h${h.level}`}
                onClick={() => jumpToHeading(h.pos)}
                title={h.text}
              >
                {h.text || t("suiteTitlePlaceholder")}
              </button>
            ))
          )}
        </aside>
        </div>
      </div>

      {/* 划选浮动格式工具栏：mousedown 阻止默认，避免点击按钮时选区/焦点丢失 */}
      {floatBar && (
        <div
          className="doc-float-bar"
          role="toolbar"
          aria-label={t("suiteFloatBarAria")}
          style={{ left: `${floatBar.x}px`, top: `${floatBar.y}px` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {markBtns.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`suite-toolbar__btn ${b.cls}${b.active ? " is-active" : ""}`}
              title={b.title}
              aria-label={b.title}
              aria-pressed={b.active}
              onClick={b.run}
            >
              {b.label}
            </button>
          ))}
          <span className="suite-toolbar__divider" aria-hidden />
          {/* 字号：stopPropagation 放行原生下拉（父级 mousedown 阻止默认会压住 select） */}
          <select
            className="doc-float-bar__size"
            value={(editor?.getAttributes("textStyle").fontSize as string | undefined) ?? ""}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => applyFontSize(e.target.value)}
            title={t("suiteFontSize")}
            aria-label={t("suiteFontSize")}
          >
            {FONT_SIZES.map((s) => (
              <option key={s || "default"} value={s}>
                {s || t("suiteFontSizeDefault")}
              </option>
            ))}
          </select>
          <span className="suite-toolbar__divider" aria-hidden />
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={`suite-toolbar__btn${editor?.isActive({ textAlign: a }) ? " is-active" : ""}`}
              title={t(alignKey(a))}
              aria-label={t(alignKey(a))}
              aria-pressed={editor?.isActive({ textAlign: a }) ?? false}
              onClick={() => toggleAlign(a)}
            >
              <span className="doc-align-glyph" data-align={a} aria-hidden />
            </button>
          ))}
          <span className="suite-toolbar__divider" aria-hidden />
          {(["text", "fill", "highlight"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`suite-toolbar__btn is-color${palette?.mode === mode ? " is-active" : ""}`}
              title={mode === "text" ? t("suiteColorText") : mode === "fill" ? t("suiteColorBg") : t("suiteTbHighlight")}
              aria-label={mode === "text" ? t("suiteColorText") : mode === "fill" ? t("suiteColorBg") : t("suiteTbHighlight")}
              aria-pressed={palette?.mode === mode}
              aria-haspopup="menu"
              onClick={() => {
                if (palette?.mode === mode) setPalette(null);
                else setPalette({ mode, x: floatBar.x - 40, y: floatBar.y + 42 });
              }}
            >
              {mode === "highlight" ? (
                <Icon name="highlighter" size={15} />
              ) : (
                <span className="doc-color-glyph" aria-hidden>
                  A
                  <span className="doc-color-glyph__bar" data-mode={mode} />
                </span>
              )}
            </button>
          ))}
          <span className="suite-toolbar__divider" aria-hidden />
          <button
            type="button"
            className={`suite-toolbar__btn${editor?.isActive("link") ? " is-active" : ""}`}
            title={t("suiteTbLink")}
            aria-label={t("suiteTbLink")}
            aria-pressed={editor?.isActive("link") ?? false}
            onClick={() => openLinkEditorAt(floatBar.x, floatBar.y + 42)}
          >
            <Icon name="link" size={15} />
          </button>
        </div>
      )}

      {/* 链接编辑浮层：输入 URL 应用/移除（Enter 应用 / Esc 取消） */}
      {linkEdit && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 浮层是划选工具栏的延伸，键盘用户经触发按钮 Enter 打开、输入框回车应用/Esc 关闭
        <div
          className="doc-link-pop"
          style={{ left: `${linkEdit.x}px`, top: `${linkEdit.y}px` }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            className="doc-link-pop__input"
            value={linkDraft}
            autoFocus
            placeholder={t("suiteLinkPlaceholder")}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setLinkEdit(null);
            }}
            aria-label={t("suiteTbLink")}
            spellCheck={false}
          />
          <button type="button" className="doc-link-pop__btn" onClick={applyLink}>
            {t("suiteLinkApply")}
          </button>
          {linkEdit.initial && (
            <button type="button" className="doc-link-pop__btn is-danger" onClick={removeLink}>
              {t("suiteLinkRemove")}
            </button>
          )}
        </div>
      )}

      {/* 文字/背景取色浮层（划选工具栏触发） */}
      {palette && (
        <ColorPalette mode={palette.mode} x={palette.x} y={palette.y} onPick={pickColor} onClose={() => setPalette(null)} />
      )}

      {/* 表格工具条：光标在表格内时贴表格顶缘（行/列增删与整表删除） */}
      {tableBar && editor?.isActive("table") && (
        <div
          className="doc-table-bar"
          role="toolbar"
          aria-label={t("suiteTableBarAria")}
          style={{ left: `${tableBar.x}px`, top: `${tableBar.y}px` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {(
            [
              { cmd: "addRowAfter", labelKey: "suiteTbAddRow" },
              { cmd: "addColumnAfter", labelKey: "suiteTbAddCol" },
              { cmd: "deleteRow", labelKey: "suiteTbDelRow" },
              { cmd: "deleteColumn", labelKey: "suiteTbDelCol" },
              { cmd: "deleteTable", labelKey: "suiteTbDelTable" },
            ] as const
          ).map((it) => (
            <button
              key={it.cmd}
              type="button"
              className="doc-table-bar__btn"
              onClick={() => runTableCmd(it.cmd)}
            >
              {t(it.labelKey)}
            </button>
          ))}
        </div>
      )}

      {blockMenu && (
        <div
          className="doc-block-menu"
          role="menu"
          tabIndex={-1}
          style={{ left: `${blockMenu.x}px`, top: `${blockMenu.y + 26}px` }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {blockMenuItems.map((it) => (
            <button key={it.key} type="button" className="doc-block-menu__item" role="menuitem" onClick={it.run}>
              {it.label}
            </button>
          ))}
        </div>
      )}

      <SlashMenu state={slash} />
    </div>
  );
}

/** 斜杠菜单项（语言相关，走 ref 每渲染刷新以跟随语言切换） */
function buildSlashItems(t: ReturnType<typeof useI18n>["t"]): SlashItem[] {
  type TKey = Parameters<typeof t>[0];
  const items: { id: string; glyph: string; labelKey: TKey; keywords: string }[] = [
    { id: "text", glyph: "A", labelKey: "suiteBlockText", keywords: "text paragraph wen" },
    { id: "h1", glyph: "H1", labelKey: "suiteBlockHeading1", keywords: "heading title biaoti" },
    { id: "h2", glyph: "H2", labelKey: "suiteBlockHeading2", keywords: "heading title biaoti" },
    { id: "h3", glyph: "H3", labelKey: "suiteBlockHeading3", keywords: "heading title biaoti" },
    { id: "bullet", glyph: "•", labelKey: "suiteBlockBullet", keywords: "list bullet liebiao" },
    { id: "ordered", glyph: "1.", labelKey: "suiteBlockOrdered", keywords: "list ordered num liebiao" },
    { id: "task", glyph: "☑", labelKey: "suiteBlockTask", keywords: "task todo checklist daiban" },
    { id: "table", glyph: "▦", labelKey: "suiteBlockTable", keywords: "table biao" },
    { id: "quote", glyph: "❝", labelKey: "suiteBlockQuote", keywords: "quote yinyong" },
    { id: "code", glyph: "</>", labelKey: "suiteBlockCode", keywords: "code block daima" },
    { id: "divider", glyph: "—", labelKey: "suiteBlockDivider", keywords: "divider hr fengexian" },
  ];
  return items.map((it) => ({
    id: it.id,
    glyph: it.glyph,
    label: t(it.labelKey),
    keywords: it.keywords,
    command: ({ editor, range }) => {
      const chain = editor.chain().focus().deleteRange(range);
      switch (it.id) {
        case "h1": chain.toggleHeading({ level: 1 }).run(); break;
        case "h2": chain.toggleHeading({ level: 2 }).run(); break;
        case "h3": chain.toggleHeading({ level: 3 }).run(); break;
        case "bullet": chain.toggleBulletList().run(); break;
        case "ordered": chain.toggleOrderedList().run(); break;
        case "task": chain.toggleTaskList().run(); break;
        case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
        case "quote": chain.toggleBlockquote().run(); break;
        case "code": chain.toggleCodeBlock().run(); break;
        case "divider": chain.setHorizontalRule().run(); break;
        default: chain.setParagraph().run();
      }
    },
  }));
}
