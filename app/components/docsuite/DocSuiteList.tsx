import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { liveQuery } from "dexie";
import { db } from "~/repositories/db";
import { docFileService } from "~/services/docFile.service";
import { docJsonToMarkdown } from "~/lib/docMarkdown";
import { pagesToCsv } from "~/lib/sheetGrid";
import { downloadTextFile } from "~/lib/download";
import { useI18n } from "~/lib/i18n";
import { Icon } from "~/components/ui/Icon";
import { useToast } from "~/components/ui/Toast";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { docFileSchema, type DocFile } from "~/models/docSuite";

/** 列表按修改时间分组的时间桶 */
type TimeBucket = "today" | "week" | "earlier";
type KindFilter = "all" | "doc" | "sheet";

/** 依据更新时间划分时间桶：今天 / 最近 7 天 / 更早 */
function bucketOf(iso: string, now: Date): TimeBucket {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(iso).getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - 6 * 86_400_000) return "week";
  return "earlier";
}

/**
 * 文档套件首页（我的空间）：文档与表格统一列表。
 * 交互对标飞书「新建 → 立即进入编辑器」：创建动作直接用默认标题开新文件，
 * 重命名在编辑器标题栏完成，列表只保留打开/重命名/导出/删除。
 */
export function DocSuiteList() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [files, setFiles] = useState<DocFile[] | null>(null); // null = 加载中
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [renaming, setRenaming] = useState<DocFile | null>(null);
  const [renameText, setRenameText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DocFile | null>(null);
  const [creating, setCreating] = useState<"doc" | "sheet" | null>(null);

  useEffect(() => {
    // 首次进入播种示例文档 + 公式示例表格；失败（隐私模式禁写）不阻塞列表
    void docFileService.seedSamplesIfNeeded().catch(() => {});
    const sub = liveQuery(async () => {
      const rows = await db.docFiles.toArray();
      return rows
        .map((r) => docFileSchema.parse(r))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }).subscribe(setFiles);
    return () => sub.unsubscribe();
  }, []);

  const filtered = useMemo(() => {
    if (!files) return null;
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (kindFilter !== "all" && f.kind !== kindFilter) return false;
      if (!q) return true;
      return f.title.toLowerCase().includes(q) || f.excerpt.toLowerCase().includes(q);
    });
  }, [files, query, kindFilter]);

  /** 时间分组：组内保持更新时间倒序，空组自动隐藏 */
  const groups = useMemo(() => {
    if (!filtered) return null;
    const now = new Date();
    const defs: Array<{ key: TimeBucket; label: string }> = [
      { key: "today", label: t("suiteGroupToday") },
      { key: "week", label: t("suiteGroupWeek") },
      { key: "earlier", label: t("suiteGroupEarlier") },
    ];
    return defs
      .map((d) => ({ ...d, items: filtered.filter((f) => bucketOf(f.updatedAt, now) === d.key) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, t]);

  async function create(kind: "doc" | "sheet") {
    setCreating(kind);
    try {
      const file = await docFileService.create(kind, t(kind === "doc" ? "suiteUntitledDoc" : "suiteUntitledSheet"));
      navigate(`/docs/${file.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("updateFailed"));
      setCreating(null);
    }
  }

  async function saveRename() {
    if (!renaming) return;
    try {
      await docFileService.rename(renaming.id, renameText);
      setRenaming(null);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("updateFailed"));
    }
  }

  function exportFile(file: DocFile) {
    if (file.kind === "doc") {
      downloadTextFile(`${file.title}.md`, docJsonToMarkdown(file.content ?? null));
    } else {
      downloadTextFile(`${file.title}.csv`, pagesToCsv(file.sheets), "text/csv;charset=utf-8");
    }
    toast.success(t("suiteExportDone"));
  }

  async function deleteFile() {
    if (!pendingDelete) return;
    try {
      await docFileService.remove(pendingDelete.id);
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

  const filterDefs: Array<{ value: KindFilter; label: string }> = [
    { value: "all", label: t("suiteFilterAll") },
    { value: "doc", label: t("suiteKindDoc") },
    { value: "sheet", label: t("suiteKindSheet") },
  ];
  const hasCondition = query.trim() !== "" || kindFilter !== "all";

  function renderRow(file: DocFile) {
    const filled = file.sheets.reduce((n, p) => n + Object.keys(p.cells).length, 0);
    return (
      <li key={file.id} className="suite-row">
        <button
          type="button"
          className="suite-row__open"
          onClick={() => navigate(`/docs/${file.id}`)}
          aria-label={t("suiteOpenAria", { name: file.title })}
        >
          <span className={`suite-row__icon${file.kind === "sheet" ? " suite-row__icon--sheet" : ""}`}>
            <Icon name={file.kind === "doc" ? "fileText" : "table"} size={18} />
          </span>
          <span className="suite-row__body">
            <span className="suite-row__title" title={file.title}>
              {file.title}
            </span>
            <span className="suite-row__meta">
              {file.kind === "doc"
                ? file.excerpt || t("suiteDocEmptyHint")
                : `${t("suiteSheetsBadge", { n: file.sheets.length })} · ${t("suiteCellsBadge", { n: filled })}`}
            </span>
          </span>
          <span className={`suite-row__kind${file.kind === "sheet" ? " suite-row__kind--sheet" : ""}`}>
            {t(file.kind === "doc" ? "suiteKindDoc" : "suiteKindSheet")}
          </span>
          <span className="suite-row__time">{fmt(file.updatedAt)}</span>
        </button>
        {/* 操作区固定占位、悬停/聚焦渐显，避免行内布局跳动 */}
        <span className="suite-row__actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={t("suiteRenameAria", { name: file.title })}
            title={t("suiteRenameTitle")}
            onClick={() => {
              setRenaming(file);
              setRenameText(file.title);
            }}
          >
            <Icon name="pencil" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("suiteExportAria", { name: file.title })}
            title={file.kind === "doc" ? t("suiteExportMd") : t("suiteExportCsv")}
            onClick={() => exportFile(file)}
          >
            <Icon name="download" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            aria-label={t("suiteDeleteAria", { name: file.title })}
            title={t("actionDelete")}
            onClick={() => setPendingDelete(file)}
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      </li>
    );
  }

  return (
    <div className="page-pad">
      <div className="page-toolbar">
        <h1>{t("docsMenu")}</h1>
        <span className="hint">{t("suiteFileCount", { count: files?.length ?? 0 })}</span>
        <span className="page-toolbar__spacer" />
        <div className="segmented suite-filter" role="group" aria-label={t("suiteFilterLabel")}>
          {filterDefs.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`segmented__item${kindFilter === f.value ? " segmented__item--active" : ""}`}
              aria-pressed={kindFilter === f.value}
              onClick={() => setKindFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="suite-search">
          <Icon name="search" size={14} />
          <input
            className="suite-search__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("suiteSearchPlaceholder")}
            aria-label={t("suiteSearchLabel")}
            maxLength={120}
          />
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={creating !== null}
          onClick={() => void create("doc")}
        >
          <Icon name="plus" size={15} />
          {t("suiteNewDoc")}
        </button>
        <button type="button" className="btn" disabled={creating !== null} onClick={() => void create("sheet")}>
          <Icon name="table" size={15} />
          {t("suiteNewSheet")}
        </button>
      </div>

      {filtered === null ? (
        <p className="empty">{t("loading")}</p>
      ) : filtered.length === 0 && files !== null && files.length === 0 ? (
        <div className="suite-empty">
          <span className="suite-empty__icon">
            <Icon name="fileText" size={22} />
          </span>
          <p className="suite-empty__title">{t("suiteEmptyTitle")}</p>
          <p className="suite-empty__hint">{t("suiteEmptyHint")}</p>
          <div className="suite-empty__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={creating !== null}
              onClick={() => void create("doc")}
            >
              <Icon name="plus" size={15} />
              {t("suiteNewDoc")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={creating !== null}
              onClick={() => void create("sheet")}
            >
              <Icon name="table" size={15} />
              {t("suiteNewSheet")}
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="suite-empty">
          <span className="suite-empty__icon">
            <Icon name="search" size={22} />
          </span>
          <p className="suite-empty__title">{t("suiteNoMatchTitle")}</p>
          {hasCondition && <p className="suite-empty__hint">{t("suiteNoMatchHint")}</p>}
        </div>
      ) : (
        groups?.map((g) => (
          <section key={g.key} className="suite-group" aria-label={g.label}>
            <h2 className="suite-group__label">
              {g.label}
              <span className="suite-group__count">{g.items.length}</span>
            </h2>
            <ul className="suite-list">{g.items.map(renderRow)}</ul>
          </section>
        ))
      )}

      {renaming && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenaming(null);
          }}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("suiteRenameTitle")}
            onSubmit={(e) => {
              e.preventDefault();
              void saveRename();
            }}
          >
            <div className="modal__header">
              <h2>{t("suiteRenameTitle")}</h2>
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
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveRename();
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            </label>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setRenaming(null)}>
                {t("cancel")}
              </button>
              <button type="submit" className="btn btn--primary" disabled={!renameText.trim()}>
                {t("save")}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("suiteDeleteAria", { name: pendingDelete?.title ?? "" })}
        message={t("suiteConfirmDelete", { name: pendingDelete?.title ?? "" })}
        danger
        onConfirm={() => void deleteFile()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
