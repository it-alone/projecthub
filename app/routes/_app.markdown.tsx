import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { liveQuery } from "dexie";
import { db } from "~/repositories/db";
import { markdownDocService } from "~/services/markdownDoc.service";
import { t as translate, useI18n } from "~/lib/i18n";
import { downloadTextFile } from "~/lib/download";
import { useToast } from "~/components/ui/Toast";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { markdownDocSchema, type MarkdownDoc } from "~/models/markdownDoc";

export const handle = { crumb: () => ({ label: translate("markdownMenu") }) };

/** 卡片预览摘要：取前几条非空行（原文展示，不渲染，保持卡片轻量） */
function excerptOf(doc: MarkdownDoc): string {
  return doc.content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join("\n");
}

/** Markdown 文档模块首页：全部文档（最近编辑优先），支持新建/重命名/下载/删除 */
export default function DocsRoute() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<MarkdownDoc[] | null>(null); // null = 加载中
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<MarkdownDoc | null>(null);
  const [renameText, setRenameText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MarkdownDoc | null>(null);

  useEffect(() => {
    // 首次进入模块播种《使用指南》，让新用户立刻有一份可编辑示例
    void markdownDocService.seedGuideIfNeeded().catch(() => {
      // 播种失败（如隐私模式禁写）不阻塞列表，用户仍可手动新建
    });
    // 经 schema 归一化（补默认值），按更新时间倒序：最近编辑优先
    const sub = liveQuery(async () => {
      const rows = await db.markdownDocs.toArray();
      return rows
        .map((r) => markdownDocSchema.parse(r))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }).subscribe(setDocs);
    return () => sub.unsubscribe();
  }, []);

  async function createDoc() {
    const name = newName.trim();
    if (!name) return;
    try {
      const doc = await markdownDocService.create(name);
      setNewName("");
      navigate(`/markdown/${doc.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("updateFailed"));
    }
  }

  async function saveRename() {
    if (!renaming) return;
    try {
      await markdownDocService.rename(renaming.id, renameText);
      setRenaming(null);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("updateFailed"));
    }
  }

  function downloadDoc(doc: MarkdownDoc) {
    downloadTextFile(`${doc.name}.md`, doc.content);
    toast.success(t("downloadDocDone"));
  }

  async function deleteDoc() {
    if (!pendingDelete) return;
    try {
      await markdownDocService.remove(pendingDelete.id);
      toast.success(t("deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("updateFailed"));
    }
    setPendingDelete(null);
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="page-pad">
      <div className="page-toolbar">
        <h1>{t("markdownMenu")}</h1>
        <span className="hint">{t("docsCount", { count: docs?.length ?? 0 })}</span>
        <span className="page-toolbar__spacer" />
        <form
          className="docs-create"
          onSubmit={(e) => {
            e.preventDefault();
            void createDoc();
          }}
        >
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("newDocNamePlaceholder")}
            aria-label={t("newDocNamePlaceholder")}
            maxLength={200}
          />
          <button type="submit" className="btn btn--primary" disabled={!newName.trim()}>
            <Icon name="plus" size={15} />
            {t("createDoc")}
          </button>
        </form>
      </div>

      {docs === null ? (
        <p className="empty">{t("loading")}</p>
      ) : docs.length === 0 ? (
        <div className="docs-empty">
          <Icon name="markdown" size={28} />
          <p>{t("docsEmptyHint")}</p>
        </div>
      ) : (
        <ul className="docs-grid">
          {docs.map((d) => {
            const excerpt = excerptOf(d);
            return (
              <li key={d.id} className="docs-card">
                <button
                  type="button"
                  className="docs-card__open"
                  onClick={() => navigate(`/docs/${d.id}`)}
                  aria-label={t("openDocAria", { name: d.name })}
                >
                  <span className={excerpt ? "docs-card__preview" : "docs-card__preview docs-card__preview--empty"}>
                    {excerpt ? (
                      <span className="docs-card__excerpt">{excerpt}</span>
                    ) : (
                      <Icon name="markdown" size={22} />
                    )}
                  </span>
                  <span className="docs-card__body">
                    <span className="docs-card__name" title={d.name}>{d.name}</span>
                    <span className="docs-card__meta">
                      <span className="docs-card__badge">{t("docCharCount", { n: d.content.length })}</span>
                      <span className="docs-card__time">{fmt(d.updatedAt)}</span>
                    </span>
                  </span>
                </button>
                <span className="docs-card__actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("renameDocAria", { name: d.name })}
                    title={t("renameDoc")}
                    onClick={() => {
                      setRenaming(d);
                      setRenameText(d.name);
                    }}
                  >
                    <Icon name="pencil" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("downloadDocAria", { name: d.name })}
                    title={t("downloadDoc")}
                    onClick={() => downloadDoc(d)}
                  >
                    <Icon name="download" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label={t("deleteDocAria", { name: d.name })}
                    title={t("actionDelete")}
                    onClick={() => setPendingDelete(d)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {renaming && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setRenaming(null); }}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("renameDoc")}
            onSubmit={(e) => {
              e.preventDefault();
              void saveRename();
            }}
          >
            <div className="modal__header">
              <h2>{t("renameDoc")}</h2>
              <button type="button" className="icon-btn" aria-label={t("close")} onClick={() => setRenaming(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <label className="field-label form-field">
              {t("docNameLabel")}
              <input
                className="input"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                placeholder={t("docNameLabel")}
                autoFocus
                maxLength={200}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void saveRename(); }
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            </label>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setRenaming(null)}>{t("cancel")}</button>
              <button type="submit" className="btn btn--primary" disabled={!renameText.trim()}>
                {t("save")}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("deleteDocAria", { name: pendingDelete?.name ?? "" })}
        message={t("confirmDeleteDoc", { name: pendingDelete?.name ?? "" })}
        danger
        onConfirm={() => void deleteDoc()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
