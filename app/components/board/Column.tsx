import { useState } from "react";
import type { CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { StatusColumn } from "~/models/project";
import type { Task } from "~/models/task";
import type { Label } from "~/models/label";
import type { TaskTemplate } from "~/models/taskTemplate";
import { statusColor } from "~/lib/list-view";
import { t } from "~/lib/i18n";
import { Icon } from "~/components/ui/Icon";
import { TaskCard } from "./TaskCard";

export interface ColumnProps {
  column: StatusColumn;
  /** 列内展示序列：父卡后紧跟其子卡（分组排序由 Board 计算） */
  tasks: Task[];
  /** taskId → 所属父锚点 id（组内子卡才有；用于子卡缩进标识） */
  anchorIdOf: Record<string, string>;
  assigneeNames: Record<string, string>;
  /** taskId → 标题（子卡展示父任务标识用） */
  parentTitles: Record<string, string>;
  /** parentId → 子任务完成进度（父卡角标用） */
  subProgress: Record<string, { done: number; total: number }>;
  labels: Label[];
  templates: TaskTemplate[];
  canCreate: boolean;
  canToggle: boolean;
  /** 正在被拖拽的父任务 id：该分组整体压暗，暗示「父动子随」 */
  activeGroupId: string | null;
  onOpenTask: (task: Task) => void;
  onToggleDone: (task: Task, done: boolean) => void;
  onCreate: (status: string, title: string) => void;
  onCreateFromTemplate: (tpl: TaskTemplate, status: string) => void;
}

/** 列内一行 = 一个锚点组：锚点卡 + 紧跟其后的组内子卡（无子卡则组退化为单卡） */
interface AnchorRow {
  anchor: Task;
  children: Task[];
}

function buildRows(tasks: Task[], anchorIdOf: Record<string, string>): AnchorRow[] {
  const rows: AnchorRow[] = [];
  for (const tk of tasks) {
    const anchorId = anchorIdOf[tk.id];
    const last = rows[rows.length - 1];
    if (anchorId && anchorId !== tk.id && last && last.anchor.id === anchorId) {
      last.children.push(tk);
    } else {
      rows.push({ anchor: tk, children: [] });
    }
  }
  return rows;
}

/** 看板列：色点列头 + 计数 + 完成进度条 + 列内快捷创建（支持模板） */
export function Column({
  column, tasks, anchorIdOf, assigneeNames, parentTitles, subProgress, labels, templates, canCreate, canToggle, activeGroupId, onOpenTask, onToggleDone, onCreate, onCreateFromTemplate,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: "column", status: column.id },
  });  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const doneCount = tasks.filter((t) => t.completedAt).length;

  function submit() {
    const title = draft.trim();
    if (title) onCreate(column.id, title);
    setDraft("");
  }

  return (
    // 可放置区域挂在整列（含列头/加号区）：拖到列内任意位置都算本列，
    // 避免松手在列边缘时被邻近列的可放置矩形抢走
    <section
      ref={setNodeRef}
      className={`board-column${isOver ? " is-over" : ""}`}
      aria-label={`${column.name}（${tasks.length}）`}
      style={{ "--col-c": statusColor(column.id) } as CSSProperties}
    >
      <header className="board-column__header">
        <span className="board-column__dot" />
        <span className="board-column__name">{column.name}</span>
        <span className="board-column__count">{tasks.length}</span>
        <span
          className="board-column__progress"
          aria-hidden
          title={t("colProgressAria", { done: doneCount, total: tasks.length })}
        >
          <span style={{ width: tasks.length ? `${(doneCount / tasks.length) * 100}%` : "0%" }} />
        </span>
        {canCreate && (
          <button
            type="button"
            className="icon-btn board-column__add"
            onClick={() => { setAdding(true); setDraft(""); }}
            aria-label={t("addTaskInAria", { column: column.name })}
            title={t("addColumnTask")}
          >
            <Icon name="plus" size={15} />
          </button>
        )}
      </header>
      <div className="board-column__body">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {buildRows(tasks, anchorIdOf).map(({ anchor, children }) => {
            const card = (task: Task, inGroup: boolean, isParent: boolean) => (
              <TaskCard
                key={task.id}
                task={task}
                inGroup={inGroup}
                isParent={isParent}
                assigneeName={task.assigneeId ? assigneeNames[task.assigneeId] ?? null : null}
                parentTitle={task.parentId ? parentTitles[task.parentId] ?? null : null}
                subProgress={subProgress[task.id] ?? null}
                labels={labels}
                canToggle={canToggle}
                onOpen={onOpenTask}
                onToggleDone={onToggleDone}
              />
            );
            if (children.length === 0) return card(anchor, false, false);
            const groupDragging = activeGroupId === anchor.id;
            const allDone = children.every((c) => c.completedAt);
            return (
              <div
                key={anchor.id}
                className={`task-group${groupDragging ? " is-group-dragging" : ""}`}
              >
                {card(anchor, false, true)}
                <div className={`task-group__children${allDone ? " is-all-done" : ""}`}>
                  {children.map((c) => card(c, true, false))}
                </div>
              </div>
            );
          })}
        </SortableContext>
      </div>
      {canCreate && (
        adding ? (
          <div className="col-add">
            {templates.length > 0 && (
              <div className="col-add__templates" aria-label={t("fromTemplate")}>
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="col-add__tpl-chip"
                    onClick={() => { setAdding(false); onCreateFromTemplate(tpl, column.id); }}
                    title={tpl.title}
                  >
                    <Icon name="copy" size={12} />
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
            <input
              className="col-add__input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { submit(); setAdding(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
                if (e.key === "Escape") { setDraft(""); setAdding(false); }
              }}
              placeholder={t("newTaskTitle")}
              aria-label={t("addTaskInAria", { column: column.name })}
            />
          </div>
        ) : (
          <button type="button" className="col-add__trigger" onClick={() => { setAdding(true); setDraft(""); }}>
            <Icon name="plus" size={14} />
            {t("addColumnTask")}
          </button>
        )
      )}
    </section>
  );
}
