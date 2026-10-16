import { useEffect, useState } from "react";
import { useOutletContext } from "@remix-run/react";
import { liveQuery } from "dexie";
import { Board } from "~/components/board/Board";
import { TaskDrawer } from "~/components/task/TaskDrawer";
import { taskService, PermissionError } from "~/services/task.service";
import { taskTemplateService } from "~/services/taskTemplate.service";
import { db } from "~/repositories/db";
import { can } from "~/auth/rbac";
import { uuid } from "~/lib/id";
import { t } from "~/lib/i18n";
import { useToast } from "~/components/ui/Toast";
import type { Task } from "~/models/task";
import type { Label } from "~/models/label";
import type { TaskTemplate } from "~/models/taskTemplate";
import type { ProjectOutletContext } from "~/routes/_app.projects_.$projectId";

export const handle = { crumb: () => ({ label: t("board") }) };

export default function BoardRoute() {
  const { project, role, actorId, users } = useOutletContext<ProjectOutletContext>();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    // 过滤软删除：删除打 deletedAt 标记后看板即时少一张卡（liveQuery 触发重订阅回调）
    const sub = liveQuery(() =>
      db.tasks.where("projectId").equals(project.id).toArray(),
    ).subscribe((rows) => setTasks(rows.filter((r) => r.deletedAt === null)));
    return () => sub.unsubscribe();
  }, [project.id]);

  useEffect(() => {
    const sub = liveQuery(() =>
      db.labels.where("projectId").equals(project.id).toArray(),
    ).subscribe((rows) => setLabels(rows));
    return () => sub.unsubscribe();
  }, [project.id]);

  useEffect(() => {
    const sub = liveQuery(() => db.taskTemplates.toArray()).subscribe((rows) => {
      const usable = rows
        .filter((tpl) => tpl.projectId === null || tpl.projectId === project.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      setTemplates(usable);
    });
    return () => sub.unsubscribe();
  }, [project.id]);

  const canCreate = can(role, "task:create");
  const canToggle = can(role, "task:update");
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  function guard(e: unknown) {
    if (e instanceof PermissionError) {
      toast.error(e.message);
      return true;
    }
    return false;
  }

  async function handleMove(intent: {
    taskId: string;
    targetStatus: string;
    prevOrder: string | null;
    nextOrder: string | null;
  }) {
    // 无 task:update 时先拦截，避免乐观移动后被服务层回滚造成闪烁
    if (!canToggle) {
      toast.error(t("noPermission"));
      return;
    }
    // 乐观更新：本地先整组移动（父任务级联子任务同列），失败则由 liveQuery 回读
    const childIds = new Set(
      tasks.filter((t) => t.parentId === intent.taskId).map((t) => t.id),
    );
    setTasks((prev) =>
      prev.map((t) =>
        t.id === intent.taskId || childIds.has(t.id) ? { ...t, status: intent.targetStatus } : t,
      ),
    );
    const moved = tasks.find((t) => t.id === intent.taskId);
    const targetDone = project.statusColumns.find((c) => c.id === intent.targetStatus)?.isDone;
    try {
      await taskService.moveTask(
        actorId,
        intent.taskId,
        intent.targetStatus,
        intent.prevOrder,
        intent.nextOrder,
      );
      if (targetDone && moved && moved.recurrence !== "none") toast.success(t("recurrenceSpawned"));
    } catch (e) {
      guard(e);
    }
  }

  async function handleCreate(status: string, title: string) {
    try {
      await taskService.create(actorId, {
        id: uuid(),
        projectId: project.id,
        title,
        status,
      });
    } catch (e) {
      guard(e);
    }
  }

  async function handleToggleDone(task: Task, done: boolean) {
    try {
      await taskService.updateTask(actorId, task.id, { completed: done });
      // 卡片勾选完成重复任务时与抽屉路径一样提示已生成下一期
      if (done && task.recurrence !== "none") toast.success(t("recurrenceSpawned"));
    } catch (e) {
      guard(e);
    }
  }

  async function handleCreateFromTemplate(tpl: TaskTemplate, status: string) {
    try {
      await taskService.create(actorId, taskTemplateService.buildTaskInput(tpl, project.id, status));
    } catch (e) {
      guard(e);
    }
  }

  return (
    <>
      <Board
        columns={project.statusColumns}
        tasks={tasks}
        users={users}
        labels={labels}
        templates={templates}
        canCreate={canCreate}
        canToggle={canToggle}
        onMove={(intent) => void handleMove(intent)}
        onOpenTask={(task) => setOpenTaskId(task.id)}
        onToggleDone={(task, done) => void handleToggleDone(task, done)}
        onCreate={(status, title) => void handleCreate(status, title)}
        onCreateFromTemplate={(tpl, status) => void handleCreateFromTemplate(tpl, status)}
      />
      <TaskDrawer task={openTask} onClose={() => setOpenTaskId(null)} onOpenTask={setOpenTaskId} />
    </>
  );
}
