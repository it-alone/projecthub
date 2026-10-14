import { SimDocWatermark } from "./SimDocWatermark";

/**
 * 营业执照正本示意卡，版式按公开规格（正本 420×297mm 横幅）：
 * 国徽位于正中标题上方、红色大字标题、统一社会信用代码居中、
 * 双线花边框、登记项目半栏/通栏混排、左下二维码位 + 「样本专用章」。
 */
export function SimBusinessLicense({ data }: { data: Record<string, string> }) {
  return (
    <section className="sim-card sim-bl" aria-label="营业执照（正本示意）">
      <SimDocWatermark />
      <span className="sim-card__tag">示意</span>
      <header className="sim-bl__head">
        {/* 国徽占位：仅表达真实版式中的位置，用简化五角星示意 */}
        <span className="sim-bl__emblem" aria-hidden="true" />
        <h3 className="sim-bl__title">营业执照</h3>
        <p className="sim-bl__sub">（正本）</p>
        <p className="sim-bl__uscc-row">
          <span className="sim-card__label">统一社会信用代码</span>
          <strong className="sim-bl__uscc">{data.uscc}</strong>
        </p>
      </header>
      <div className="sim-bl__grid">
        <div className="sim-bl__row sim-bl__row--full">
          <span>名称</span>
          <strong>{data.name}</strong>
        </div>
        <div className="sim-bl__row sim-bl__row--full">
          <span>类型</span>
          <strong>{data.orgType}</strong>
        </div>
        <div className="sim-bl__row">
          <span>法定代表人</span>
          <strong>{data.legalRep}</strong>
        </div>
        <div className="sim-bl__row">
          <span>住所</span>
          <strong className="sim-dd--wrap">{data.address}</strong>
        </div>
        <div className="sim-bl__row">
          <span>注册资本</span>
          <strong>{data.capital}</strong>
        </div>
        <div className="sim-bl__row">
          <span>成立日期</span>
          <strong>{data.established}</strong>
        </div>
        <div className="sim-bl__row sim-bl__row--full">
          <span>营业期限</span>
          <strong>{data.businessPeriod}</strong>
        </div>
        <div className="sim-bl__row sim-bl__row--scope">
          <span>经营范围</span>
          <strong className="sim-dd--wrap">{data.scope}</strong>
        </div>
      </div>
      <footer className="sim-bl__foot">
        {/* 二维码占位：真实版式左下角为登记信息二维码 */}
        <span className="sim-bl__qr" aria-hidden="true" />
        <div className="sim-bl__issue">
          <p>
            <span className="sim-card__label">登记机关</span>
            {data.regAuthority}
          </p>
          <p>
            <span className="sim-card__label">日期</span>
            {data.issueDate}
          </p>
        </div>
        <span className="sim-stamp" aria-hidden="true">
          样本
          <br />
          专用章
        </span>
      </footer>
    </section>
  );
}
