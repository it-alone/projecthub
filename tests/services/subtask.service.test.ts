import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~/repositories/db";
import { taskService, SubtaskError } from "~/services/task.service";
import { trashService } from "~/services/trash.service";
import { uuid } from "~/lib/id";
import type { Project } from "~/models/project";

const P = "p1";
const COL_TODO = "col-todo";
const COL_DOING = "col-doing";
const COL_DONE = "col-done";

async function seedProject() {
  const project = {
    id: P,
    name: "测试项目",
    description: "",
    statusColumns: [
      { id: COL_TODO, name: "待办", isDone: false, order: 0 },
      { id: COL_DOING, name: "进行中", isDone: false, order: 1 },
      { id: COL_DONE, name: "已完成", isDone: true, order: 2 },
    ],
    ownerId: "u1",
    memberRoles: {},
    archivedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never as Project;
  await db.projects.put(project);
}

/** 直建顶层任务（绕开 createSubtask 以覆盖直传 parentId 的防御分支） */
async function makeTask(overrides: Record<string, unknown> = {}) {
  return taskService.create("u1", {
    id: uuid(),
    projectId: P,
    title: "父任务",
    status: COL_TODO,
    ...overrides,
  });
}

describe("子任务（父子任务）", () => {
  beforeEach(async () => {
    await db.projects.clear();
    await db.tasks.clear();
    await db.comments.clear();
    await seedProject();
  });

  it("createSubtask 继承父任务状态并记录 parentId，字段可显式覆盖", async () => {
    const parent = await makeTask({ status: COL_DOING });
    const child = await taskService.createSubtask("u1", parent.id, {
      title: "子任务 A",
      dueDate: "2026-10-01T00:00:00.000Z",
    });
    expect(child.parentId).toBe(parent.id);
    expect(child.status).toBe(COL_DOING);
    expect(child.dueDate).toBe("2026-10-01T00:00:00.000Z");

    const explicit = await taskService.createSubtask("u1", parent.id, {
      title: "子任务 B",
      status: COL_TODO,
    });
    expect(explicit.status).toBe(COL_TODO);
  });

  it("子任务下不能再挂子任务（仅一层）", async () => {
    const parent = await makeTask();
    const child = await taskService.createSubtask("u1", parent.id, { title: "子任务" });
    await expect(
      taskService.createSubtask("u1", child.id, { title: "孙任务" }),
    ).rejects.toBeInstanceOf(SubtaskError);
  });

  it("create 直传嵌套 parentId 同样被拦截", async () => {
    const parent = await makeTask();
    const child = await taskService.createSubtask("u1", parent.id, { title: "子任务" });
    await expect(
      makeTask({ parentId: child.id, title: "孙任务" }),
    ).rejects.toBeInstanceOf(SubtaskError);
  });

  it("删除父任务会级联软删除子任务，恢复父任务时一并恢复", async () => {
    const parent = await makeTask();
    const c1 = await taskService.createSubtask("u1", parent.id, { title: "子 1" });
    const c2 = await taskService.createSubtask("u1", parent.id, { title: "子 2" });

    await trashService.deleteTask("u1", parent.id);
    expect((await db.tasks.get(parent.id))?.deletedAt).toBeTruthy();
    // 级联子任务带显式标记（deletedByParentTaskId），不靠时间戳相等识别批次
    expect((await db.tasks.get(c1.id))?.deletedByParentTaskId).toBe(parent.id);
    expect((await db.tasks.get(c2.id))?.deletedAt).toBeTruthy();

    await trashService.restoreTask("u1", parent.id);
    expect((await db.tasks.get(parent.id))?.deletedAt).toBeNull();
    expect((await db.tasks.get(c1.id))?.deletedAt).toBeNull();
    expect((await db.tasks.get(c1.id))?.deletedByParentTaskId).toBeNull();
    expect((await db.tasks.get(c2.id))?.deletedAt).toBeNull();
  });

  it("回收站中的父任务不可再挂子任务", async () => {
    const parent = await makeTask();
    await trashService.deleteTask("u1", parent.id);

    await expect(
      taskService.createSubtask("u1", parent.id, { title: "子 1" }),
    ).rejects.toBeInstanceOf(SubtaskError);
    await expect(
      makeTask({ parentId: parent.id, title: "直传父任务" }),
    ).rejects.toBeInstanceOf(SubtaskError);
  });

  it("此前单独删除的子任务不随父任务恢复", async () => {
    const parent = await makeTask();
    const child = await taskService.createSubtask("u1", parent.id, { title: "子 1" });

    await trashService.deleteTask("u1", child.id);
    await trashService.deleteTask("u1", parent.id);
    await trashService.restoreTask("u1", parent.id);

    expect((await db.tasks.get(parent.id))?.deletedAt).toBeNull();
    expect((await db.tasks.get(child.id))?.deletedAt).toBeTruthy();
  });

  it("彻底清除父任务时子任务一并清除", async () => {
    const parent = await makeTask();
    const child = await taskService.createSubtask("u1", parent.id, { title: "子 1" });

    await trashService.deleteTask("u1", parent.id);
    await trashService.purgeTask(parent.id);

    expect(await db.tasks.get(parent.id)).toBeUndefined();
    expect(await db.tasks.get(child.id)).toBeUndefined();
  });

  it("子任务与父任务状态独立流转（完成子任务不影响父任务）", async () => {
    const parent = await makeTask({ status: COL_TODO });
    const child = await taskService.createSubtask("u1", parent.id, { title: "子 1" });

    const moved = await taskService.updateTask("u1", child.id, { status: COL_DONE });
    expect(moved.completedAt).toBeTruthy();
    expect(moved.status).toBe(COL_DONE);

    const parentRow = await db.tasks.get(parent.id);
    expect(parentRow?.completedAt).toBeNull();
    expect(parentRow?.status).toBe(COL_TODO);
  });

  it("看板拖动父任务：子任务整组跟随换列且保留组内顺序", async () => {
    const parent = await makeTask({ status: COL_TODO });
    const c1 = await taskService.createSubtask("u1", parent.id, { title: "子 1" });
    const c2 = await taskService.createSubtask("u1", parent.id, { title: "子 2" });
    // 子任务先被单独拖到其他列，父任务移动时也应被拉回父任务所在列
    await taskService.moveTask("u1", c1.id, COL_DOING, null, null);
    // 级联前各子任务的当前 order（c1 已因自身移动重算过）
    const before: string[] = [];
    for (const c of [c1, c2]) before.push((await db.tasks.get(c.id))!.order);

    await taskService.moveTask("u1", parent.id, COL_DONE, null, null);

    expect((await db.tasks.get(parent.id))?.status).toBe(COL_DONE);
    for (const [i, c] of [c1, c2].entries()) {
      const row = await db.tasks.get(c.id);
      expect(row?.status).toBe(COL_DONE);
      expect(row?.order).toBe(before[i]); // order 保留 = 组内相对顺序不变
    }
  });

  it("看板拖动父任务进完成列：仅父任务记 completedAt，子任务完成态独立", async () => {
    const parent = await makeTask({ status: COL_TODO });
    const child = await taskService.createSubtask("u1", parent.id, { title: "子 1" });

    await taskService.moveTask("u1", parent.id, COL_DONE, null, null);

    expect((await db.tasks.get(parent.id))?.completedAt).toBeTruthy();
    expect((await db.tasks.get(child.id))?.completedAt).toBeNull();
  });

  it("看板拖动子任务：父任务不动", async () => {
    const parent = await makeTask({ status: COL_TODO });
    const child = await taskService.createSubtask("u1", parent.id, { title: "子 1" });

    await taskService.moveTask("u1", child.id, COL_DOING, null, null);

    expect((await db.tasks.get(child.id))?.status).toBe(COL_DOING);
    expect((await db.tasks.get(parent.id))?.status).toBe(COL_TODO);
  });

  it("看板拖动父任务：已软删的子任务不跟随", async () => {
    const parent = await makeTask({ status: COL_TODO });
    const child = await taskService.createSubtask("u1", parent.id, { title: "子 1" });
    await trashService.deleteTask("u1", child.id);

    await taskService.moveTask("u1", parent.id, COL_DOING, null, null);

    const row = await db.tasks.get(child.id);
    expect(row?.status).toBe(COL_TODO);
    expect(row?.deletedAt).toBeTruthy();
  });
});
