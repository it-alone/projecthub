import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@remix-run/react";
import { liveQuery } from "dexie";
import { toCanvas as htmlToCanvas } from "html-to-image";
import { db } from "~/repositories/db";
import { simService } from "~/services/simulator.service";
import { useI18n } from "~/lib/i18n";
import { useToast } from "~/components/ui/Toast";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import {
  SIM_FIELDS,
  SIM_HAS_PHOTO,
  SIM_SAMPLE,
  simDocSchema,
  type SimDoc,
  type SimDocType,
} from "~/models/simDoc";
import { SIM_DOC_LAYOUT, SIM_TYPE_NAME_KEY, SimDocumentPreview } from "./SimDocumentPreview";
import { SimDocPhoto } from "./SimDocPhoto";

/** 沿祖先链取第一个非透明背景色：导出底色跟随当前主题，避免硬编码色值 */
function resolveExportBg(from: HTMLElement): string {
  let cur: HTMLElement | null = from;
  while (cur) {
    const c = getComputedStyle(cur).backgroundColor;
    if (c && c !== "transparent" && !c.endsWith(", 0)")) return c;
    cur = cur.parentElement;
  }
  return "transparent";
}

/** 人像压缩：长边 480px 的 JPEG（dataURL），控制 IndexedDB 行体积 */
async function downscalePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * 证件模拟器编辑器：左侧表单按字段配置生成，右侧证面按自然尺寸渲染后
 * 整体缩放适配；导出时按自然尺寸 2x 像素密度出 PNG（同流程图导出方案）。
 * 草稿只存内存，保存经 simService 落库；Esc 放弃未保存修改。
 */
