import { z } from "zod";
import type { Dict } from "~/locales/zh-CN";

/**
 * 证件模拟器（独立应用级模块）：身份证 / 护照 / 营业执照 / 道路运输证 / 驾驶证
 * 五种证面均为「示意卡片」——印刷排版近似真实证照，但数据是内置虚构样本，
 * 导出图自带「样本 SAMPLE」水印，仅供界面演示 / 联调 / 教学场景使用。
 */
export const simDocTypes = [
  "idCard",
  "passport",
  "businessLicense",
  "roadTransport",
  "driverLicense",
] as const;
export type SimDocType = (typeof simDocTypes)[number];

export function isSimDocType(v: string): v is SimDocType {
  return (simDocTypes as readonly string[]).includes(v);
}

/** 证面是否有人像位（上传照片存 dataURL，仅存本地 IndexedDB） */
export const SIM_HAS_PHOTO: Record<SimDocType, boolean> = {
  idCard: true,
  passport: true,
  businessLicense: false,
  roadTransport: false,
  driverLicense: true,
};

/** 表单字段定义：half 半宽 / full 整行 / area 多行；options 单选（选项值即证面印刷内容） */
export interface SimFieldDef {
  key: string;
  labelKey: keyof Dict; // 表单标签走 i18n（UI 文案）；证面印刷体标签是版式内容，组件内固定
  max?: number;
  full?: boolean;
  area?: boolean;
  options?: string[];
}

export const SIM_FIELDS: Record<SimDocType, SimFieldDef[]> = {
  idCard: [
    { key: "name", labelKey: "simFPersonName", max: 30 },
    { key: "gender", labelKey: "simFGender", max: 2, options: ["男", "女"] },
    { key: "ethnicity", labelKey: "simFEthnicity", max: 10 },
    { key: "birthDate", labelKey: "simFBirthDate", max: 20 },
    { key: "idNumber", labelKey: "simFIdNumber", max: 32 },
    { key: "address", labelKey: "simFAddress", max: 80, full: true, area: true },
    { key: "authority", labelKey: "simFAuthority", max: 40, full: true },
    { key: "validPeriod", labelKey: "simFValidPeriod", max: 40, full: true },
  ],
  passport: [
    { key: "name", labelKey: "simFPersonName", max: 30 },
    { key: "nameEn", labelKey: "simFNameEn", max: 40 },
    { key: "gender", labelKey: "simFGender", max: 2, options: ["男", "女"] },
    { key: "passportNo", labelKey: "simFPassportNo", max: 12 },
    { key: "birthDate", labelKey: "simFBirthDate", max: 20 },
    { key: "birthPlace", labelKey: "simFBirthPlace", max: 20 },
    { key: "issuePlace", labelKey: "simFIssuePlace", max: 20 },
    { key: "issueDate", labelKey: "simFIssueDate", max: 20 },
    { key: "expiryDate", labelKey: "simFExpiryDate", max: 20 },
    { key: "authority", labelKey: "simFAuthority", max: 40, full: true },
  ],
  businessLicense: [
    { key: "name", labelKey: "simFOrgName", max: 40 },
    { key: "uscc", labelKey: "simFUscc", max: 32 },
    { key: "orgType", labelKey: "simFOrgType", max: 30 },
    { key: "legalRep", labelKey: "simFLegalRep", max: 30 },
    { key: "address", labelKey: "simFAddress", max: 80, full: true },
    { key: "capital", labelKey: "simFCapital", max: 30 },
    { key: "established", labelKey: "simFEstablished", max: 20 },
    { key: "businessPeriod", labelKey: "simFBusinessPeriod", max: 30 },
    { key: "scope", labelKey: "simFScope", max: 200, full: true, area: true },
    { key: "regAuthority", labelKey: "simFRegAuthority", max: 40, full: true },
    { key: "issueDate", labelKey: "simFIssueDate", max: 20 },
  ],
  roadTransport: [
    { key: "ownerName", labelKey: "simFOwner", max: 40 },
    { key: "plateNo", labelKey: "simFPlateNo", max: 15 },
    { key: "vehicleType", labelKey: "simFCarType", max: 20 },
    { key: "tonnage", labelKey: "simFTonnage", max: 20 },
    { key: "licenseNo", labelKey: "simFOperLicenseNo", max: 30, full: true },
    { key: "scope", labelKey: "simFScope", max: 60, full: true },
    { key: "certNo", labelKey: "simFCertNo", max: 30, full: true },
    { key: "validPeriod", labelKey: "simFValidPeriod", max: 40 },
    { key: "issuer", labelKey: "simFIssuer", max: 40 },
    { key: "issueDate", labelKey: "simFIssueDate", max: 20 },
  ],
  driverLicense: [
    { key: "name", labelKey: "simFPersonName", max: 30 },
    { key: "gender", labelKey: "simFGender", max: 2, options: ["男", "女"] },
    { key: "nationality", labelKey: "simFNationality", max: 10 },
    { key: "driveClass", labelKey: "simFDriveClass", max: 8 },
    { key: "idNumber", labelKey: "simFIdNumber", max: 32 },
    { key: "archiveNo", labelKey: "simFArchiveNo", max: 20 },
    { key: "birthDate", labelKey: "simFBirthDate", max: 20 },
    { key: "firstIssue", labelKey: "simFFirstIssue", max: 20 },
    { key: "validPeriod", labelKey: "simFValidPeriod", max: 40 },
    { key: "authority", labelKey: "simFAuthority", max: 40, full: true },
    { key: "address", labelKey: "simFAddress", max: 80, full: true, area: true },
  ],
};

