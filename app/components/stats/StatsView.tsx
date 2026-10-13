import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "~/lib/i18n";
import { PRIORITY_META, PRIORITY_LABEL_KEY } from "~/lib/priority";
import {
  computeBurndown,
  computePriorityDistribution,
  computeStatusDistribution,
  computeTrend,
  computeWorkload,
  type BurndownPoint,
  type StatusSlice,
  type TrendPoint,
  type WorkloadRow,
} from "~/lib/stats";
import { Icon } from "~/components/ui/Icon";
import type { Task } from "~/models/task";
import type { StatusColumn } from "~/models/project";
import type { User } from "~/models/user";

interface StatsViewProps {
  tasks: Task[];
  columns: StatusColumn[];
  users: User[];
}

function fmtDay(day: string): string {
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
}

/** 取不小于真实峰值的“整数友好”刻度上限，保证 Y 轴刻度不出现小数 */
function niceMax(v: number): number {
  const steps = [1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200, 250, 400, 500, 1000];
  return steps.find((s) => v <= s) ?? Math.ceil(v / 500) * 500;
}

/** 图例小色块：实心色块或虚线段（用于理想线/均值线） */
function LegendItem({ tone, color, children }: { tone: "solid" | "dashed"; color: string; children: ReactNode }) {
  return (
    <span className="stats-legend__item">
      <span
        className={`stats-legend__swatch${tone === "dashed" ? " stats-legend__swatch--dashed" : ""}`}
        style={tone === "dashed" ? { borderColor: color } : { background: color }}
      />
      {children}
    </span>
  );
}

/** 卡片头：标题 + 副标题 + 右侧图例，让每张图都能自解释 */
function CardHead({ title, hint, legend }: { title: string; hint?: string; legend?: ReactNode }) {
  return (
    <header className="stats-card__head">
      <div className="stats-card__heading">
        <h3 className="stats-card__title">{title}</h3>
        {hint && <p className="stats-card__hint">{hint}</p>}
      </div>
      {legend && <div className="stats-legend">{legend}</div>}
    </header>
  );
}

