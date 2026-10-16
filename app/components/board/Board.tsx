import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { StatusColumn } from "~/models/project";
import type { Task } from "~/models/task";
import type { Label } from "~/models/label";
import type { TaskTemplate } from "~/models/taskTemplate";
import { generateKeyBetween } from "~/lib/fractional-index";
import { t } from "~/lib/i18n";
import { Column } from "./Column";

export interface MoveIntent {
  taskId: string;
  targetStatus: string;
  prevOrder: string | null;
  nextOrder: string | null;
  /** 落点 order（generateKeyBetween(prev, next)）：路由层乐观落位用，与 service 端写入值一致 */
  order: string;
}

/**
 * 碰撞策略：指针坐标优先（pointerWithin）——拖拽影与列同宽，closestCorners 会按
 * 影的角点吸附到邻近列，造成“指 A 落 B”；指针不在任何可放置目标内（列间沟槽）
 * 时退回 closestCorners。指针同时命中卡片与列容器时优先卡片（内层目标），
 * 保证插入位置按所指卡片的上/下半判定。
 */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    const taskHit = pointerCollisions.find((c) => {
      // Collision.data 是 Record<string, any>，整体收窄后取 droppableContainer.data.current
      const data = c.data as
        | { droppableContainer: { data?: { current?: { type?: string } } } }
        | undefined;
      return data?.droppableContainer.data?.current?.type === "task";
    });
    return [taskHit ?? pointerCollisions[0]!];
  }
  return closestCorners(args);
};

export interface BoardProps {
  columns: StatusColumn[];
  tasks: Task[];
  users: { id: string; name: string }[];
  labels: Label[];
  templates: TaskTemplate[];
  canCreate: boolean;
  canToggle: boolean;
  /** 变更类回调由调用方包装异步（(intent) => void handleMove(intent)） */
  onMove: (intent: MoveIntent) => void;
  onOpenTask: (task: Task) => void;
  onToggleDone: (task: Task, done: boolean) => void;
  onCreate: (status: string, title: string) => void;
  onCreateFromTemplate: (tpl: TaskTemplate, status: string) => void;
}

/** 列内布局：父分组展示——顶层锚点卡后紧跟其子卡；父不在本列的子卡独立成锚点 */
interface ColumnLayout {
  /** 扁平展示序列（锚点 + 各自子卡，均已按 order 排序） */
  flat: Task[];
  /** 顶层条目（可插入位置只在这些卡之间） */
  anchors: Task[];
  /** 锚点/子卡 → 其父锚点 id（组内子卡才有，用于落点归属） */
  anchorIdOf: Record<string, string>;
}

