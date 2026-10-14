import { SimDocPhoto } from "./SimDocPhoto";
import { SimDocWatermark } from "./SimDocWatermark";

/**
 * 机动车驾驶证示意卡（正页 + 副页），两页均按 ID-1 卡规格：
 * 正页标题通栏、人像居左、右侧姓名（独行）/性别/国籍/出生日期纵排，
 * 住址通栏，底部「初次领证日期 · 准驾车型 · 有效期限」一行 + 证号条；
 * 副页登记档案信息（证号 / 档案编号 / 签发机关 / 记录）。
 */
export function SimDriverLicense({ data }: { data: Record<string, string> }) {
  return (
    <div className="sim-stack">
      <section className="sim-card sim-drv" aria-label="机动车驾驶证（正页示意）">
        <SimDocWatermark />
        <span className="sim-card__tag">正页 · 示意</span>
        <header className="sim-drv__head">
          <h3 className="sim-drv__title">中华人民共和国机动车驾驶证</h3>
        </header>
        <div className="sim-drv__body">
          <div className="sim-drv__photo">
            <SimDocPhoto photo={data.photo} />
          </div>
          <dl className="sim-drv__fields">
            <div className="sim-drv__row sim-drv__row--name">
              <dt>姓名</dt>
              <dd>{data.name}</dd>
            </div>
            <div className="sim-drv__row">
              <dt>性别</dt>
              <dd>{data.gender}</dd>
            </div>
            <div className="sim-drv__row">
              <dt>国籍</dt>
              <dd>{data.nationality}</dd>
            </div>
            <div className="sim-drv__row">
              <dt>出生日期</dt>
              <dd>{data.birthDate}</dd>
            </div>
          </dl>
        </div>
        <div className="sim-drv__addr">
          <span className="sim-drv__addr-label">住址</span>
          <p className="sim-dd--wrap">{data.address}</p>
        </div>
        <div className="sim-drv__foot-row">
          <p>
            <span>初次领证日期</span>
            <strong>{data.firstIssue}</strong>
          </p>
          <p>
            <span>准驾车型</span>
            <strong>{data.driveClass}</strong>
          </p>
          <p>
            <span>有效期限</span>
            <strong>{data.validPeriod}</strong>
          </p>
        </div>
        <p className="sim-drv__no">
          <span className="sim-drv__no-label">证号</span>
          <span className="sim-drv__no-value">{data.idNumber}</span>
        </p>
      </section>

      <section className="sim-card sim-drv-aux" aria-label="机动车驾驶证（副页示意）">
        <SimDocWatermark />
        <span className="sim-card__tag">副页 · 示意</span>
        <header className="sim-drv-aux__head">
          <h3 className="sim-drv__title">中华人民共和国机动车驾驶证（副页）</h3>
        </header>
        <dl className="sim-drv-aux__fields">
          <div className="sim-drv-aux__row">
            <dt>姓名</dt>
            <dd>{data.name}</dd>
          </div>
          <div className="sim-drv-aux__row">
            <dt>国籍</dt>
            <dd>{data.nationality}</dd>
          </div>
          <div className="sim-drv-aux__row sim-drv-aux__row--full">
            <dt>证号</dt>
            <dd className="sim-drv__no-value">{data.idNumber}</dd>
          </div>
          <div className="sim-drv-aux__row">
            <dt>档案编号</dt>
            <dd>{data.archiveNo}</dd>
          </div>
          <div className="sim-drv-aux__row">
            <dt>签发机关</dt>
            <dd className="sim-dd--wrap">{data.authority}</dd>
          </div>
          <div className="sim-drv-aux__row sim-drv-aux__row--full">
            <dt>记录</dt>
            <dd className="sim-dd--wrap">
              准驾车型 {data.driveClass}；有效期限 {data.validPeriod}。
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
