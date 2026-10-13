import type { Task } from "~/models/task";
import type { StatusColumn } from "~/models/project";
import type { User } from "~/models/user";

export interface BurndownPoint {
  day: string; // YYYY-MM-DD
  created: number;
  completed: number;
  remaining: number;
}

export interface WorkloadRow {
  userId: string;
  name: string;
  /** 成员头像色（未指派行为空，由展示层兜底） */
  color: string | null;
  open: number;
  done: number;
}

export interface TrendPoint {
  weekStart: string; // YYYY-MM-DD（周一）
  completed: number;
}

export interface StatusSlice {
  columnId: string;
  name: string;
  /** 完成列（isDone）用于展示层区分语义色 */
  isDone: boolean;
  count: number;
}

export interface PrioritySlice {
  priority: Task["priority"];
  count: number;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 燃尽图：从项目首个任务创建日到今天，逐日累计剩余（已创建 − 已完成） */
export function computeBurndown(tasks: Task[], today: string): BurndownPoint[] {
  const active = tasks.filter((t) => !t.deletedAt);
  if (active.length === 0) return [];
  const firstDay = active.reduce(
    (min, t) => (dayKey(t.createdAt) < min ? dayKey(t.createdAt) : min),
    dayKey(active[0]!.createdAt),
  );
  const lastDay = today < firstDay ? firstDay : today;
  const createdOn = new Map<string, number>();
  const doneOn = new Map<string, number>();
  for (const t of active) {
    createdOn.set(dayKey(t.createdAt), (createdOn.get(dayKey(t.createdAt)) ?? 0) + 1);
    if (t.completedAt) {
      doneOn.set(dayKey(t.completedAt), (doneOn.get(dayKey(t.completedAt)) ?? 0) + 1);
    }
  }
  const points: BurndownPoint[] = [];
  let created = 0;
  let completed = 0;
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    created += createdOn.get(day) ?? 0;
    completed += doneOn.get(day) ?? 0;
    points.push({ day, created, completed, remaining: created - completed });
  }
  return points;
}

/** 成员负载：每人未完成/已完成任务数（含未指派一行） */
export function computeWorkload(tasks: Task[], users: User[]): WorkloadRow[] {
  const active = tasks.filter((t) => !t.deletedAt);
  const byUser = new Map<string, WorkloadRow>();
  for (const u of users) byUser.set(u.id, { userId: u.id, name: u.name, color: u.avatarColor ?? null, open: 0, done: 0 });
  const unassigned: WorkloadRow = { userId: "", name: "—", color: null, open: 0, done: 0 };
  for (const t of active) {
    const row = t.assigneeId ? byUser.get(t.assigneeId) : unassigned;
    if (!row) continue;
    if (t.completedAt) row.done += 1;
    else row.open += 1;
  }
  const rows = [...byUser.values()];
  if (unassigned.open + unassigned.done > 0) rows.push(unassigned);
  // 未完成降序；同数时具名成员在前，未指派垫底
  return rows.sort(
    (a, b) =>
      b.open - a.open ||
      (a.userId === "" ? 1 : 0) - (b.userId === "" ? 1 : 0) ||
      a.name.localeCompare(b.name),
  );
}

/** 完成趋势：最近 8 周（含本周）每周完成数 */
export function computeTrend(tasks: Task[], today: string): TrendPoint[] {
  const day = new Date(`${today}T00:00:00Z`);
  const dow = (day.getUTCDay() + 6) % 7; // 周一=0
  const thisMonday = addDays(today, -dow);
  const weeks: TrendPoint[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    weeks.push({ weekStart: addDays(thisMonday, -7 * i), completed: 0 });
  }
  const first = weeks[0]!.weekStart;
  for (const t of tasks) {
    if (t.deletedAt || !t.completedAt) continue;
    const key = dayKey(t.completedAt);
    if (key < first) continue;
    const dow2 = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(key, -dow2);
    const slot = weeks.find((w) => w.weekStart === monday);
    if (slot) slot.completed += 1;
  }
  return weeks;
}

/** 状态分布（按列顺序） */
export function computeStatusDistribution(tasks: Task[], columns: StatusColumn[]): StatusSlice[] {
  const active = tasks.filter((t) => !t.deletedAt);
  return [...columns]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ columnId: c.id, name: c.name, isDone: c.isDone, count: active.filter((t) => t.status === c.id).length }));
}

/** 优先级分布（urgent→none） */
export function computePriorityDistribution(tasks: Task[]): PrioritySlice[] {
  const order: Task["priority"][] = ["urgent", "high", "medium", "low", "none"];
  const active = tasks.filter((t) => !t.deletedAt);
  return order.map((p) => ({ priority: p, count: active.filter((t) => t.priority === p).length }));
}
