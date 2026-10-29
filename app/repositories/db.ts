import Dexie, { type EntityTable } from "dexie";
import type { Project } from "~/models/project";
import type { Task } from "~/models/task";
import type { Comment } from "~/models/comment";
import type { User } from "~/models/user";
import type { Label } from "~/models/label";
import type { TaskLink } from "~/models/taskLink";
import type { Milestone } from "~/models/milestone";
import type { Automation } from "~/models/automation";
import type { ProjectTemplate } from "~/models/projectTemplate";
import type { TaskTemplate } from "~/models/taskTemplate";
import type { Flow } from "~/models/flow";
import type { MarkdownDoc } from "~/models/markdownDoc";
import type { DocFile } from "~/models/docSuite";

export interface Preference {
  key: string;
  value: unknown;
}

class ProjectHubDB extends Dexie {
  projects!: EntityTable<Project, "id">;
  tasks!: EntityTable<Task, "id">;
  comments!: EntityTable<Comment, "id">;
  users!: EntityTable<User, "id">;
  preferences!: EntityTable<Preference, "key">;
  labels!: EntityTable<Label, "id">;
  taskLinks!: EntityTable<TaskLink, "id">;
  milestones!: EntityTable<Milestone, "id">;
  automations!: EntityTable<Automation, "id">;
  projectTemplates!: EntityTable<ProjectTemplate, "id">;
  taskTemplates!: EntityTable<TaskTemplate, "id">;
  flows!: EntityTable<Flow, "id">;
  markdownDocs!: EntityTable<MarkdownDoc, "id">;
  docFiles!: EntityTable<DocFile, "id">;

  constructor() {
    super("projecthub");
    this.version(1).stores({
      projects: "id, updatedAt",
      tasks: "id, projectId, status, [projectId+status+order], assigneeId, dueDate, priority, archived",
      comments: "id, taskId, createdAt",
      notifications: "id, userId, createdAt",
      users: "id, name",
      preferences: "key",
    });
    this.version(2)
      .stores({
        tasks: "id, projectId, status, [projectId+status+order], assigneeId, dueDate, priority, archived, deletedAt",
        comments: "id, taskId, createdAt, deletedAt",
        projects: "id, updatedAt, deletedAt",
        auditLogs: "id, createdAt, actorId, entityType",
      })
      .upgrade(async (tx) => {
        for (const table of [tx.table("tasks"), tx.table("projects"), tx.table("comments")]) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            if (row.deletedAt === undefined) row.deletedAt = null;
            if (table.name === "tasks" && row.deletedByProjectId === undefined) {
              row.deletedByProjectId = null;
            }
          });
        }
      });
    // v3：移除通知/审计功能（回收站页、通知页、用户管理与审计已删）
    this.version(3).stores({
      notifications: null,
      auditLogs: null,
    });
    // v4：标签 / 任务关联 / 里程碑 / 自动化 / 模板
    this.version(4).stores({
      labels: "id, projectId",
      taskLinks: "id, fromTaskId, toTaskId",
      milestones: "id, projectId",
      automations: "id, projectId",
      projectTemplates: "id",
      taskTemplates: "id, projectId",
    });
    // v5：任务关联表增加 projectId 索引（按项目列出关联）
    this.version(5).stores({
      taskLinks: "id, projectId, fromTaskId, toTaskId",
    });
    // v6：回填后续版本新增的任务字段（旧数据行缺省，liveQuery 原始读取不经 Zod 默认值）
    this.version(6).upgrade(async (tx) => {
      await tx.table("tasks").toCollection().modify((row: Record<string, unknown>) => {
        if (row.recurrence === undefined) row.recurrence = "none";
        if (row.labels === undefined) row.labels = [];
        if (row.customValues === undefined) row.customValues = {};
      });
    });
    // v7：权限模型重构 —— projectAdmin 归并为 admin；回填项目所有者 ownerId（取首位 admin，无则首个成员）
    this.version(7).upgrade(async (tx) => {
      await tx.table("projects").toCollection().modify((row: Record<string, unknown>) => {
        const roles = (row.memberRoles ?? {}) as Record<string, string>;
        for (const [uid, r] of Object.entries(roles)) {
          if (r === "projectAdmin" || r === "owner") roles[uid] = "admin";
        }
        row.memberRoles = roles;
        if (typeof row.ownerId !== "string" || !row.ownerId) {
          const entries = Object.entries(roles);
          const admin = entries.find(([, r]) => r === "admin");
          row.ownerId = admin ? admin[0] : (entries[0]?.[0] ?? "");
        }
      });
    });
    // v8：任务支持父子子任务 —— 加 parentId 索引并回填旧行（liveQuery 原始读取不经 Zod 默认值）
    this.version(8)
      .stores({
        tasks: "id, projectId, status, [projectId+status+order], assigneeId, dueDate, priority, archived, deletedAt, parentId",
      })
      .upgrade(async (tx) => {
        await tx.table("tasks").toCollection().modify((row: Record<string, unknown>) => {
          if (row.parentId === undefined) row.parentId = null;
        });
      });
    // v9：级联软删标记字段回填（同 v6 理由：liveQuery 原始读取不经 Zod 默认值）
    this.version(9).upgrade(async (tx) => {
      await tx.table("tasks").toCollection().modify((row: Record<string, unknown>) => {
        if (row.deletedByParentTaskId === undefined) row.deletedByParentTaskId = null;
      });
    });
    // v10：流程图模块
    this.version(10).stores({
      flows: "id, projectId",
    });
    // v11：流程图改为独立应用级模块 —— 去掉 projectId 归属，旧数据原地升级为独立文档
    this.version(11)
      .stores({
        flows: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("flows").toCollection().modify((row: Record<string, unknown>) => {
          delete row.projectId;
        });
      });
    // v12：证件模拟器 —— 每种证面至多一份本地填写数据，按 type 查询
    this.version(12).stores({
      simDocs: "id, type",
    });
    // v13：Markdown 文档模块 —— 应用级独立文档（同 flows 模式），按更新时间排序查询
    this.version(13).stores({
      markdownDocs: "id, updatedAt",
    });
    // v14：在线文档套件（飞书式文档 + 表格）—— 应用级独立文件，按更新时间排序查询
    this.version(14).stores({
      docFiles: "id, updatedAt",
    });
    // v15：移除证件模拟器模块 —— 删除 simDocs 表（置 null 即历史数据一并清除）
    this.version(15).stores({
      simDocs: null,
    });
  }
}

export const db = new ProjectHubDB();
