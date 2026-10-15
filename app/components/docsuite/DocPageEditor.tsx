import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { EditorContent, Mark, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
 * 飞书式富文本文档编辑器：块工具栏 + "/" 斜杠菜单 + 防抖自动保存。
 * 草稿只在 tiptap 实例里，600ms 无输入才落库；卸载时兜底保存防丢最后一段输入。
 */
export function DocPageEditor({ file }: DocPageEditorProps) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(file.title);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [slash, setSlash] = useState<SlashMenuState>(CLOSED_SLASH);
  const [, setTick] = useState(0); // 事务后刷新工具栏激活态（isActive/can）

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

  const blockValue = !editor
    ? "text"
    : editor.isActive("heading", { level: 1 })
      ? "h1"
      : editor.isActive("heading", { level: 2 })
        ? "h2"
        : editor.isActive("heading", { level: 3 })
          ? "h3"
          : editor.isActive("bulletList")
            ? "bullet"
            : editor.isActive("orderedList")
              ? "ordered"
              : editor.isActive("blockquote")
                ? "quote"
                : editor.isActive("codeBlock")
                  ? "code"
                  : "text";

  function applyBlock(value: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (value) {
      case "h1": chain.toggleHeading({ level: 1 }).run(); break;
      case "h2": chain.toggleHeading({ level: 2 }).run(); break;
      case "h3": chain.toggleHeading({ level: 3 }).run(); break;
      case "bullet": chain.toggleBulletList().run(); break;
      case "ordered": chain.toggleOrderedList().run(); break;
      case "quote": chain.toggleBlockquote().run(); break;
      case "code": chain.toggleCodeBlock().run(); break;
      default: chain.setParagraph().run();
    }
  }

  type MarkBtn = { id: string; label: string; title: string; cls: string; active: boolean; run: () => void };
  const markBtns: MarkBtn[] = [
    { id: "bold", label: "B", title: t("suiteTbBold"), cls: "is-b", active: editor?.isActive("bold") ?? false, run: () => editor?.chain().focus().toggleBold().run() },
    { id: "italic", label: "I", title: t("suiteTbItalic"), cls: "is-i", active: editor?.isActive("italic") ?? false, run: () => editor?.chain().focus().toggleItalic().run() },
    { id: "underline", label: "U", title: t("suiteTbUnderline"), cls: "is-u", active: editor?.isActive("underline") ?? false, run: () => editor?.chain().focus().toggleUnderline().run() },
    { id: "strike", label: "S", title: t("suiteTbStrike"), cls: "is-s", active: editor?.isActive("strike") ?? false, run: () => editor?.chain().focus().toggleStrike().run() },
    { id: "code", label: "</>", title: t("suiteTbCode"), cls: "is-code", active: editor?.isActive("code") ?? false, run: () => editor?.chain().focus().toggleCode().run() },
    { id: "highlight", label: t("suiteTbHighlight"), title: t("suiteTbHighlight"), cls: "is-hl", active: editor?.isActive("highlight") ?? false, run: () => editor?.chain().focus().toggleMark("highlight", { class: "suite-hl" }).run() },
  ];

  return (
    <div className="doc-page">
      <div className="doc-page__head">
        <button type="button" className="doc-page__back" onClick={() => navigate("/docs")} aria-label={t("backToDocs")}>
          <Icon name="back" size={15} />
          {t("docsMenu")}
        </button>
        <input
          className="suite-doc__title"
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
          aria-label={t("suiteTitleAria")}
          maxLength={200}
          spellCheck={false}
        />
        <span className={`doc-status${saveState === "error" ? " is-error" : ""}`} data-state={saveState}>
          {statusText} · {t("suiteWordCount", { n: charCount })}
        </span>
        <button type="button" className="btn" onClick={exportMd}>
          <Icon name="download" size={14} />
          {t("suiteExportMd")}
        </button>
      </div>

      <div className="suite-toolbar" role="toolbar" aria-label={t("suiteBlockLabel")}>
        <select
          className="suite-toolbar__select"
          value={blockValue}
          onChange={(e) => applyBlock(e.target.value)}
          aria-label={t("suiteBlockLabel")}
        >
          <option value="text">{t("suiteBlockText")}</option>
          <option value="h1">{t("suiteBlockHeading1")}</option>
          <option value="h2">{t("suiteBlockHeading2")}</option>
          <option value="h3">{t("suiteBlockHeading3")}</option>
          <option value="bullet">{t("suiteBlockBullet")}</option>
          <option value="ordered">{t("suiteBlockOrdered")}</option>
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
            disabled={!editor}
          >
            {b.label}
          </button>
        ))}
        <span className="suite-toolbar__divider" aria-hidden />
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
        <span className="suite-toolbar__spacer" />
        <span className="hint hint--flush">{t("suiteSlashHint")}</span>
      </div>

      <div className="suite-doc__scroll">
        <div className="suite-doc__paper">
          {editor && <EditorContent editor={editor} className="suite-doc__prose" />}
          {isEmpty && <p className="suite-doc__placeholder">{t("suiteDocEmptyHint")}</p>}
        </div>
      </div>

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
