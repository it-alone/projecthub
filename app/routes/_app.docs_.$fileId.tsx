import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@remix-run/react";
import { liveQuery } from "dexie";
import { db } from "~/repositories/db";
import { DocPageEditor } from "~/components/docsuite/DocPageEditor";
import { SheetEditor } from "~/components/docsuite/SheetEditor";
import { useI18n, t as translate } from "~/lib/i18n";
import { docFileSchema, type DocFile } from "~/models/docSuite";

export const handle = { crumb: () => ({ label: translate("docsMenu"), to: "/docs" }) };

/** 文件编辑页：按 kind 分发到富文本编辑器或表格编辑器；文件被删时回列表 */
export default function DocFileRoute() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [file, setFile] = useState<DocFile | null | undefined>(undefined); // undefined = 加载中

  useEffect(() => {
    if (!fileId) return;
    // liveQuery 原始行不经 Zod 默认值，展示前归一化
    const sub = liveQuery(async () => {
      const row = await db.docFiles.get(fileId);
      return row ? docFileSchema.parse(row) : null;
    }).subscribe((row) => {
      setFile((prev) => {
        // 从有到无 = 文件被删除，回列表而不是留在空白编辑页
        if (row === null && prev) navigate("/docs", { replace: true });
        return row;
      });
    });
    return () => sub.unsubscribe();
  }, [fileId, navigate]);

  if (!fileId || file === null) {
    return (
      <div className="doc-page">
        <p className="empty">{t("docNotFound")}</p>
      </div>
    );
  }
  if (file === undefined) {
    return (
      <div className="doc-page">
        <p className="empty">{t("loading")}</p>
      </div>
    );
  }

  // key 固定为文件 id：外部更新时间戳变化不重建编辑器，仅初次挂载加载内容
  return file.kind === "doc" ? (
    <DocPageEditor key={file.id} file={file} />
  ) : (
    <SheetEditor key={file.id} file={file} />
  );
}
