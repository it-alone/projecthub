import { useNavigate, NavLink } from "@remix-run/react";
import { useI18n } from "~/lib/i18n";
import { Icon, type IconName } from "~/components/ui/Icon";
import { UserCard } from "./UserCard";

/** 左侧应用图标栏（Worktile 式导航 Rail，深色恒定） */
export function AppRail({ onSearch }: { onSearch: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const item = ({ to, icon, label }: { to: string; icon: IconName; label: string }) => (
    <NavLink
      to={to}
      className={({ isActive }) => `rail__item${isActive ? " is-active" : ""}`}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} size={19} />
    </NavLink>
  );

  return (
    <nav className="rail" aria-label={t("workspaceGroup")}>
      <button className="rail__brand" onClick={() => navigate("/")} aria-label="ProjectHub">
        <Icon name="brand" size={18} />
      </button>
      <span className="rail__divider" aria-hidden="true" />
      {item({ to: "/", icon: "home", label: t("workbench") })}
      {item({ to: "/projects", icon: "kanban", label: t("projects") })}
      {item({ to: "/flows", icon: "workflow", label: t("flowsMenu") })}
      {item({ to: "/docs", icon: "fileText", label: t("docsMenu") })}
      {item({ to: "/markdown", icon: "markdown", label: t("markdownMenu") })}
      {item({ to: "/simulator", icon: "idcard", label: t("simulatorMenu") })}
      {item({ to: "/users", icon: "user", label: t("usersMenu") })}
      <span className="rail__spacer" />
      <span className="rail__divider" aria-hidden="true" />
      <button
        className="rail__item"
        onClick={onSearch}
        title={`${t("globalSearch")} (/)`}
        aria-label={t("globalSearch")}
      >
        <Icon name="search" size={19} />
      </button>
      <NavLink
        to="/settings"
        className={({ isActive }) => `rail__item${isActive ? " is-active" : ""}`}
        title={t("settings")}
        aria-label={t("settings")}
      >
        <Icon name="settings" size={19} />
      </NavLink>
      <UserCard />
    </nav>
  );
}
