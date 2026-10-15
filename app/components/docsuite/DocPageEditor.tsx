import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { EditorContent, Mark, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/react";
import { docFileService } from "~/services/docFile.service";
import { docJsonToMarkdown } from "~/lib/docMarkdown";
import { downloadTextFile } from "~/lib/download";
import { useI18n } from "~/lib/i18n";
import { Icon } from "~/components/ui/Icon";
import { useToast } from "~/components/ui/Toast";
import { SlashMenu } from "~/components/docsuite/SlashMenu";
import { createSlashMenuExtension, type SlashItem, type SlashMenuState } from "~/components/docsuite/slashExtension";
import type { DocFile } from "~/models/docSuite";

type SaveState = "saved" | "saving" | "error";
type Anchor2D = { x: number; y: number };

/** 高亮 mark：StarterKit 未包含，用 mark 标签承载，样式走全局 .suite-doc mark */
const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML() {
    return ["mark", { class: "suite-hl" }, 0];
  },
});

const CLOSED_SLASH: SlashMenuState = { open: false, x: 0, y: 0, query: "", items: [], activeIndex: 0, select: () => {} };

export interface DocPageEditorProps {
  file: DocFile;
}

/**
 * 飞书式富文本文档编辑器：顶部轻量栏（保存状态 + 撤销重做 + 导出）+
 * 划选浮动格式工具栏 + 块悬浮把手（上移/下移/复制/删除）+ "/" 斜杠菜单。
 * 标题在画布内、与正文同版式；草稿只在 tiptap 实例里，600ms 无输入才落库，
 * 卸载时兜底保存防丢最后一段输入。
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

  const initialContent = (file.content ?? { type: "doc", content: [] }) as JSONContent;
  const itemsRef = useRef<SlashItem[]>([]);
  itemsRef.current = buildSlashItems(t);

  const pendingRef = useRef({ dirty: false, json: initialContent, text: "" });
  const timerRef = useRef<number | null>(null);

  const editor = useEditor({
    // Remix SSR：延后渲染编辑器实例，避免 hydration 不一致
    immediatelyRender: false,
    extensions: [StarterKit, Highlight, createSlashMenuExtension({ getItems: () => itemsRef.current, onState: setSlash })],
    content: initialContent,
    autofocus: false,
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

  /* ----- 划选浮动工具栏：非空选区出现在选区上方，滚动/失焦时跟随或隐藏 ----- */
  useEffect(() => {
    if (!editor) return;
    const measure = (): void => {
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      if (empty || !editor.isFocused || editor.isActive("codeBlock")) {
        setFloatBar(null);
        return;
      }
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
    };
    editor.on("selectionUpdate", measure);
    editor.on("transaction", measure);
    editor.on("blur", () => setFloatBar(null));
    window.addEventListener("scroll", measure, true);
    return () => {
      editor.off("selectionUpdate", measure);
      editor.off("transaction", measure);
      window.removeEventListener("scroll", measure, true);
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

  /** 标题提交：Enter/失焦触发；空名回退原标题 */
  function commitTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === file.title) {
      setTitle(file.title);
      return;
    }
    void docFileService
      .rename(file.id, trimmed)
      .then(() => toast.success(t("saved")))
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : t("updateFailed"));
        setTitle(file.title);
      });
  }

  function exportMd() {
    if (!editor) return;
    downloadTextFile(`${title.trim() || file.title}.md`, docJsonToMarkdown(editor.getJSON()));
    toast.success(t("suiteExportDone"));
  }

  const statusText =
    saveState === "saving" ? t("suiteSaveSaving") : saveState === "error" ? t("suiteSaveFailed") : t("suiteSaveSaved");
  const charCount = editor?.getText().length ?? 0;
  const isEmpty = (editor?.isEmpty ?? false) && !title.trim();

  type MarkBtn = { id: string; label: string; title: string; cls: string; active: boolean; run: () => void };
  const markBtns: MarkBtn[] = [
    { id: "bold", label: "B", title: t("suiteTbBold"), cls: "is-b", active: editor?.isActive("bold") ?? false, run: () => editor?.chain().focus().toggleBold().run() },
    { id: "italic", label: "I", title: t("suiteTbItalic"), cls: "is-i", active: editor?.isActive("italic") ?? false, run: () => editor?.chain().focus().toggleItalic().run() },
    { id: "underline", label: "U", title: t("suiteTbUnderline"), cls: "is-u", active: editor?.isActive("underline") ?? false, run: () => editor?.chain().focus().toggleUnderline().run() },
    { id: "strike", label: "S", title: t("suiteTbStrike"), cls: "is-s", active: editor?.isActive("strike") ?? false, run: () => editor?.chain().focus().toggleStrike().run() },
    { id: "code", label: "</>", title: t("suiteTbCode"), cls: "is-code", active: editor?.isActive("code") ?? false, run: () => editor?.chain().focus().toggleCode().run() },
    { id: "highlight", label: t("suiteTbHighlight"), title: t("suiteTbHighlight"), cls: "is-hl", active: editor?.isActive("highlight") ?? false, run: () => editor?.chain().focus().toggleMark("highlight", { class: "suite-hl" }).run() },
  ];

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
        <span className={`doc-status${saveState === "error" ? " is-error" : ""}`} data-state={saveState}>
          {statusText} · {t("suiteWordCount", { n: charCount })}
        </span>
        <div className="doc-page__actions">
          <button
            type="button"
            className="suite-toolbar__btn"
            title={t("suiteTbUndo")}
            aria-label={t("suiteTbUndo")}
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor?.can().undo()}
          >
            <Icon name="back" size={15} />
          </button>
          <button
            type="button"
            className="suite-toolbar__btn suite-toolbar__btn--flip"
            title={t("suiteTbRedo")}
            aria-label={t("suiteTbRedo")}
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor?.can().redo()}
          >
            <Icon name="back" size={15} />
          </button>
          <button type="button" className="btn" onClick={exportMd}>
            <Icon name="download" size={14} />
            {t("suiteExportMd")}
          </button>
        </div>
      </div>

      <div className="suite-doc__scroll">
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
          <input
            className="suite-doc__title suite-doc__title--canvas"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
                editor?.commands.focus("end");
              }
              if (e.key === "Escape") setTitle(file.title);
            }}
            placeholder={t("suiteTitlePlaceholder")}
            aria-label={t("suiteTitleAria")}
            maxLength={200}
            spellCheck={false}
          />
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
        case "quote": chain.toggleBlockquote().run(); break;
        case "code": chain.toggleCodeBlock().run(); break;
        case "divider": chain.setHorizontalRule().run(); break;
        default: chain.setParagraph().run();
      }
    },
  }));
}
