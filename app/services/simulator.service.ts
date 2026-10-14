import { db } from "~/repositories/db";
import { uuid } from "~/lib/id";
import { t } from "~/lib/i18n";
import {
  SIM_FIELDS,
  SIM_HAS_PHOTO,
  SIM_SAMPLE,
  isSimDocType,
  simDocSchema,
  type SimDoc,
  type SimDocType,
} from "~/models/simDoc";

/** 人像 dataURL 上限（约 2MB，超过说明前端压缩失效，拒绝入库防撑爆 IndexedDB） */
const MAX_PHOTO_CHARS = 2_000_000;

/**
 * 证件模拟器服务：应用级本地工具（同流程图模块，不挂项目权限）。
 * 每种证面一档数据，save/reset 均按 type upsert；字段先经配置裁剪再落库，
 * 避免表单外的键（如超大 base64）混进文档行。
 */
export const simService = {
  /** 全部已保存的证面文档，按更新时间倒序 */
  async list(): Promise<SimDoc[]> {
    const rows = await db.simDocs.toArray();
    return rows
      .map((r) => simDocSchema.parse(r))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  /** 某证面的已存档数据；未编辑过返回 null（界面回退到内置样本） */
  async getByType(type: SimDocType): Promise<SimDoc | null> {
    const row = await db.simDocs.where("type").equals(type).first();
    return row ? simDocSchema.parse(row) : null;
  },

  /** 保存证面信息（upsert）：只保留字段配置内的键，trim + 长度封顶 */
  async save(type: SimDocType, data: Record<string, string>): Promise<SimDoc> {
    if (!isSimDocType(type)) throw new Error(t("simNotFound"));
    const clean: Record<string, string> = {};
    for (const def of SIM_FIELDS[type]) {
      clean[def.key] = (data[def.key] ?? "").trim().slice(0, def.max ?? 100);
    }
    const photo = (data.photo ?? "").trim();
    if (SIM_HAS_PHOTO[type] && photo) {
      if (photo.length > MAX_PHOTO_CHARS) throw new Error(t("simPhotoTooLarge"));
      clean.photo = photo;
    }
    return this.put(type, clean);
  },

  /** 恢复内置虚构样本（保留文档 id 与创建时间，仅重置内容） */
  async reset(type: SimDocType): Promise<SimDoc> {
    if (!isSimDocType(type)) throw new Error(t("simNotFound"));
    return this.put(type, { ...SIM_SAMPLE[type] });
  },

  async put(type: SimDocType, data: Record<string, string>): Promise<SimDoc> {
    const existing = await this.getByType(type);
    const now = new Date().toISOString();
    const doc: SimDoc = simDocSchema.parse({
      id: existing?.id ?? uuid(),
      type,
      data,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await db.simDocs.put(doc);
    return doc;
  },
};