export function SimEditor({ type }: { type: SimDocType }) {
  const { t } = useI18n();
  const toast = useToast();
  const [doc, setDoc] = useState<SimDoc | null | undefined>(undefined); // undefined = 加载中
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<Record<string, string> | null>(null); // null = 与库同步
  const [confirmReset, setConfirmReset] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null); // 预览可视容器（测可用宽度）
  const nodeRef = useRef<HTMLDivElement>(null); // 自然尺寸导出节点
  const layout = SIM_DOC_LAYOUT[type];

  useEffect(() => {
    const sub = liveQuery(async () => {
      const row = await db.simDocs.where("type").equals(type).first();
      return row ? simDocSchema.parse(row) : null;
    }).subscribe({ next: setDoc, error: () => setLoadError(true) });
    return () => sub.unsubscribe();
  }, [type]);

  // 预览缩放：跟随容器宽度；窄屏下限 0.32，保证整卡仍可辨认。
  // 依赖 ready：加载态提前 return 时 .sim-preview 尚未挂载，ref 为 null 拿不到观察目标。
  const ready = doc !== undefined;
  useEffect(() => {
    if (!ready) return;
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const avail = el.clientWidth - 32;
      setScale(Math.min(1, Math.max(0.32, avail / layout.w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.w, ready]);

  const base = doc ? doc.data : SIM_SAMPLE[type];
  const data = draft ?? base;
  const dirty = draft !== null;

  function setField(key: string, value: string) {
    setDraft({ ...(draft ?? base), [key]: value });
  }

  // 字段级快捷键：Enter 保存（textarea 保留换行）；Esc 放弃未保存草稿。
  // Enter 不能只靠 form 隐式提交——WebKit 下 form 外用 form= 关联的按钮不构成默认提交按钮。
  function onFieldKey(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === "Escape" && draft) {
      e.preventDefault();
      setDraft(null);
      toast.success(t("simReverted"));
    }
  }

  async function save() {
    try {
      await simService.save(type, data);
      setDraft(null);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("simSaveFailed"));
    }
  }

  async function resetSample() {
    setConfirmReset(false);
    try {
      await simService.reset(type);
      setDraft(null);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("simSaveFailed"));
    }
  }

  /** 导出 PNG：按证面自然尺寸 + 2x 像素密度，文件名带「样本」后缀 */
  async function exportPng() {
    const node = nodeRef.current;
    if (!node || isExporting) return;
    setIsExporting(true);
    try {
      // 等两帧让最近一次草稿改动渲染完成再截图
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      const canvas = await htmlToCanvas(node, {
        width: w,
        height: h,
        pixelRatio: 2,
        backgroundColor: resolveExportBg(node),
        // 覆盖预览缩放：无论界面缩放多少，导出恒为自然尺寸
        style: { width: `${w}px`, height: `${h}px`, transform: "none" },
      });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error(t("simExportFailed"));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${t(SIM_TYPE_NAME_KEY[type])}·样本.png`;
      link.click();
      // 延迟回收：Safari 等浏览器在 click 返回后仍需从该 URL 读取下载内容
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t("simExportDone"));
    } catch {
      toast.error(t("simExportFailed"));
    } finally {
      setIsExporting(false);
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setField("photo", await downscalePhoto(file));
    } catch {
      toast.error(t("simPhotoTooLarge"));
    }
  }

  if (loadError) {
    return <p className="empty">{t("simLoadFailed")}</p>;
  }
  if (doc === undefined) {
    return <p className="empty">{t("loading")}</p>;
  }

  return (
    <div>
      <div className="page-toolbar">
        <Link to="/simulator" className="sim-back">
          <Icon name="back" size={15} />
          {t("simulatorMenu")}
        </Link>
        <h1>{t(SIM_TYPE_NAME_KEY[type])}</h1>
        <span className={`hint${dirty ? " sim-hint--dirty" : ""}`}>{t("simEditorHint")}</span>
        <span className="page-toolbar__spacer" />
        <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
          {t("simReset")}
        </button>
        <button type="button" className="btn" onClick={() => void exportPng()} disabled={isExporting}>
          <Icon name="download" size={14} />
          {t("simExportPng")}
        </button>
        <button type="submit" form="sim-form" className="btn btn--primary">
          <Icon name="check" size={14} />
          {t("save")}
        </button>
      </div>

      <div className="sim-editor">
        <form
          id="sim-form"
          className="sim-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {SIM_HAS_PHOTO[type] && (
            <div className="sim-form__photo">
              <span className="sim-form__photo-box">
                <SimDocPhoto photo={data.photo} />
              </span>
              <span className="sim-form__photo-actions">
                <label className="btn">
                  <Icon name="upload" size={14} />
                  {t("simPhotoUpload")}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      void pickPhoto(e.target.files?.[0]);
                      e.target.value = ""; // 允许重复选同一张
                    }}
                  />
                </label>
                {data.photo && (
                  <button type="button" className="btn btn--ghost" onClick={() => setField("photo", "")}>
                    {t("simPhotoClear")}
                  </button>
                )}
                <span className="hint hint--flush">{t("simPhotoHint")}</span>
              </span>
            </div>
          )}
          {SIM_FIELDS[type].map((f) => {
            const value = data[f.key] ?? "";
            return (
              <label
                key={f.key}
                className={`field-label form-field sim-form__field${f.full ? " sim-form__field--full" : ""}`}
              >
                {t(f.labelKey)}
                {f.options ? (
                  <select
                    className="input"
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    onKeyDown={onFieldKey}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : f.area ? (
                  <textarea
                    className="input sim-form__area"
                    rows={2}
                    maxLength={f.max ?? 100}
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    onKeyDown={onFieldKey}
                  />
                ) : (
                  <input
                    className="input"
                    maxLength={f.max ?? 100}
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    onKeyDown={onFieldKey}
                  />
                )}
              </label>
            );
          })}
        </form>

        <div className="sim-preview" ref={stageRef}>
          <div
            className="sim-preview__stage"
            style={{ width: layout.w * scale, height: layout.h * scale }}
          >
            <div className="sim-preview__scaler" style={{ transform: `scale(${scale})` }}>
              <div ref={nodeRef}>
                <SimDocumentPreview type={type} data={data} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t("simResetTitle")}
        message={t("simConfirmReset")}
        danger
        onConfirm={() => void resetSample()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
