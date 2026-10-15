import { db } from "~/repositories/db";
import { uuid } from "~/lib/id";
import { getLocale, t } from "~/lib/i18n";
import { buildSeedDocJson, buildSeedSheetPages } from "~/lib/docSuiteSeed";
import { docFileSchema, type DocFile, type SheetPage } from "~/models/docSuite";

/** 标题长度上限（与 schema 一致） */
export const DOC_TITLE_MAX = 200;
/** doc 正文序列化后上限：防误粘贴巨型内容拖垮 IndexedDB/liveQuery */
export const DOC_CONTENT_MAX_CHARS = 2_000_000;
/** 单个表格文件非空单元格总量上限（跨页签合计） */
const SHEET_MAX_CELLS_TOTAL = 40_000;
/** 单个表格文件页签数上限 */
const SHEET_MAX_PAGES = 20;

/** 示例内容播种标记（preferences 表）：只播种一次，用户删除后不再自动出现 */
const SEEDED_KEY = "docSuiteSeeded";

/** 播种进行中的 Promise：StrictMode 双挂载等并发调用共用一次执行 */
let seedInFlight: Promise<void> | null = null;

/**
 * 在线文档套件服务（对标飞书文档/表格）：应用级独立模块，同 flows/markdownDocs
 * 的本地文档模式，不挂项目权限；编辑高频小步落库，删除即时生效（无软删除）。
 */
export const docFileService = {
  /** 全部文件，按更新时间倒序（最近编辑优先） */
  async list(): Promise<DocFile[]> {
    const rows = await db.docFiles.toArray();
    return rows
      .map((r) => docFileSchema.parse(r))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async get(fileId: string): Promise<DocFile | null> {
    const row = await db.docFiles.get(fileId);
    return row ? docFileSchema.parse(row) : null;
  },

  async require(fileId: string): Promise<DocFile> {
    const file = await this.get(fileId);
    if (!file) throw new Error(t("docNotFound"));
    return file;
  },

  /** 新建文件：kind=doc 带空正文；kind=sheet 带一个默认页签 */
  async create(kind: "doc" | "sheet", title: string): Promise<DocFile> {
    const trimmed = title.trim().slice(0, DOC_TITLE_MAX);
    if (!trimmed) throw new Error(t("errDocNameRequired"));
    const now = new Date().toISOString();
    const file = docFileSchema.parse({
      id: uuid(),
      kind,
      title: trimmed,
      excerpt: "",
      createdAt: now,
      updatedAt: now,
      content: kind === "doc" ? { type: "doc", content: [] } : null,
      sheets:
        kind === "sheet"
          ? [{ id: uuid(), name: t("sheetDefaultPageName"), rows: 60, cols: 26, colWidths: {}, cells: {} }]
          : [],
    });
    await db.docFiles.add(file);
    return file;
  },

  async rename(fileId: string, title: string): Promise<void> {
    const trimmed = title.trim().slice(0, DOC_TITLE_MAX);
    if (!trimmed) throw new Error(t("errDocNameRequired"));
    const changed = await db.docFiles.update(fileId, { title: trimmed, updatedAt: new Date().toISOString() });
    if (changed === 0) throw new Error(t("docNotFound"));
  },

  /** 保存文档正文（tiptap JSON）与列表摘要；不存在时显式报错避免静默丢保存 */
  async saveDoc(fileId: string, content: unknown, excerpt: string): Promise<void> {
    if (JSON.stringify(content).length > DOC_CONTENT_MAX_CHARS) {
      throw new Error(t("errDocContentTooLarge"));
    }
    const changed = await db.docFiles.update(fileId, {
      content,
      excerpt: excerpt.slice(0, 200),
      updatedAt: new Date().toISOString(),
    });
    if (changed === 0) throw new Error(t("docNotFound"));
  },

  /** 保存表格文件的全部页签（整体替换，编辑器本地防抖后整存） */
  async saveSheets(fileId: string, sheets: SheetPage[]): Promise<void> {
    if (sheets.length > SHEET_MAX_PAGES) throw new Error(t("errSheetPagesLimit", { n: SHEET_MAX_PAGES }));
    let used = 0;
    for (const page of sheets) {
      used += Object.keys(page.cells).length;
      if (used > SHEET_MAX_CELLS_TOTAL) throw new Error(t("errSheetCellsLimit", { n: SHEET_MAX_CELLS_TOTAL }));
    }
    const changed = await db.docFiles.update(fileId, {
      sheets: sheets.map((p) => ({ ...p, cells: trimEmptyStyles(p.cells) })),
      updatedAt: new Date().toISOString(),
    });
    if (changed === 0) throw new Error(t("docNotFound"));
  },

  async remove(fileId: string): Promise<void> {
    await db.docFiles.delete(fileId);
  },

  /**
   * 首次进入模块播种一篇示例文档 + 一个带公式的示例表格（按当前语言）。
   * 偏好位只记一次：之后用户删除示例，也不会再自动出现（避免删不掉的骚扰）。
   */
  async seedSamplesIfNeeded(): Promise<void> {
    const flag = await db.preferences.get(SEEDED_KEY);
    if (flag) return;
    seedInFlight ??= (async () => {
      try {
        const locale = getLocale();
        const now = new Date().toISOString();
        const doc = docFileSchema.parse({
          id: uuid(),
          kind: "doc",
          title: t("suiteSeedDocTitle"),
          excerpt: "",
          createdAt: now,
          updatedAt: now,
          content: buildSeedDocJson(locale),
          sheets: [],
        });
        const sheet = docFileSchema.parse({
          id: uuid(),
          kind: "sheet",
          title: t("suiteSeedSheetTitle"),
          excerpt: "",
          createdAt: now,
          updatedAt: now,
          content: null,
          sheets: buildSeedSheetPages(locale),
        });
        await db.docFiles.bulkAdd([doc, sheet]);
        await db.preferences.put({ key: SEEDED_KEY, value: true });
      } finally {
        seedInFlight = null;
      }
    })();
    return seedInFlight;
  },
};

/** 落库前清理「空文本且无有效样式」的孤儿单元格（含只剩空样式对象的情况），控制存储体积 */
function trimEmptyStyles(cells: SheetPage["cells"]): SheetPage["cells"] {
  const out: SheetPage["cells"] = {};
  for (const [key, cell] of Object.entries(cells)) {
    if (cell.v === "" && (!cell.s || Object.keys(cell.s).length === 0)) continue;
    out[key] = cell;
  }
  return out;
}
