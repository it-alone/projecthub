import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import type { Task } from "~/models/task";
import type { Label } from "~/models/label";
import { Icon } from "~/components/ui/Icon";
import { PRIORITY_META, PRIORITY_LABEL_KEY } from "~/lib/priority";
import { avatarColor } from "~/lib/list-view";
import { t, useI18n } from "~/lib/i18n";
import { isOverdue } from "~/lib/date";

export interface TaskCardProps {
  task: Task;
  /** 父任务同列时为 true：子卡作为面板内嵌行展示（父卡就在正上方，不再重复父标识） */
  inGroup?: boolean;
  /** 本列内有子卡跟随的父任务卡：作为分组面板的头部呈现 */
  isParent?: boolean;
  assigneeName: string | null;
  /** 父任务标题（仅独立子卡——父任务在其他列——显示为父标识 chip） */
  parentTitle: string | null;
  /** 子任务完成进度（父任务卡片进度条用，无子任务为 null） */
  subProgress: { done: number; total: number } | null;
  labels: Label[];
  canToggle: boolean;
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task, done: boolean) => void;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function TaskCard({ task, inGroup = false, isParent = false, assigneeName, parentTitle, subProgress, labels, canToggle, onOpen, onToggleDone }: TaskCardProps) {
  const { locale } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { type: "task", status: task.status } });

  const prio = PRIORITY_META[task.priority];
  const done = Boolean(task.completedAt);
  const cardLabels = labels.filter((l) => task.labels.includes(l.id));
  const overdue = task.dueDate ? isOverdue(task.dueDate) && !done : false;
  const dueToday = task.dueDate ? isSameDay(new Date(task.dueDate), new Date()) : false;
  const doneSubtasks = task.subtasks.filter((s) => s.done).length;

  const dueText = task.dueDate
    ? dueToday
      ? t("dueToday")
      : new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(new Date(task.dueDate))
    : null;

  return (
    <div
      ref={setNodeRef}
      className={`task-card${inGroup ? " task-card--child" : ""}${isParent ? " task-card--parent" : ""}${isDragging ? " is-dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Enter 打开任务；其余按键（Space 等）交还 dnd-kit 键盘传感器（拖拽）
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onOpen(task);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      onClick={() => onOpen(task)}
      aria-label={t("cardAria", {
        title: task.title,
        priority: t(PRIORITY_LABEL_KEY[task.priority]),
      })}
    >
      <button
        type="button"
        className={`check${done ? " is-done" : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone(task, !done);
        }}
        disabled={!canToggle}
        aria-label={done ? t("markUndone") : t("markDone")}
        aria-pressed={done}
      >
        <Icon name="check" size={11} />
      </button>
      <div className="task-card__main">
        {parentTitle && !inGroup && (
          <span
            className="task-card__parent"
            title={t("parentTaskAria", { title: parentTitle })}
          >
            <Icon name="cornerDownRight" size={11} />
            <span className="task-card__parent-name">{parentTitle}</span>
          </span>
        )}
        <p className={`task-card__title${done ? " task-card__title--done" : ""}`}>
          {task.title}
        </p>
        {cardLabels.length > 0 && (
          <div className="task-card__labels">
            {cardLabels.slice(0, 3).map((l) => (
              <span key={l.id} className="label-chip" style={{ "--chip-c": l.color } as CSSProperties}>
                {l.name}
              </span>
            ))}
            {cardLabels.length > 3 && (
              <span className="label-chip label-chip--more">+{cardLabels.length - 3}</span>
            )}
          </div>
        )}
        <div className="task-card__foot">
          <span
            className="prio__dot"
            style={{ background: prio.color }}
            title={t(PRIORITY_LABEL_KEY[task.priority])}
          />
          {dueText && (
            <span
              className={`task-card__due${overdue ? " task-card__due--overdue" : dueToday ? " task-card__due--today" : ""}`}
            >
              <Icon name="calendar" size={12} />
              {dueText}
            </span>
          )}
          {subProgress && (
            <span
              className={`task-card__subprog${subProgress.done >= subProgress.total ? " is-complete" : ""}`}
              title={t("subtaskProgressTitle", {
                done: subProgress.done,
                total: subProgress.total,
              })}
            >
              {/* 微型进度环：--p 为完成百分比，环形底由 global.css 的遮罩实现 */}
              <span
                className="task-card__subring"
                style={{ "--p": `${(subProgress.done / subProgress.total) * 100}%` } as CSSProperties}
                aria-hidden
              />
              <span className="task-card__subnum">
                {subProgress.done}/{subProgress.total}
              </span>
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="task-card__subt">
              <Icon name="check" size={11} />
              {doneSubtasks}/{task.subtasks.length}
            </span>
          )}
          {assigneeName && (
            <span
              className="task-card__assignee"
              style={{ background: avatarColor(assigneeName) }}
              title={assigneeName}
            >
              {assigneeName.charAt(0)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
