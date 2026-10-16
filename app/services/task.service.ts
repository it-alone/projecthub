import { taskRepository } from "~/repositories/task.repository";
import { db } from "~/repositories/db";
import { assertProjectPermission, PermissionError } from "~/auth/assert";
import { uuid } from "~/lib/id";
import { automationService, type AutomationEvent } from "~/services/automation.service";
import type { Task, TaskInput } from "~/models/task";

export { PermissionError };

/** 领域错误：子任务层级约束（仅允许一层） */
export class SubtaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubtaskError";
  }
}

/** 自动化规则失败不阻断任务主流程 */
async function runAutomations(event: AutomationEvent): Promise<void> {
  try {
    await automationService.apply(event);
  } catch {
    // 忽略引擎异常（规则数据异常等），主操作已成功
  }
}

/** 任务详情抽屉可编辑的字段（状态与完成态由服务端统一流转） */
export interface TaskUpdatePatch {
  title?: string;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  priority?: Task["priority"];
  descriptionRich?: unknown;
  subtasks?: Task["subtasks"];
  labels?: string[];
  status?: string;
  recurrence?: Task["recurrence"];
  /** 自定义字段值（fieldId -> 值），整包替换 */
  customValues?: Task["customValues"];
  /** true=完成（若有完成列则同时流转状态）；false=取消完成 */
  completed?: boolean;
}

/** 按重复规则推进 ISO 日期（月底自动收敛到月末最后一天） */
function advanceIso(iso: string, freq: Exclude<Task["recurrence"], "none">): string {
  const d = new Date(iso);
  if (freq === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  }
  return d.toISOString();
}

/** 重复任务完成时生成下一期：回到首个未完成列、日期按周期推进、子任务重置 */
async function spawnNextOccurrence(task: Task): Promise<Task | null> {
  if (task.recurrence === "none") return null;
  const project = await db.projects.get(task.projectId);
  const firstColumn = project?.statusColumns
    .filter((c) => !c.isDone)
    .sort((a, b) => a.order - b.order)[0];
  if (!firstColumn) return null;
  const input: Omit<TaskInput, "createdAt" | "updatedAt" | "version"> = {
    id: uuid(),
    projectId: task.projectId,
    title: task.title,
    descriptionRich: task.descriptionRich,
    status: firstColumn.id,
    assigneeId: task.assigneeId,
    startDate: task.startDate ? advanceIso(task.startDate, task.recurrence) : null,
    dueDate: task.dueDate ? advanceIso(task.dueDate, task.recurrence) : null,
    customValues: task.customValues,
    priority: task.priority,
    labels: task.labels,
    subtasks: task.subtasks.map((s) => ({ id: uuid(), title: s.title, done: false })),
    recurrence: task.recurrence,
  };
  return taskRepository.create(input);
}

