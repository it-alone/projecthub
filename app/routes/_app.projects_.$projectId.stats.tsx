import { useEffect, useState } from "react";
import { useOutletContext } from "@remix-run/react";
import { liveQuery } from "dexie";
import { StatsView } from "~/components/stats/StatsView";
import { Icon } from "~/components/ui/Icon";
import { db } from "~/repositories/db";
import { t as translate, useI18n } from "~/lib/i18n";
import type { Task } from "~/models/task";
import type { User } from "~/models/user";
import type { ProjectOutletContext } from "~/routes/_app.projects_.$projectId";

export const handle = { crumb: () => ({ label: translate("statsView") }) };

export default function StatsRoute() {
  const { project, users } = useOutletContext<ProjectOutletContext>();
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>(users);
  // liveQuery 首次发射前与“真的没有任务”需要区分，否则会先闪一屏空态
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sub = liveQuery(() =>
      db.tasks.where("projectId").equals(project.id).toArray(),
    ).subscribe((rows) => {
      setTasks(rows.filter((r) => r.deletedAt === null));
      setReady(true);
    });
    return () => sub.unsubscribe();
  }, [project.id]);

  // 成员可能在项目加载后才齐全，跟随 users 出口上下文
  useEffect(() => setAllUsers(users), [users]);

  if (!ready) {
    return <div className="empty empty--page">{t("loading")}</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="empty empty--page">
        <Icon name="zap" size={32} />
        <p>{t("statsEmptyPage")}</p>
      </div>
    );
  }

  return (
    <StatsView tasks={tasks} columns={project.statusColumns} users={allUsers} />
  );
}
