import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { liveQuery } from "dexie";
import { db } from "~/repositories/db";
import { t as translate, useI18n } from "~/lib/i18n";
import { Icon } from "~/components/ui/Icon";
import { SIM_SAMPLE, simDocSchema, simDocTypes, type SimDoc } from "~/models/simDoc";
import {
  SIM_DOC_LAYOUT,
  SIM_TYPE_DESC_KEY,
  SIM_TYPE_NAME_KEY,
  SimDocumentPreview,
} from "~/components/simulator/SimDocumentPreview";

export const handle = { crumb: () => ({ label: translate("simulatorMenu") }) };

/** 模拟器首页：五种证面入口（真实比例缩略示意 + 编辑状态），点击进入编辑器 */
export default function SimulatorRoute() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<SimDoc[] | null>(null); // null = 加载中
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const sub = liveQuery(async () => {
      const rows = await db.simDocs.toArray();
      return rows
        .map((r) => simDocSchema.parse(r))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }).subscribe({ next: setDocs, error: () => setLoadError(true) });
    return () => sub.unsubscribe();
  }, []);

  const byType = new Map((docs ?? []).map((d) => [d.type, d]));
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
        <h1>{t("simulatorIndexTitle")}</h1>
        <span className="page-toolbar__spacer" />
      </div>
      <p className="hint hint--flush">{t("simulatorIndexHint")}</p>

      {loadError ? (
        <p className="empty">{t("simLoadFailed")}</p>
      ) : docs === null ? (
        <p className="empty">{t("loading")}</p>
      ) : (
        <ul className="sim-grid">
          {simDocTypes.map((type) => {
            const doc = byType.get(type);
            const layout = SIM_DOC_LAYOUT[type];
            return (
              <li key={type} className="sim-tile">
                <button
                  type="button"
                  className="sim-tile__open"
                  onClick={() => navigate(`/simulator/${type}`)}
                  aria-label={t("simOpenAria", { type: t(SIM_TYPE_NAME_KEY[type]) })}
                >
                  <span className="sim-tile__thumb" aria-hidden="true">
                    <span
                      className="sim-tile__scale"
                      style={{ transform: `scale(${236 / layout.w})`, width: layout.w }}
                    >
                      <SimDocumentPreview type={type} data={doc?.data ?? SIM_SAMPLE[type]} />
                    </span>
                  </span>
                  <span className="sim-tile__body">
                    <span className="sim-tile__name">{t(SIM_TYPE_NAME_KEY[type])}</span>
                    <span className="sim-tile__desc">{t(SIM_TYPE_DESC_KEY[type])}</span>
                    <span className={`sim-tile__meta${doc ? " is-edited" : ""}`}>
                      {doc ? (
                        <>
                          <Icon name="check" size={13} />
                          {t("simulatorEditedAt", { time: fmt(doc.updatedAt) })}
                        </>
                      ) : (
                        t("simulatorMake")
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
