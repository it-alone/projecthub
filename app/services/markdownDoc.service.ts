import { db } from "~/repositories/db";
import { uuid } from "~/lib/id";
import { getLocale, t } from "~/lib/i18n";
import { buildMarkdownGuide } from "~/lib/markdownGuide";
import { markdownDocSchema, type MarkdownDoc } from "~/models/markdownDoc";

/** Markdown 文档正文长度上限（与 schema 一致，写入前截断，避免超大粘贴拖垮本地库） */
export const MARKDOWN_DOC_MAX_CHARS = 500_000;

/** 使用指南播种标记（preferences 表）：只播种一次，用户删除后不再自动出现 */
const GUIDE_SEEDED_KEY = "markdownGuideSeeded";

/** 播种进行中的 Promise：StrictMode 双挂载等并发调用共用一次执行，防止重复建文档 */
let seedInFlight: Promise<void> | null = null;

/**
 * Markdown 文档服务：应用级独立模块（同流程图的本地文档模式，不挂项目权限）。
 * 无软删除——正文编辑是高频小步落库，删除即时生效（与 flows 一致）。
 */
export const markdownDocService = {
  /** 全部文档，按更新时间倒序（最近编辑优先） */
  async list(): Promise<MarkdownDoc[]> {
    const rows = await db.markdownDocs.toArray();
    return rows
      .map((r) => markdownDocSchema.parse(r))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async get(docId: string): Promise<MarkdownDoc | null> {
    const row = await db.markdownDocs.get(docId);
    return row ? markdownDocSchema.parse(row) : null;
  },

  async create(name: string, content = ""): Promise<MarkdownDoc> {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) throw new Error(t("errDocNameRequired"));
    const now = new Date().toISOString();
    const doc: MarkdownDoc = markdownDocSchema.parse({
      id: uuid(),
      name: trimmed,
      content: content.slice(0, MARKDOWN_DOC_MAX_CHARS),
      createdAt: now,
      updatedAt: now,
    });
    await db.markdownDocs.add(doc);
    return doc;
  },

  async rename(docId: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) throw new Error(t("errDocNameRequired"));
    // Dexie 对不存在主键的 update 静默返回 0，这里显式抛错，避免编辑器静默丢保存
    const changed = await db.markdownDocs.update(docId, { name: trimmed, updatedAt: new Date().toISOString() });
    if (changed === 0) throw new Error(t("docNotFound"));
  },

  async saveContent(docId: string, content: string): Promise<void> {
    const changed = await db.markdownDocs.update(docId, {
      content: content.slice(0, MARKDOWN_DOC_MAX_CHARS),
      updatedAt: new Date().toISOString(),
    });
    if (changed === 0) throw new Error(t("docNotFound"));
  },

  async remove(docId: string): Promise<void> {
    await db.markdownDocs.delete(docId);
  },

  /**
   * 首次进入文档模块时播种一篇《Markdown 使用指南》（按当前语言的示例正文），
   * 让新用户立刻有一份可编辑、可预览的示例。偏好位只记一次：之后用户删除该文档，
   * 也不会再自动出现（避免删不掉的骚扰）；需要时可从编辑器空态的插入按钮找回。
   */
  async seedGuideIfNeeded(): Promise<void> {
    const flag = await db.preferences.get(GUIDE_SEEDED_KEY);
    if (flag) return;
    seedInFlight ??= (async () => {
      try {
        await this.create(t("docGuideTitle"), buildMarkdownGuide(getLocale()));
        await db.preferences.put({ key: GUIDE_SEEDED_KEY, value: true });
      } finally {
        seedInFlight = null;
      }
    })();
    return seedInFlight;
  },

  async require(docId: string): Promise<MarkdownDoc> {
    const doc = await this.get(docId);
    if (!doc) throw new Error(t("docNotFound"));
    return doc;
  },
};