/** 燃尽图：剩余折线 + 累计完成折线 + 理想燃尽线，悬停显示每日明细 */
function BurndownChart({ points }: { points: BurndownPoint[] }) {
  const { t } = useI18n();
  if (points.length === 0) return <p className="empty">{t("statsNoData")}</p>;
  const W = 640;
  const H = 232;
  const PAD = { l: 30, r: 44, t: 14, b: 24 };
  const single = points.length === 1;
  const peak = Math.max(
    ...points.map((p) => Math.max(p.remaining, p.completed)),
    points[0]!.created,
    1,
  );
  const max = niceMax(peak);
  const x = (i: number) =>
    single ? (PAD.l + W - PAD.r) / 2 : PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = (key: "remaining" | "completed") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const area = `${line("remaining")} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const last = points[points.length - 1]!;
  const labelEvery = Math.ceil(points.length / 7);
  const step = single ? W - PAD.l - PAD.r : (W - PAD.l - PAD.r) / (points.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("statsBurndown")} className="stats-svg">
      <defs>
        <linearGradient id="statsBurnArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="stats-burn-area__from" />
          <stop offset="100%" className="stats-burn-area__to" />
        </linearGradient>
      </defs>
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stats-gridline" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="stats-tick">{Math.round(v)}</text>
        </g>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={p.day} x={x(i)} y={H - 6} textAnchor="middle" className="stats-tick">{fmtDay(p.day)}</text>
        ) : null,
      )}
      <path d={area} className="stats-burn-area" />
      {!single && (
        <path
          d={`M${x(0).toFixed(1)},${y(points[0]!.created).toFixed(1)} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}`}
          className="stats-ideal"
        />
      )}
      <path d={line("completed")} className="stats-burn-line stats-burn-line--completed" />
      <path d={line("remaining")} className="stats-burn-line" />
      {!single && (
        <>
          <circle cx={x(points.length - 1)} cy={y(last.completed)} r="3.5" className="stats-burn-dot stats-burn-dot--completed" />
          <text x={W - PAD.r + 6} y={y(last.completed) + 4} className="stats-val stats-val--completed">{last.completed}</text>
        </>
      )}
      <circle cx={x(points.length - 1)} cy={y(last.remaining)} r="3.5" className="stats-burn-dot" />
      {!single && (
        <text x={W - PAD.r + 6} y={y(last.remaining) + 4} className="stats-val stats-val--remaining">{last.remaining}</text>
      )}
      {points.map((p, i) => (
        <rect
          key={`hit-${p.day}`}
          x={Math.min(Math.max(x(i) - step / 2, PAD.l), W - PAD.r - Math.min(step, W - PAD.r - PAD.l))}
          y={PAD.t}
          width={Math.min(step, W - PAD.r - PAD.l)}
          height={H - PAD.t - PAD.b}
          className="stats-hit"
        >
          <title>
            {`${fmtDay(p.day)} · ${t("statsLegendRemaining")} ${p.remaining} · ${t("statsLegendCompleted")} ${p.completed}`}
          </title>
        </rect>
      ))}
    </svg>
  );
}

/** 状态分布：环形图（完成列绿色，进行中列按主色深浅区分）+ 图例 */
function StatusDonut({ slices, total }: { slices: StatusSlice[]; total: number }) {
  const { t } = useI18n();
  const visible = slices.filter((s) => s.count > 0);
  if (visible.length === 0) return <p className="empty">{t("statsNoData")}</p>;
  const R = 56;
  const C = 2 * Math.PI * R;
  let nonDone = 0;
  let offset = 0;
  const rows = visible.map((s) => {
    // 完成列固定 success 色；其余列用主色与表面色渐次混合，保证双主题下均有区分度
    const color = s.isDone
      ? "var(--color-success)"
      : `color-mix(in srgb, var(--color-primary) ${Math.max(96 - nonDone * 28, 24)}%, var(--color-surface))`;
    if (!s.isDone) nonDone += 1;
    const len = (s.count / total) * C;
    const seg = { s, color, len, offset };
    offset += len;
    return seg;
  });
  return (
    <div className="stats-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={t("statsStatusDist")} className="stats-donut__svg">
        <circle cx="70" cy="70" r={R} className="stats-donut__track" />
        <g transform="rotate(-90 70 70)">
          {rows.map(({ s, color, len, offset: off }) => (
            <circle
              key={s.columnId}
              cx="70"
              cy="70"
              r={R}
              className="stats-donut__seg"
              style={{ stroke: color, strokeDasharray: `${Math.max(len - 2, 0.5)} ${C}`, strokeDashoffset: -off }}
            >
              <title>{`${s.name}：${s.count}（${Math.round((s.count / total) * 100)}%）`}</title>
            </circle>
          ))}
        </g>
        <text x="70" y="68" textAnchor="middle" className="stats-donut__num">{total}</text>
        <text x="70" y="85" textAnchor="middle" className="stats-donut__label">{t("statsTotal")}</text>
      </svg>
      <ul className="stats-donut__legend">
        {rows.map(({ s, color }) => (
          <li key={s.columnId} className="stats-donut__legend-row">
            <span className="stats-donut__legend-dot" style={{ background: color }} />
            <span className="stats-donut__legend-name" title={s.name}>{s.name}</span>
            <span className="stats-donut__legend-num">{s.count}</span>
            <span className="stats-donut__legend-pct">{Math.round((s.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 完成趋势：最近 8 周柱状 + 周均虚线，本周柱高亮并标注数值 */
function TrendChart({ weeks }: { weeks: TrendPoint[] }) {
  const { t } = useI18n();
  const W = 560;
  const H = 210;
  const PAD = { l: 26, r: 8, t: 18, b: 22 };
  const max = niceMax(Math.max(...weeks.map((w) => w.completed), 1));
  const avg = weeks.reduce((s, w) => s + w.completed, 0) / weeks.length;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const bw = (W - PAD.l - PAD.r) / weeks.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("statsTrend")} className="stats-svg">
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stats-gridline" />
          <text x={PAD.l - 5} y={y(v) + 4} textAnchor="end" className="stats-tick">{Math.round(v)}</text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(avg)} y2={y(avg)} className="stats-avg-line" />
      {weeks.map((w, i) => {
        const h = (w.completed / max) * (H - PAD.t - PAD.b);
        const now = i === weeks.length - 1;
        return (
          <g key={w.weekStart}>
            <rect
              x={PAD.l + i * bw + bw * 0.18}
              y={PAD.t + (H - PAD.t - PAD.b) - h}
              width={bw * 0.64}
              height={Math.max(h, w.completed > 0 ? 2 : 0)}
              rx={3}
              className={now ? "stats-bar stats-bar--now" : "stats-bar"}
            >
              <title>{`${now ? t("statsThisWeek") : fmtDay(w.weekStart)}：${w.completed}`}</title>
            </rect>
            {w.completed > 0 && (
              <text x={PAD.l + i * bw + bw / 2} y={PAD.t + (H - PAD.t - PAD.b) - h - 5} className="stats-bar-val">
                {w.completed}
              </text>
            )}
            <text
              x={PAD.l + i * bw + bw / 2}
              y={H - 6}
              textAnchor="middle"
              className={now ? "stats-tick stats-tick--now" : "stats-tick"}
            >
              {fmtDay(w.weekStart)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function StatsView({ tasks, columns, users }: StatsViewProps) {
  const { t } = useI18n();
  const today = new Date().toISOString().slice(0, 10);
  const active = tasks.filter((x) => !x.deletedAt);
  const burn = computeBurndown(tasks, today);
  const workload = computeWorkload(tasks, users).filter((r) => r.open + r.done > 0);
  const trend = computeTrend(tasks, today);
  const status = computeStatusDistribution(tasks, columns);
  const priority = computePriorityDistribution(tasks);

  const total = active.length;
  const done = active.filter((x) => x.completedAt).length;
  const open = total - done;
  const overdue = active.filter((x) => !x.completedAt && x.dueDate && x.dueDate.slice(0, 10) < today).length;
  const doneThisWeek = trend[trend.length - 1]?.completed ?? 0;
  const trendAvg = trend.reduce((s, w) => s + w.completed, 0) / Math.max(trend.length, 1);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hotCount = (priority.find((p) => p.priority === "urgent")?.count ?? 0)
    + (priority.find((p) => p.priority === "high")?.count ?? 0);
  const workloadMax = Math.max(...workload.map((r) => r.open + r.done), 1);
  // 完成率环形进度（36 视口下 r=15.5 的周长）
  const RING_C = 2 * Math.PI * 15.5;

  return (
    <div className="stats-page">
      <div className="stats-kpis">
        <div className="stats-kpi">
          <div className="stats-kpi__head">
            <span className="stats-kpi__icon"><Icon name="kanban" size={15} /></span>
            <span className="stats-kpi__label">{t("statsTotal")}</span>
          </div>
          <span className="stats-kpi__num">{total}</span>
          <span className="stats-kpi__sub">{t("statsUnfinishedSub", { count: open })}</span>
        </div>
        <div className="stats-kpi stats-kpi--done">
          <div className="stats-kpi__head">
            <span className="stats-kpi__icon"><Icon name="check" size={15} /></span>
            <span className="stats-kpi__label">{t("statsDone")}</span>
          </div>
          <span className="stats-kpi__num">{done}</span>
          <span className="stats-kpi__sub">{t("statsDoneWeekSub", { count: doneThisWeek })}</span>
        </div>
        <div className={`stats-kpi${overdue > 0 ? " stats-kpi--danger" : ""}`}>
          <div className="stats-kpi__head">
            <span className="stats-kpi__icon"><Icon name="flag" size={15} /></span>
            <span className="stats-kpi__label">{t("statsOverdue")}</span>
          </div>
          <span className="stats-kpi__num">{overdue}</span>
          <span className="stats-kpi__sub">
            {overdue > 0
              ? t("statsOverdueShareSub", { pct: Math.round((overdue / Math.max(open, 1)) * 100) })
              : t("statsOverdueNoneSub")}
          </span>
        </div>
        <div className="stats-kpi stats-kpi--rate">
          <div className="stats-kpi__head">
            <svg className="stats-kpi__ring" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15.5" className="stats-kpi__ring-track" />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                className="stats-kpi__ring-bar"
                strokeDasharray={`${(pct / 100) * RING_C} ${RING_C}`}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="stats-kpi__label">{t("statsCompletion")}</span>
          </div>
          <span className="stats-kpi__num">{pct}%</span>
          <span className="stats-kpi__sub">{t("statsCompletionSub", { count: total })}</span>
        </div>
      </div>

      <div className="stats-grid">
        <section className="card stats-card stats-card--burndown">
          <CardHead
            title={t("statsBurndown")}
            hint={t("statsBurndownHint")}
            legend={
              <>
                <LegendItem tone="solid" color="var(--color-primary)">{t("statsLegendRemaining")}</LegendItem>
                <LegendItem tone="solid" color="var(--color-success)">{t("statsLegendCompleted")}</LegendItem>
                <LegendItem tone="dashed" color="var(--color-text-muted)">{t("statsLegendIdeal")}</LegendItem>
              </>
            }
          />
          <BurndownChart points={burn} />
        </section>

        <section className="card stats-card stats-card--donut">
          <CardHead title={t("statsStatusDist")} hint={t("statsStatusDistHint")} />
          <StatusDonut slices={status} total={total} />
        </section>

        <section className="card stats-card stats-card--trend">
          <CardHead
            title={t("statsTrend")}
            hint={t("statsTrendHint")}
            legend={
              <>
                <LegendItem tone="solid" color="var(--color-primary)">{t("statsThisWeek")}</LegendItem>
                <LegendItem tone="dashed" color="var(--color-warning)">
                  {t("statsAvgWeek", { count: Math.round(trendAvg * 10) / 10 })}
                </LegendItem>
              </>
            }
          />
          <TrendChart weeks={trend} />
        </section>

        <section className="card stats-card stats-card--prio">
          <CardHead title={t("statsPriorityDist")} hint={t("statsPriorityDistHint")} />
          <ul className="stats-prio">
            {priority.map((p) => {
              const pPct = Math.round((p.count / Math.max(total, 1)) * 100);
              return (
                <li
                  key={p.priority}
                  className={`stats-prio__row${p.count === 0 ? " stats-prio__row--zero" : ""}`}
                  style={{ "--prio-c": PRIORITY_META[p.priority].color } as CSSProperties}
                >
                  <span className="prio__dot" />
                  <span className="stats-prio__name">{t(PRIORITY_LABEL_KEY[p.priority])}</span>
                  <span className="stats-prio__track">
                    <span className="stats-prio__bar" style={{ width: `${pPct}%` }} />
                  </span>
                  <span className="stats-prio__num">
                    {p.count}
                    <em>{pPct}%</em>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="stats-card__foot">
            {t("statsPrioHotSub", { count: hotCount, pct: Math.round((hotCount / Math.max(total, 1)) * 100) })}
          </p>
        </section>

        <section className="card stats-card stats-card--workload">
          <CardHead
            title={t("statsWorkload")}
            hint={t("statsWorkloadHint")}
            legend={
              <>
                <LegendItem tone="solid" color="var(--color-primary)">{t("statsLegendOpen")}</LegendItem>
                <LegendItem tone="solid" color="color-mix(in srgb, var(--color-success) 55%, var(--color-surface))">
                  {t("statsLegendDone")}
                </LegendItem>
              </>
            }
          />
          {workload.length === 0 ? (
            <p className="empty">{t("statsNoData")}</p>
          ) : (
            <ul className="stats-workload">
              {workload.map((r: WorkloadRow) => {
                const name = r.userId ? r.name : t("statsUnassigned");
                return (
                  <li key={r.userId || "none"} className="stats-workload__row">
                    <span
                      className={`stats-workload__avatar${r.color ? "" : " stats-workload__avatar--muted"}`}
                      style={r.color ? { background: r.color } : undefined}
                      aria-hidden="true"
                    >
                      {r.userId ? r.name.slice(0, 1) : "—"}
                    </span>
                    <span className="stats-workload__main">
                      <span className="stats-workload__name" title={name}>{name}</span>
                      <span
                        className="stats-workload__track"
                        role="img"
                        aria-label={t("statsWorkloadAria", { name, open: r.open, done: r.done })}
                      >
                        <span className="stats-workload__open" style={{ width: `${(r.open / workloadMax) * 100}%` }} />
                        <span className="stats-workload__done" style={{ width: `${(r.done / workloadMax) * 100}%` }} />
                      </span>
                    </span>
                    <span className="stats-workload__num">
                      <b>{r.open}</b>/{r.open + r.done}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
