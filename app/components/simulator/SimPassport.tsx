import { SimDocPhoto } from "./SimDocPhoto";
import { SimDocWatermark } from "./SimDocWatermark";

const MRZ_LEN = 44;

/** 机读区第一行：P<CHN+拼音姓<<名，不足补 <；仅排版示意 */
function mrzLine1(nameEn: string): string {
  const clean = (nameEn || "SAMPLE").toUpperCase().replace(/[^A-Z ]/g, "");
  const parts = clean.split(/\s+/).filter(Boolean);
  const surname = (parts[0] ?? "SAMPLE").padEnd(12, "<").slice(0, 12);
  const given = (parts.slice(1).join("") || "SAMPLE").padEnd(15, "<").slice(0, 15);
  return `P<CHN${surname}<<${given}`.padEnd(MRZ_LEN, "<").slice(0, MRZ_LEN);
}

/**
 * 机读区第二行：护照号 + 国籍 + 出生日期/有效期 + 性别。
 * 校验位一律以 < 占位（不生成合法校验码），保持纯示意属性。
 */
function mrzLine2(data: Record<string, string>): string {
  const digits = (v: string) => v.replace(/\D/g, "");
  const no = (data.passportNo || "E00000000").toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(9, "<").slice(0, 9);
  const dob = digits(data.birthDate ?? "").slice(2, 8).padEnd(6, "<");
  const exp = digits(data.expiryDate ?? "").slice(2, 8).padEnd(6, "<");
  const sex = data.gender === "女" ? "F" : "M";
  return `${no}<CHN${dob}<${sex}${exp}<`.padEnd(MRZ_LEN, "<").slice(0, MRZ_LEN);
}

/** 护照资料页示意卡：双语印刷 + 人像 + 机读区（校验位留白） */
export function SimPassport({ data }: { data: Record<string, string> }) {
  const [surname, ...rest] = (data.nameEn || "ZHANG SAN").toUpperCase().split(/\s+/).filter(Boolean);
  return (
    <section className="sim-card sim-pass" aria-label="中华人民共和国护照（资料页示意）">
      <SimDocWatermark />
      <span className="sim-card__tag">示意</span>
      <header className="sim-pass__head">
        <div>
          <p className="sim-card__cn">中华人民共和国</p>
          <h3 className="sim-pass__title">
            护照<span className="sim-pass__title-en">PASSPORT</span>
          </h3>
        </div>
        <div className="sim-pass__chips">
          <p>
            <span className="sim-card__label">类型 TYPE</span>
            <strong>P</strong>
          </p>
          <p>
            <span className="sim-card__label">国家码 CODE</span>
            <strong>CHN</strong>
          </p>
          <p>
            <span className="sim-card__label">护照号 NO.</span>
            <strong>{data.passportNo}</strong>
          </p>
        </div>
      </header>
      <div className="sim-pass__body">
        <dl className="sim-pass__fields">
          <div>
            <dt>姓名 NAME</dt>
            <dd>{data.name}</dd>
          </div>
          <div>
            <dt>姓 SURNAME</dt>
            <dd>{surname ?? ""}</dd>
          </div>
          <div>
            <dt>名 GIVEN NAMES</dt>
            <dd>{rest.join(" ")}</dd>
          </div>
          <div>
            <dt>出生日期 DATE OF BIRTH</dt>
            <dd>{data.birthDate}</dd>
          </div>
          <div>
            <dt>性别 SEX</dt>
            <dd>{data.gender === "女" ? "女 F" : "男 M"}</dd>
          </div>
          <div>
            <dt>出生地 PLACE OF BIRTH</dt>
            <dd>{data.birthPlace}</dd>
          </div>
          <div>
            <dt>签发地点 PLACE OF ISSUE</dt>
            <dd>{data.issuePlace}</dd>
          </div>
          <div>
            <dt>签发机关 AUTHORITY</dt>
            <dd className="sim-dd--wrap">{data.authority}</dd>
          </div>
          <div>
            <dt>签发日期 DATE OF ISSUE</dt>
            <dd>{data.issueDate}</dd>
          </div>
          <div>
            <dt>有效期至 DATE OF EXPIRY</dt>
            <dd>{data.expiryDate}</dd>
          </div>
        </dl>
        <div className="sim-pass__photo">
          <SimDocPhoto photo={data.photo} />
        </div>
      </div>
      <div className="sim-pass__mrz" aria-hidden="true">
        <p>{mrzLine1(data.nameEn ?? "")}</p>
        <p>{mrzLine2(data)}</p>
      </div>
    </section>
  );
}
