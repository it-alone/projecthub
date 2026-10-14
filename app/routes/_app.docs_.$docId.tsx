import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@remix-run/react";
import { liveQuery } from "dexie";
import { db } from "~/repositories/db";
import { MarkdownEditor } from "~/components/markdown/MarkdownEditor";
import { useI18n, t as translate } from "~/lib/i18n";
import { Icon } from "~/components/ui/Icon";
import { markdownDocSchema, type MarkdownDoc } from "~/models/markdownDoc";

export const handle = { crumb: () => ({ label: translate("docsMenu"), to: "/docs" }) };

/** 文档编辑页：面包屑回到「文档」，编辑器铺满余下空间；文档被删时回列表 */
export default function DocEditorRoute() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [doc, setDoc] = useState<MarkdownDoc | null | undefined>(undefined); // undefined = 加载中；null = 不存在

  useEffect(() => {
    if (!docId) return;
    // liveQuery 原始行不经 Zod 默认值，展示前归一化
    const sub = liveQuery(async () => {
      const row = await db.markdownDocs.get(docId);
      return row ? markdownDocSchema.parse(row) : null;
    }).subscribe((row) => {
      setDoc((prev) => {
        // 从有到无 = 文档被删除（列表页删除后回到列表，而不是留在空白编辑页）
        if (row === null && prev) navigate("/docs", { replace: true });
        return row;
      });
    });
    return () => sub.unsubscribe();
  }, [docId, navigate]);

  if (!docId || doc === null) {
    return (
      <div className="doc-page">
        <p className="empty">{t("docNotFound")}</p>
      </div>
    );
  }
  if (doc === undefined) {
    return (
      <div className="doc-page">
        <p className="empty">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="doc-page">
      <div className="doc-page__head">
        <button
          type="button"
          className="doc-page__back"
          onClick={() => navigate("/docs")}
          aria-label={t("backToDocs")}
        >
          <Icon name="back" size={15} />
          {t("docsMenu")}
        </button>
      </div>
      <MarkdownEditor key={docId} doc={doc} />
    </div>
  );
}
