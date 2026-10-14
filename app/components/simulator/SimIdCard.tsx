import { SimDocPhoto } from "./SimDocPhoto";
import { SimDocWatermark } from "./SimDocWatermark";

/** 身份号码按 6-8-4 分组排版（只影响展示，不改动数据） */
function formatIdNumber(no: string): string {
  const s = no.replace(/\s+/g, "");
  return s.length === 18 ? `${s.slice(0, 6)} ${s.slice(6, 14)} ${s.slice(14)}` : s;
}

/**
 * 居民身份证示意卡（正面 + 背面）。
 * 证面印刷文字（国名、标题、字段名）属于证照版式内容而非界面文案，
 * 因此固定写死不走 i18n；字段值全部来自表单填写的虚构数据。
 */
export function SimIdCard({ data }: { data: Record<string, string> }) {
  return (
    <div className="sim-stack">
      <section className="sim-card sim-id" aria-label="居民身份证（正面示意）">
        <SimDocWatermark />
        <span className="sim-card__tag">正面 · 示意</span>
        <header className="sim-id__head">
          <span className="sim-card__cn">中华人民共和国</span>
          <h3 className="sim-id__title">居民身份证</h3>
        </header>
        <div className="sim-id__body">
          <div className="sim-id__photo">
            <SimDocPhoto photo={data.photo} />
          </div>
          <dl className="sim-dl">
            <div className="sim-dl__row">
              <dt>姓名</dt>
              <dd>{data.name}</dd>
              <dt>性别</dt>
              <dd>{data.gender}</dd>
              <dt>民族</dt>
              <dd>{data.ethnicity}</dd>
            </div>
            <div className="sim-dl__row">
              <dt>出生</dt>
              <dd>{data.birthDate}</dd>
            </div>
            <div className="sim-dl__row">
              <dt>住址</dt>
              <dd className="sim-dd--wrap">{data.address}</dd>
            </div>
          </dl>
        </div>
        <p className="sim-id__no">
          <span className="sim-card__label">公民身份号码</span>
          <span className="sim-id__no-value">{formatIdNumber(data.idNumber ?? "")}</span>
        </p>
      </section>

      <section className="sim-card sim-id sim-id--back" aria-label="居民身份证（背面示意）">
        <SimDocWatermark />
        <span className="sim-card__tag">背面 · 示意</span>
        <header className="sim-id__head">
          <span className="sim-card__cn">中华人民共和国</span>
          <h3 className="sim-id__title">居民身份证</h3>
        </header>
        <div className="sim-id__back-body">
          <dl className="sim-dl">
            <div className="sim-dl__row">
              <dt>签发机关</dt>
              <dd>{data.authority}</dd>
            </div>
            <div className="sim-dl__row">
              <dt>有效期限</dt>
              <dd>{data.validPeriod}</dd>
            </div>
          </dl>
          <p className="sim-id__back-hint">签发机关盖章（示意）</p>
        </div>
      </section>
    </div>
  );
}
