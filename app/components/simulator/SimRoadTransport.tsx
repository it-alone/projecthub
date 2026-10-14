import { SimDocWatermark } from "./SimDocWatermark";

/**
 * 道路运输证正本示意卡，版式按横幅证书规格：
 * 通栏标题带、证书边框、业户/车辆信息表格（半栏/通栏混排）、
 * 发证机关行盖「样本专用章」、底部监制落款。
 */
export function SimRoadTransport({ data }: { data: Record<string, string> }) {
  return (
    <section className="sim-card sim-rt" aria-label="道路运输证（正本示意）">
      <SimDocWatermark />
      <span className="sim-card__tag">示意</span>
      <header className="sim-rt__band">
        <span className="sim-rt__emblem" aria-hidden="true" />
        <h3 className="sim-rt__title">中华人民共和国道路运输证</h3>
        <span className="sim-rt__vol">正本</span>
      </header>
      <div className="sim-rt__table">
        <span className="sim-rt__th">业户名称</span>
        <span className="sim-rt__td sim-rt__cell--span3">{data.ownerName}</span>
        <span className="sim-rt__th">车辆号牌</span>
        <span className="sim-rt__td sim-rt__td--plate">{data.plateNo}</span>
        <span className="sim-rt__th">车辆类型</span>
        <span className="sim-rt__td">{data.vehicleType}</span>
        <span className="sim-rt__th">核定载质量</span>
        <span className="sim-rt__td">{data.tonnage}</span>
        <span className="sim-rt__th">有效期限</span>
        <span className="sim-rt__td">{data.validPeriod}</span>
        <span className="sim-rt__th">经营范围</span>
        <span className="sim-rt__td sim-rt__cell--span3">{data.scope}</span>
        <span className="sim-rt__th">经营许可证号</span>
        <span className="sim-rt__td sim-rt__cell--span3">{data.licenseNo}</span>
        <span className="sim-rt__th">发证机关</span>
        <span className="sim-rt__td sim-rt__cell--span3 sim-rt__td--issuer">
          {data.issuer}
          <span className="sim-stamp sim-stamp--sm" aria-hidden="true">
            样本
            <br />
            专用章
          </span>
        </span>
        <span className="sim-rt__th">证件字号</span>
        <span className="sim-rt__td sim-rt__cell--span3">{data.certNo}</span>
      </div>
      <footer className="sim-rt__foot">
        <p>中华人民共和国交通运输部监制</p>
        <p>
          <span className="sim-card__label">发证日期</span>
          {data.issueDate}
        </p>
      </footer>
    </section>
  );
}