export const taskService = {
  async list(projectId: string): Promise<Task[]> {
    return taskRepository.listByProject(projectId);
  },

  async create(
    actorId: string,
    input: Omit<TaskInput, "createdAt" | "updatedAt" | "version">,
  ): Promise<Task> {
    await assertProjectPermission(input.projectId, actorId, "task:create");
    // 直建路径若带 parentId，先校验父任务合法（UI 创建子任务请走 createSubtask）
    if (input.parentId) {
      const parent = await taskRepository.get(input.parentId);
      if (!parent || parent.projectId !== input.projectId || parent.parentId || parent.deletedAt) {
        throw new SubtaskError("父任务不存在或不支持多级子任务");
      }
    }
    const task = await taskRepository.create(input);
    await runAutomations({ projectId: task.projectId, type: "task_created", taskId: task.id });
    return task;
  },

  /**
   * 在父任务下创建子任务：子任务是完整任务（状态/负责人/起止日期独立维护），
   * 默认继承父任务状态，便于在看板中与父任务同列出现；仅允许一层嵌套。
   */
  async createSubtask(
    actorId: string,
    parentId: string,
    input: {
      title: string;
      status?: string;
      assigneeId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
    },
  ): Promise<Task> {
    const parent = await taskRepository.get(parentId);
    if (!parent) throw new Error(`Task ${parentId} not found`);
    if (parent.parentId) throw new SubtaskError("子任务下不能再挂子任务");
    // 父任务在回收站期间不可再挂子任务：purge 父任务会级联清理子任务，避免新数据被连带清除
    if (parent.deletedAt) throw new SubtaskError("父任务已删除，无法添加子任务");
    await assertProjectPermission(parent.projectId, actorId, "task:create");
    if (!input.title.trim()) throw new Error("任务标题不能为空");
    return this.create(actorId, {
      id: uuid(),
      projectId: parent.projectId,
      parentId,
      title: input.title.trim(),
      status: input.status ?? parent.status,
      assigneeId: input.assigneeId ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    });
  },

  async moveTask(
    actorId: string,
    taskId: string,
    targetStatus: string,
    prevOrder: string | null,
    nextOrder: string | null,
  ): Promise<Task> {
    const original = await taskRepository.get(taskId);
    if (!original) throw new Error(`Task ${taskId} not found`);
    await assertProjectPermission(original.projectId, actorId, "task:update");
    const project = await db.projects.get(original.projectId);
    const targetColumn = project?.statusColumns.find((c) => c.id === targetStatus);
    const task = await taskRepository.move(taskId, targetStatus, prevOrder, nextOrder);
    // 父任务整组移动：未软删的子任务全部跟随到目标列。只换列不改 order——
    // 看板按「父分组」渲染，子卡 order 仅决定组内顺序，保留即维持相对顺序；
    // 完成勾选与自动化也只对被拖任务生效，子任务完成态仍独立维护
    const children = (await db.tasks.where("parentId").equals(taskId).toArray())
      .filter((c) => c.deletedAt === null && c.status !== targetStatus);
    if (children.length > 0) {
      await db.transaction("rw", db.tasks, async () => {
        for (const child of children) {
          await taskRepository.update(child.id, { status: targetStatus }, child.version);
        }
      });
    }
    // 状态自动流转：落入「完成列」记录 completedAt，离开则清除
    let result = task;
    if (targetColumn?.isDone && !task.completedAt) {
      result = await taskRepository.update(taskId, {
        completedAt: new Date().toISOString(),
      }, task.version);
      await spawnNextOccurrence(result);
    } else if (!targetColumn?.isDone && task.completedAt) {
      result = await taskRepository.update(taskId, { completedAt: null }, task.version);
    }
    await runAutomations({ projectId: original.projectId, type: "status_entered", columnId: targetStatus, taskId });
    if (targetColumn?.isDone) {
      await runAutomations({ projectId: original.projectId, type: "task_completed", taskId });
    }
    return result;
  },

  async updateTask(
    actorId: string,
    taskId: string,
    patch: TaskUpdatePatch,
  ): Promise<Task> {
    const original = await taskRepository.get(taskId);
    if (!original) throw new Error(`Task ${taskId} not found`);
    await assertProjectPermission(original.projectId, actorId, "task:update");
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new Error("任务标题不能为空");
    }

    const project = await db.projects.get(original.projectId);
    const doneColumn = project?.statusColumns
      .filter((c) => c.isDone)
      .sort((a, b) => a.order - b.order)[0];
    const changed: string[] = [];
    let current = original;

    // 勾选完成：记录 completedAt，若有完成列则同时流转状态；重复任务生成下一期
    if (patch.completed === true && !current.completedAt) {
      const next: Partial<TaskInput> = { completedAt: new Date().toISOString() };
      if (doneColumn && current.status !== doneColumn.id) {
        next.status = doneColumn.id;
      }
      current = await taskRepository.update(taskId, next, current.version);
      changed.push("完成");
      await spawnNextOccurrence(current);
      if (next.status) {
        await runAutomations({ projectId: original.projectId, type: "status_entered", columnId: next.status, taskId });
      }
      await runAutomations({ projectId: original.projectId, type: "task_completed", taskId });
    }
    if (patch.completed === false && current.completedAt) {
      // 取消完成：若停留在完成列，则回到第一个未完成列
      const activeColumn = project?.statusColumns
        .filter((c) => !c.isDone)
        .sort((a, b) => a.order - b.order)[0];
      const next: Partial<TaskInput> = { completedAt: null };
      if (doneColumn && current.status === doneColumn.id && activeColumn) {
        next.status = activeColumn.id;
      }
      current = await taskRepository.update(taskId, next, current.version);
      changed.push("取消完成");
    }

    // 显式状态变更：与 moveTask 相同的完成列流转语义
    if (patch.status !== undefined && patch.status !== current.status) {
      const targetColumn = project?.statusColumns.find((c) => c.id === patch.status);
      current = await taskRepository.update(taskId, { status: patch.status }, current.version);
      if (targetColumn?.isDone && !current.completedAt) {
        current = await taskRepository.update(
          taskId,
          { completedAt: new Date().toISOString() },
          current.version,
        );
        await spawnNextOccurrence(current);
      } else if (!targetColumn?.isDone && current.completedAt) {
        current = await taskRepository.update(taskId, { completedAt: null }, current.version);
      }
      changed.push("状态");
      await runAutomations({ projectId: original.projectId, type: "status_entered", columnId: patch.status, taskId });
      if (targetColumn?.isDone) {
        await runAutomations({ projectId: original.projectId, type: "task_completed", taskId });
      }
    }

    // 其余字段只在真正变化时写库
    const rest: Partial<TaskInput> = {};
    if (patch.title !== undefined && patch.title !== current.title) {
      rest.title = patch.title;
      changed.push("标题");
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== current.assigneeId) {
      rest.assigneeId = patch.assigneeId;
      changed.push("负责人");
    }
    if (patch.startDate !== undefined && patch.startDate !== current.startDate) {
      rest.startDate = patch.startDate;
      changed.push("开始日期");
    }
    if (patch.dueDate !== undefined && patch.dueDate !== current.dueDate) {
      rest.dueDate = patch.dueDate;
      changed.push("截止日期");
    }
    if (patch.priority !== undefined && patch.priority !== current.priority) {
      rest.priority = patch.priority;
      changed.push("优先级");
    }
    if (patch.descriptionRich !== undefined && patch.descriptionRich !== current.descriptionRich) {
      rest.descriptionRich = patch.descriptionRich;
      changed.push("描述");
    }
    if (patch.subtasks !== undefined && patch.subtasks !== current.subtasks) {
      rest.subtasks = patch.subtasks;
      changed.push("子任务");
    }
    if (patch.recurrence !== undefined && patch.recurrence !== current.recurrence) {
      rest.recurrence = patch.recurrence;
      changed.push("重复");
    }
    if (patch.labels !== undefined && patch.labels.join("\u0000") !== current.labels.join("\u0000")) {
      rest.labels = patch.labels;
      changed.push("标签");
    }
    if (
      patch.customValues !== undefined &&
      JSON.stringify(patch.customValues) !== JSON.stringify(current.customValues)
    ) {
      rest.customValues = patch.customValues;
      changed.push("自定义字段");
    }
    if (Object.keys(rest).length > 0) {
      current = await taskRepository.update(taskId, rest, current.version);
    }
    return current;
  },
};
