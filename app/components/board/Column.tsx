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
  onOpenTask: (task: Task) => void;
  onToggleDone: (task: Task, done: boolean) => void;
  onCreate: (status: string, title: string) => void;
  onCreateFromTemplate: (tpl: TaskTemplate, status: string) => void;
}

/** 看板列：色点列头 + 计数 + 完成进度条 + 列内快捷创建（支持模板） */
export function Column({
  column, tasks, anchorIdOf, assigneeNames, parentTitles, subProgress, labels, templates, canCreate, canToggle, onOpenTask, onToggleDone, onCreate, onCreateFromTemplate,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: "column", status: column.id },
  });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const doneCount = tasks.filter((t) => t.completedAt).length;

  function submit() {
    const title = draft.trim();
    if (title) onCreate(column.id, title);
    setDraft("");
  }

  return (
    <section
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
      <div ref={setNodeRef} className="board-column__body">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              inGroup={anchorIdOf[task.id] !== undefined && anchorIdOf[task.id] !== task.id}
              assigneeName={task.assigneeId ? assigneeNames[task.assigneeId] ?? null : null}
              parentTitle={task.parentId ? parentTitles[task.parentId] ?? null : null}
              subProgress={subProgress[task.id] ?? null}
              labels={labels}
              canToggle={canToggle}
              onOpen={onOpenTask}
              onToggleDone={onToggleDone}
            />
          ))}
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