export function Board({
  columns, tasks, users, labels, templates, canCreate, canToggle, onMove, onOpenTask, onToggleDone, onCreate, onCreateFromTemplate,
}: BoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // 屏幕阅读器播报拖拽结果
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<Task | null>(null);

  const assigneeNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of users) map[u.id] = u.name;
    return map;
  }, [users]);

  // 父子信息：子卡显示父任务标识；父卡显示子任务完成进度（勾选完成以 completedAt 为准）
  const parentTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tk of tasks) map[tk.id] = tk.title;
    return map;
  }, [tasks]);

  const subProgress = useMemo(() => {
    const map: Record<string, { done: number; total: number }> = {};
    for (const tk of tasks) {
      if (!tk.parentId) continue;
      const stat = (map[tk.parentId] ??= { done: 0, total: 0 });
      stat.total += 1;
      if (tk.completedAt) stat.done += 1;
    }
    return map;
  }, [tasks]);

  /** 拖动父任务时跟随的子任务数（overlay 角标 + 播报用），含跨列未聚齐的子任务 */
  const draggingSubCount = useMemo(
    () => (dragging ? tasks.filter((tk) => tk.parentId === dragging.id).length : 0),
    [dragging, tasks],
  );

  function layoutOf(status: string, excludeGroupId?: string): ColumnLayout {
    // excludeGroupId：拖动中把「被拖任务及其子卡」整体移出落点计算，
    // 避免自家子卡被当作独立锚点、把组插进自己原来的缝隙里
    const inCol = tasks.filter(
      (t) => t.status === status && !t.archived && t.id !== excludeGroupId && t.parentId !== excludeGroupId,
    );
    const byId = new Map(inCol.map((t) => [t.id, t]));
    const childrenOf: Record<string, Task[]> = {};
    const anchors: Task[] = [];
    for (const t of inCol) {
      const parentHere = t.parentId ? byId.get(t.parentId) : undefined;
      if (parentHere) {
        (childrenOf[parentHere.id] ??= []).push(t);
      } else {
        anchors.push(t);
      }
    }
    const byOrder = (a: Task, b: Task) => (a.order < b.order ? -1 : 1);
    anchors.sort(byOrder);
    const anchorIdOf: Record<string, string> = {};
    const flat: Task[] = [];
    for (const a of anchors) {
      anchorIdOf[a.id] = a.id;
      flat.push(a);
      for (const child of (childrenOf[a.id] ?? []).sort(byOrder)) {
        anchorIdOf[child.id] = a.id;
        flat.push(child);
      }
    }
    return { flat, anchors, anchorIdOf };
  }

  /** 渲染用布局（无拖动排除） */
  function tasksIn(status: string): { flat: Task[]; anchorIdOf: Record<string, string> } {
    return layoutOf(status);
  }

  function handleDragStart(event: DragStartEvent) {
    setDragging(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over, delta } = event;
    if (!over) return;
    // 放回自身：无操作（否则落入“落到列上”分支被追加到列尾）
    if (over.id === active.id) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;

    const overData = over.data.current as
      | { type: "task"; status: string }
      | { type: "column"; status: string }
      | undefined;
    const targetStatus = overData?.status;
    if (!targetStatus) return;

    const layout = layoutOf(targetStatus, task.id);
    const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : undefined;
    // 父任务与被拖子任务同列时，子卡锁定在父组内（跨列拖动时父不动）
    const groupedChild = Boolean(
      task.parentId && parent && parent.status === targetStatus && !parent.archived,
    );

    let prevOrder: string | null = null;
    let nextOrder: string | null = null;

    if (targetStatus === task.status && groupedChild) {
      // 同列组内重排：只允许落在自家组范围内，落到组外视为无效（弹回原位）
      const siblings = layout.flat.filter((t) => t.parentId === task.parentId);
      const overTaskId = overData?.type === "task" ? String(over.id) : null;
      const overTask = overTaskId ? tasks.find((t) => t.id === overTaskId) : undefined;
      if (!overTask || (overTask.id !== task.parentId && overTask.parentId !== task.parentId)) return;
      if (overTask.id === task.parentId) {
        // 拖拽影中心落在父卡中心线以下 → 收拢为组内第一张，以上无效
        const initial = active.rect.current.initial;
        const centerY = initial ? initial.top + initial.height / 2 + delta.y : null;
        if (centerY == null || centerY <= over.rect.top + over.rect.height / 2) return;
        nextOrder = siblings[0]?.order ?? null;
      } else {
        const idx = siblings.findIndex((t) => t.id === overTask.id);
        if (idx < 0) return;
        // 拖拽影中心落在目标卡下半 → 插其后，上半 → 插其前；
        // DragOverlay 下源卡不位移，用 initial 中心 + delta 还原实际位置
        const initial = active.rect.current.initial;
        const centerY = initial ? initial.top + initial.height / 2 + delta.y : null;
        const after = centerY != null && centerY > over.rect.top + over.rect.height / 2;
        const at = after ? idx + 1 : idx;
        prevOrder = siblings[at - 1]?.order ?? null;
        nextOrder = siblings[at]?.order ?? null;
      }
    } else {
      // 锚点层面落点：无论拖父（整组插到位）还是拖子（父不在目标列、独立成卡），
      // 可插入位置只在顶层锚点之间；落在子卡上按其父组的前后边界处理
      const overTaskId = overData?.type === "task" ? String(over.id) : null;
      let insertPos: number;
      if (overTaskId) {
        const overAnchorId = layout.anchorIdOf[overTaskId];
        // 落在被拖组自己的子卡上（已被移出布局）＝放回原组，无操作
        if (!overAnchorId) return;
        const anchorIdx = layout.anchors.findIndex((a) => a.id === overAnchorId);
        if (anchorIdx < 0) return;
        const initial = active.rect.current.initial;
        const centerY = initial ? initial.top + initial.height / 2 + delta.y : null;
        const after = centerY != null && centerY > over.rect.top + over.rect.height / 2;
        insertPos = anchorIdx + (after ? 1 : 0);
      } else {
        // 落到列空白：追加到列尾
        insertPos = layout.anchors.length;
      }
      prevOrder = layout.anchors[insertPos - 1]?.order ?? null;
      nextOrder = layout.anchors[insertPos]?.order ?? null;
    }

    onMove({
      taskId: task.id,
      targetStatus,
      prevOrder,
      nextOrder,
      order: generateKeyBetween(prevOrder, nextOrder),
    });
    const columnName = columns.find((c) => c.id === targetStatus)?.name ?? targetStatus;
    setAnnouncement(
      draggingSubCount > 0
        ? t("movedGroupAnnounce", { title: task.title, count: draggingSubCount, column: columnName })
        : t("movedAnnounce", { title: task.title, column: columnName }),
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      // 拖拽期间持续重测可放置矩形：列内自动滚动/卡片增删后，旧矩形会把落点判到错误的列
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="board">
        {columns
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((column) => {
            const { flat, anchorIdOf } = tasksIn(column.id);
            return (
              <Column
                key={column.id}
                column={column}
                tasks={flat}
                anchorIdOf={anchorIdOf}
                assigneeNames={assigneeNames}
                parentTitles={parentTitles}
                subProgress={subProgress}
                labels={labels}
                templates={templates}
                canCreate={canCreate}
                canToggle={canToggle}
                onOpenTask={onOpenTask}
                onToggleDone={onToggleDone}
                onCreate={onCreate}
                onCreateFromTemplate={onCreateFromTemplate}
              />
            );
          })}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="task-card task-card--overlay">
            <p className="task-card__title">{dragging.title}</p>
            {draggingSubCount > 0 && (
              <span className="task-card__overlay-badge">
                {t("dragWithSubs", { count: draggingSubCount })}
              </span>
            )}
          </div>
        )}
      </DragOverlay>
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </DndContext>
  );
}