/**
 * 内置虚构样本数据（每种一档）。姓名统一「张三」、证件号为全 0 尾号等
 * 明显占位样式，不构成任何真实证件；用户可随意改写。
 */
export const SIM_SAMPLE: Record<SimDocType, Record<string, string>> = {
  idCard: {
    name: "张三",
    gender: "男",
    ethnicity: "汉",
    birthDate: "1990.03.07",
    idNumber: "110101199003070000",
    address: "演示省示例市XX区样本路 1 号院 2 号楼 3 单元 401 室",
    authority: "示例市公安局XX分局",
    validPeriod: "2020.03.07 - 2040.03.07",
  },
  passport: {
    name: "张三",
    nameEn: "ZHANG SAN",
    gender: "男",
    passportNo: "E00000000",
    birthDate: "1990.03.07",
    birthPlace: "示例市",
    issuePlace: "示例市",
    issueDate: "2022.06.10",
    expiryDate: "2032.06.10",
    authority: "中华人民共和国国家移民管理局",
  },
  businessLicense: {
    name: "示例市演示科技有限公司",
    uscc: "91110108MA0DEMO012",
    orgType: "有限责任公司",
    legalRep: "张三",
    address: "演示省示例市XX区样本路 1 号 2 层 201 室",
    capital: "人民币 100 万元",
    established: "2020.03.07",
    businessPeriod: "2020.03.07 至 2040.03.07",
    scope: "技术开发、技术咨询、技术转让、技术推广、技术服务；软件开发。（依法须经批准的项目，经相关部门批准后依批准的内容开展经营活动。）",
    regAuthority: "示例市XX区市场监督管理局",
    issueDate: "2020.03.20",
  },
  roadTransport: {
    ownerName: "示例市演示物流有限公司",
    plateNo: "示例A·00001",
    vehicleType: "中型厢式货车",
    tonnage: "4.90 吨",
    licenseNo: "示例交运管许可字 0000001 号",
    scope: "道路普通货物运输",
    certNo: "示例交运管 000000001",
    validPeriod: "2024.01.01 - 2028.12.31",
    issuer: "示例市交通运输局",
    issueDate: "2024.01.01",
  },
  driverLicense: {
    name: "张三",
    gender: "男",
    nationality: "中国",
    driveClass: "C1",
    idNumber: "110101199003070000",
    archiveNo: "000000000000",
    birthDate: "1990.03.07",
    firstIssue: "2012.08.15",
    validPeriod: "2022.08.15 - 2028.08.15",
    authority: "示例市公安局公安交通管理局",
    address: "演示省示例市XX区样本路 1 号院 2 号楼 3 单元 401 室",
  },
};

/** 一档本地文档 = 一种证面的一份填写数据（每类型至多一份，按 type upsert） */
export const simDocSchema = z.object({
  id: z.string(),
  type: z.enum(simDocTypes),
  data: z.record(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SimDoc = z.infer<typeof simDocSchema>;
