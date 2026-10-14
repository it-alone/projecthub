import { useParams } from "@remix-run/react";
import { t as translate, useI18n } from "~/lib/i18n";
import { isSimDocType } from "~/models/simDoc";
import { SimEditor } from "~/components/simulator/SimEditor";

export const handle = { crumb: () => ({ label: translate("simulatorMenu"), to: "/simulator" }) };

/** 证件编辑页：面包屑回到「模拟器」；未知类型给出错误态 */
export default function SimulatorDocRoute() {
  const { type } = useParams();
  const { t } = useI18n();

  if (!type || !isSimDocType(type)) {
    return (
      <div className="page-pad">
        <p className="empty">{t("simNotFound")}</p>
      </div>
    );
  }
  return (
    <div className="page-pad">
      <SimEditor type={type} />
    </div>
  );
}
