import { DocSuiteList } from "~/components/docsuite/DocSuiteList";
import { t as translate } from "~/lib/i18n";

export const handle = { crumb: () => ({ label: translate("docsMenu") }) };

/** 在线文档套件首页（我的空间）：文档 + 表格统一列表 */
export default function DocsSuiteRoute() {
  return <DocSuiteList />;
}
