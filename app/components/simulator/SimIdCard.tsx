import { SimDocPhoto } from "./SimDocPhoto";
import { SimDocWatermark } from "./SimDocWatermark";

/** 身份号码按 6-8-4 分组排版（只影响展示，不改动数据） */
function formatIdNumber(no: string): string {
  const s = no.replace(/\s+/g, "");
  return s.length === 18 ? `${s.slice(0, 6)} ${s.slice(6, 14)} ${s.slice(14)}` : s;
}

/**
 * 居民身份证示意卡（正面 + 背面），版式按二代证公开规格排版：
 * ID-1 卡尺寸、国徽位于左上、照片居左、右侧依次为姓名（独行）/
 * 性别·民族（同行）/ 出生，住址通栏两行，号码条压底。
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
          {/* 国徽占位：仅表达真实版式中的位置，用简化五角星示意 */}
          <span className="sim-id__emblem" aria-hidden="true" />
          <h3 className="sim-id__title">中华人民共和国居民身份证</h3>
        </header>
        <div className="sim-id__body">
          <div className="sim-id__photo">
            <SimDocPhoto photo={data.photo} />
          </div>
          <dl className="sim-dl">
            <div className="sim-dl__row sim-dl__row--name">
              <dt>姓名</dt>
              <dd>{data.name}</dd>
            </div>
            <div className="sim-dl__pair">
              <div className="sim-dl__row">
                <dt>性别</dt>
                <dd>{data.gender}</dd>
              </div>
              <div className="sim-dl__row">
                <dt>民族</dt>
                <dd>{data.ethnicity}</dd>
              </div>
            </div>
            <div className="sim-dl__row">
              <dt>出生</dt>
              <dd>{data.birthDate}</dd>
            </div>
          </dl>
        </div>
        <div className="sim-id__addr">
          <span className="sim-id__addr-label">住址</span>
          <p className="sim-dd--wrap">{data.address}</p>
        </div>
        <p className="sim-id__no">
          <span className="sim-id__no-label">公民身份号码</span>
          <span className="sim-id__no-value">{formatIdNumber(data.idNumber ?? "")}</span>
        </p>
      </section>

      <section className="sim-card sim-id sim-id--back" aria-label="居民身份证（背面示意）">
        <SimDocWatermark />
        <span className="sim-card__tag">背面 · 示意</span>
        {/* 真实背面无标题，仅右侧大面积国徽底纹 + 中部签发信息 */}
        <span className="sim-id__back-emblem" aria-hidden="true" />
        <div className="sim-id__back-body">
          <dl className="sim-dl">
            <div className="sim-dl__row sim-dl__row--name">
              <dt>签发机关</dt>
              <dd>{data.authority}</dd>
            </div>
            <div className="sim-dl__row sim-dl__row--name">
              <dt>有效期限</dt>
              <dd>{data.validPeriod}</dd>
            </div>
          </dl>
          <p className="sim-id__back-hint">签发机关盖章区（示意）</p>
        </div>
      </section>
    </div>
  );
}
