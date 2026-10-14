import { SimDocPhoto } from "./SimDocPhoto";
import { SimDocWatermark } from "./SimDocWatermark";

/** 机动车驾驶证示意卡：正页（人像 + 登记）+ 副页（档案信息） */
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
            <div>
              <dt>姓名</dt>
              <dd>{data.name}</dd>
            </div>
            <div>
              <dt>性别</dt>
              <dd>{data.gender}</dd>
            </div>
            <div>
              <dt>国籍</dt>
              <dd>{data.nationality}</dd>
            </div>
            <div>
              <dt>出生日期</dt>
              <dd>{data.birthDate}</dd>
            </div>
            <div>
              <dt>准驾车型</dt>
              <dd>{data.driveClass}</dd>
            </div>
            <div>
              <dt>初次领证日期</dt>
              <dd>{data.firstIssue}</dd>
            </div>
            <div className="sim-drv__cell--full">
              <dt>住址</dt>
              <dd className="sim-dd--wrap">{data.address}</dd>
            </div>
            <div className="sim-drv__cell--full">
              <dt>证号</dt>
              <dd className="sim-drv__no">{data.idNumber}</dd>
            </div>
            <div className="sim-drv__cell--full">
              <dt>有效期限</dt>
              <dd>{data.validPeriod}</dd>
            </div>
            <div className="sim-drv__cell--full">
              <dt>签发机关</dt>
              <dd>{data.authority}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="sim-card sim-drv-aux" aria-label="机动车驾驶证（副页示意）">
        <SimDocWatermark />
        <span className="sim-card__tag">副页 · 示意</span>
        <header className="sim-drv-aux__head">
          <h3 className="sim-drv__title">中华人民共和国机动车驾驶证 · 副页</h3>
        </header>
        <dl className="sim-drv-aux__fields">
          <div>
            <dt>证号</dt>
            <dd className="sim-drv__no">{data.idNumber}</dd>
          </div>
          <div>
            <dt>姓名</dt>
            <dd>{data.name}</dd>
          </div>
          <div>
            <dt>档案编号</dt>
            <dd>{data.archiveNo}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
