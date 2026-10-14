import type { Dict } from "~/locales/zh-CN";
import type { SimDocType } from "~/models/simDoc";
import { SimBusinessLicense } from "./SimBusinessLicense";
import { SimDriverLicense } from "./SimDriverLicense";
import { SimIdCard } from "./SimIdCard";
import { SimPassport } from "./SimPassport";
import { SimRoadTransport } from "./SimRoadTransport";

/**
 * 各证面自然尺寸（px）：预览缩放与 PNG 导出的基准；
 * 多页证面（身份证 / 驾驶证）为正反面叠加后的总尺寸。
 */
export const SIM_DOC_LAYOUT: Record<SimDocType, { w: number; h: number }> = {
  idCard: { w: 672, h: 424 * 2 + 20 },
  passport: { w: 672, h: 474 },
  businessLicense: { w: 720, h: 510 },
  roadTransport: { w: 720, h: 510 },
  driverLicense: { w: 672, h: 424 + 20 + 232 },
};

/** 证面名称 / 描述的 i18n 键（列表页与编辑器共用） */
export const SIM_TYPE_NAME_KEY: Record<SimDocType, keyof Dict> = {
  idCard: "simTypeNameIdCard",
  passport: "simTypeNamePassport",
  businessLicense: "simTypeNameBusinessLicense",
  roadTransport: "simTypeNameRoadTransport",
  driverLicense: "simTypeNameDriverLicense",
};

export const SIM_TYPE_DESC_KEY: Record<SimDocType, keyof Dict> = {
  idCard: "simTypeDescIdCard",
  passport: "simTypeDescPassport",
  businessLicense: "simTypeDescBusinessLicense",
  roadTransport: "simTypeDescRoadTransport",
  driverLicense: "simTypeDescDriverLicense",
};

/** 按证面类型渲染示意卡片（编辑预览与列表缩略图共用） */
export function SimDocumentPreview({ type, data }: { type: SimDocType; data: Record<string, string> }) {
  switch (type) {
    case "idCard":
      return <SimIdCard data={data} />;
    case "passport":
      return <SimPassport data={data} />;
    case "businessLicense":
      return <SimBusinessLicense data={data} />;
    case "roadTransport":
      return <SimRoadTransport data={data} />;
    case "driverLicense":
      return <SimDriverLicense data={data} />;
  }
}
