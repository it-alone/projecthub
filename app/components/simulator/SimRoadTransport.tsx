import { SimDocWatermark } from "./SimDocWatermark";

/** 道路运输证正本示意卡：绿色抬头带 + 登记表格 + 监制落款 */
export function SimRoadTransport({ data }: { data: Record<string, string> }) {
  return (
    <section className="sim-card sim-rt" aria-label="道路运输证（正本示意）">
      <SimDocWatermark />
      <span className="sim-card__tag">示意</span>
      <header className="sim-rt__band">
        <span className="sim-card__cn">中华人民共和国</span>
        <h3 className="sim-rt__title">道路运输证</h3>
        <span className="sim-card__label">正本</span>
      </header>
      <div className="sim-rt__table">
        <span className="sim-rt__th">业户名称</span>
        <span className="sim-rt__td">{data.ownerName}</span>
        <span className="sim-rt__th">车辆号牌</span>
        <span className="sim-rt__td sim-rt__td--plate">{data.plateNo}</span>
        <span className="sim-rt__th">车辆类型</span>
        <span className="sim-rt__td">{data.vehicleType}</span>
        <span className="sim-rt__th">核定载质量</span>
        <span className="sim-rt__td">{data.tonnage}</span>
        <span className="sim-rt__th sim-rt__cell--full">经营范围</span>
        <span className="sim-rt__td sim-rt__cell--full">{data.scope}</span>
        <span className="sim-rt__th sim-rt__cell--full">经营许可证号</span>
        <span className="sim-rt__td sim-rt__cell--full">{data.licenseNo}</span>
        <span className="sim-rt__th">有效期限</span>
        <span className="sim-rt__td sim-rt__cell--span3">{data.validPeriod}</span>
        <span className="sim-rt__th">发证机关</span>
        <span className="sim-rt__td sim-rt__cell--span3">{data.issuer}</span>
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
