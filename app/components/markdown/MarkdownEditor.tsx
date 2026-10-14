import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "~/lib/i18n";
import { renderMarkdown } from "~/lib/markdown";
import { buildMarkdownGuide } from "~/lib/markdownGuide";
import { downloadTextFile } from "~/lib/download";
import { markdownDocService } from "~/services/markdownDoc.service";
import { Icon } from "~/components/ui/Icon";
import { useToast } from "~/components/ui/Toast";
import type { MarkdownDoc } from "~/models/markdownDoc";

type DocMode = "edit" | "split" | "preview";
type SaveState = "saved" | "saving" | "error";

export interface MarkdownEditorProps {
  doc: MarkdownDoc;
}

/**
 * Markdown 文档编辑器：编辑/分屏/预览三态 + 防抖自动保存 + 下载 .md。
 * 草稿只写本地 state，600ms 无输入才落库，避免高频 IndexedDB 写；
 * liveQuery 回写自己刚保存的内容时直接跳过，仅外部变更（如另开标签页）才采纳。
 */
export function MarkdownEditor({ doc }: MarkdownEditorProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(doc.name);
  const [draft, setDraft] = useState(doc.content);
  const [mode, setMode] = useState<DocMode>("split");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  // 最近一次落库内容：区分「自己的保存回写」与「外部变更」
  const lastSavedRef = useRef(doc.content);
  // 未落库草稿快照：卸载时兜底保存，防路由切换丢最后一次输入
  const pendingRef = useRef({ dirty: false, text: doc.content });

  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    pendingRef.current = { dirty: true, text: draft };
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void markdownDocService
        .saveContent(doc.id, draft)
        .then(() => {
          lastSavedRef.current = draft;
          pendingRef.current.dirty = false;
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, doc.id]);

  useEffect(() => {
    return () => {
      // 卸载兜底：把尚未过防抖间隔的草稿立即落库
      if (!pendingRef.current.dirty) return;
      void markdownDocService.saveContent(doc.id, pendingRef.current.text).catch(() => {
        // 页面已离开无法再向用户反馈，此处兜底失败只能放弃（避免未处理 Promise 拒绝）
      });
    };
  }, [doc.id]);

  useEffect(() => {
    if (doc.content !== lastSavedRef.current) {
      // 外部变更优先：单用户本地应用，覆盖本地同源草稿可接受
      lastSavedRef.current = doc.content;
      pendingRef.current = { dirty: false, text: doc.content };
      setDraft(doc.content);
      setSaveState("saved");
    }
  }, [doc.content]);

  /** 标题提交：Enter/失落焦触发；空名回退为原标题 */
  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === doc.name) {
      setName(doc.name);
      return;
    }
    void markdownDocService
      .rename(doc.id, trimmed)
      .then(() => toast.success(t("saved")))
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : t("updateFailed"));
        setName(doc.name);
      });
  }

  function download() {
    downloadTextFile(`${name.trim() || doc.name}.md`, draft);
    toast.success(t("downloadDocDone"));
  }

  const html = useMemo(() => renderMarkdown(draft), [draft]);
  const statusText =
    saveState === "saving"
      ? t("docSaving")
      : saveState === "error"
        ? t("docAutoSaveFailed")
        : t("docAutoSaved");

  return (
    <div className="doc-editor">
      <div className="doc-editor__bar">
        <input
          className="doc-editor__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitName();
            }
            if (e.key === "Escape") setName(doc.name);
          }}
          aria-label={t("docNameLabel")}
          maxLength={200}
          spellCheck={false}
        />
        <span className={`doc-status${saveState === "error" ? " is-error" : ""}`} data-state={saveState}>
          {statusText} · {t("docCharCount", { n: draft.length })}
        </span>
        <div className="doc-mode" role="group" aria-label={t("docModeLabel")}>
          {(["edit", "split", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`doc-mode__btn${mode === m ? " is-active" : ""}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {t(m === "edit" ? "docModeEdit" : m === "split" ? "docModeSplit" : "docModePreview")}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={download}>
          <Icon name="download" size={14} />
          {t("downloadDoc")}
        </button>
      </div>
      <div className={`doc-editor__body doc-editor__body--${mode}`}>
        {mode !== "preview" && (
          <textarea
            className="doc-editor__textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t("docModeEdit")}
            placeholder={t("docPlaceholder")}
            spellCheck={false}
          />
        )}
        {mode !== "edit" &&
          (draft.trim() ? (
            <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="doc-editor__blank">
              <Icon name="markdown" size={28} />
              <p>{t("docEmptyPreview")}</p>
              <button type="button" className="btn" onClick={() => setDraft(buildMarkdownGuide(locale))}>
                <Icon name="plus" size={14} />
                {t("docInsertGuide")}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
